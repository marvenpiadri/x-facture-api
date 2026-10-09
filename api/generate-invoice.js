import {
  embedFacturX,
  validateInput,
  Profile,
  Flavor
} from '@stackforge-eu/factur-x';
import {
  errorResponse,
  handleOptions,
  isPlainObject,
  methodNotAllowed,
  parseJsonBody,
  prepareResponse
} from '../lib/http.js';
import { renderPdf } from '../lib/pdf-renderer.js';

const MAX_HTML_BYTES = 1_500_000;
const MAX_ITEMS = 200;

const text = (value, max = 500) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;

const num = (value, fallback = 0) => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isFinite(n) ? n : fallback;
};

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

function country(value) {
  const code = text(value, 2)?.toUpperCase();
  return /^[A-Z]{2}$/.test(code || '') ? code : undefined;
}

function addressFrom(source) {
  const address = source?.address || {};
  const result = {
    line1: text(address.line1 || source.addressLine1 || source.street, 200),
    line2: text(address.line2 || source.addressLine2, 200),
    city: text(address.city || source.city, 100),
    postalCode: text(address.postalCode || source.postalCode || source.zip, 30),
    country: country(address.country || source.country)
  };
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}

function taxRegistration(source) {
  const identifiers = Array.isArray(source?.taxIdentifiers) ? source.taxIdentifiers : [];
  const mapped = identifiers.flatMap((item) => {
    if (!isPlainObject(item)) return [];
    const id = text(item.value, 100);
    if (!id) return [];
    const type = text(item.type, 40)?.toUpperCase();
    if (type === 'VAT' || type === 'GST' || type === 'GSTIN' || type === 'TRN' || type === 'INVOICE_REG') {
      return [{ id, schemeId: 'VA' }];
    }
    if (['TAX_ID', 'IF', 'EIN', 'TIN', 'NIF', 'CNPJ', 'CPF', 'PAN', 'UTR', 'NPWP', 'KRA_PIN', 'MAT_FISCAL', 'VKN', 'NTN', 'INCOME_TAX', 'PATENTE'].includes(type || '')) {
      return [{ id, schemeId: 'FC' }];
    }
    return [];
  });
  if (mapped.length) return mapped;
  const vatId = text(source?.vatId || source?.vat || source?.taxId, 100);
  return vatId ? [{ id: vatId, schemeId: 'VA' }] : undefined;
}

function legalOrganization(source) {
  const identifiers = Array.isArray(source?.taxIdentifiers) ? source.taxIdentifiers : [];
  const businessTypes = new Set(['ICE', 'SIREN', 'SIRET', 'CNPJ', 'CRN', 'CBE', 'KVK', 'ABN', 'ACN', 'NZBN', 'CIN', 'UEN', 'USCC', 'CR', 'RC', 'ORG_NO', 'CVR', 'BUSINESS_ID', 'CUI', 'KRS', 'REGON', 'NIB', 'MERSIS', 'EDRPOU']);
  const item = identifiers.find((candidate) => isPlainObject(candidate) && businessTypes.has(String(candidate.type || '').toUpperCase()) && text(candidate.value, 100));
  if (!item) return undefined;
  const id = text(item.value, 100);
  const schemeID = text(item.schemeId, 4);
  return { id, ...(schemeID && /^\\d{4}$/.test(schemeID) ? { schemeID } : {}) };
}

function buildInvoiceInput(data) {
  const items = data.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
    throw new Error(`items must contain between 1 and ${MAX_ITEMS} entries.`);
  }

  const currency = text(data.currency, 3)?.toUpperCase() || 'EUR';
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('currency must be a 3-letter ISO code.');

  const lines = items.map((item, index) => {
    if (!isPlainObject(item)) throw new Error(`Item ${index + 1} must be an object.`);

    const quantity = num(item.quantity ?? item.qty, 1);
    const unitPrice = num(item.unitPrice ?? item.price);
    const vatRate = num(item.vatRate ?? item.vatPercentage);
    const lineTotal = round2(quantity * unitPrice);

    if (quantity <= 0 || unitPrice < 0 || vatRate < 0 || vatRate > 100) {
      throw new Error(`Invalid values for item ${index + 1}.`);
    }

    return {
      id: String(index + 1),
      name: text(item.description || item.name, 500) || `Item ${index + 1}`,
      quantity,
      unitCode: text(item.unitCode, 10) || 'C62',
      unitPrice,
      lineTotal,
      vatCategoryCode: 'S',
      vatRatePercent: vatRate
    };
  });

  const lineTotal = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  const vatGroups = new Map();

  for (const line of lines) {
    const key = line.vatRatePercent.toFixed(2);
    const group = vatGroups.get(key) || {
      categoryCode: 'S',
      ratePercent: line.vatRatePercent,
      taxableAmount: 0,
      taxAmount: 0
    };
    group.taxableAmount = round2(group.taxableAmount + line.lineTotal);
    group.taxAmount = round2(group.taxAmount + (line.lineTotal * line.vatRatePercent) / 100);
    vatGroups.set(key, group);
  }

  const taxTotal = round2([...vatGroups.values()].reduce((sum, group) => sum + group.taxAmount, 0));
  const taxBasisTotal = round2(lineTotal);
  const grandTotal = round2(taxBasisTotal + taxTotal);
  const amountPaid = Math.min(grandTotal, Math.max(0, num(data.amountPaid)));
  const duePayableAmount = round2(grandTotal - amountPaid);

  const seller = {
    name: text(data.sellerName || data.seller?.name),
    address: addressFrom(data.seller || data),
    taxRegistrations: taxRegistration(data.seller || {
      vatId: data.sellerVat
    }),
    ...(legalOrganization(data.seller || {}) ? { legalOrganization: legalOrganization(data.seller || {}) } : (data.sellerSiren ? { legalOrganization: { id: text(data.sellerSiren, 9), schemeID: '0002' } } : {})),
    ...(data.seller?.electronicAddress && data.seller?.electronicAddressScheme ? {
      electronicAddress: {
        value: text(data.seller.electronicAddress, 200),
        schemeID: text(data.seller.electronicAddressScheme, 20)
      }
    } : {})
  };

  const buyerSource = data.buyer || {
    name: data.buyerName,
    vatId: data.buyerVat,
    address: {
      line1: data.buyerAddressLine1,
      line2: data.buyerAddressLine2,
      city: data.buyerCity,
      postalCode: data.buyerPostalCode,
      country: data.buyerCountry
    }
  };

  const buyer = {
    name: text(buyerSource.name),
    address: addressFrom(buyerSource),
    taxRegistrations: taxRegistration(buyerSource),
    ...(legalOrganization(buyerSource) ? { legalOrganization: legalOrganization(buyerSource) } : (data.buyerSiren ? { legalOrganization: { id: text(data.buyerSiren, 9), schemeID: '0002' } } : {})),
    ...(buyerSource.electronicAddress && buyerSource.electronicAddressScheme ? {
      electronicAddress: {
        value: text(buyerSource.electronicAddress, 200),
        schemeID: text(buyerSource.electronicAddressScheme, 20)
      }
    } : {})
  };

  const issueDate = text(data.date || data.issueDate, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate || '')) {
    throw new Error('date must use YYYY-MM-DD format.');
  }

  const id = text(data.id || data.invoiceNumber, 100);
  if (!id) throw new Error('Invoice id is required.');

  return {
    document: {
      id,
      issueDate,
      typeCode: data.documentType === 'credit-notes' ? '381' : '380',
      dueDate: text(data.dueDate, 10),
      buyerReference: text(data.buyerReference, 70)
    },
    seller,
    buyer,
    lines,
    totals: {
      lineTotal,
      taxBasisTotal,
      taxTotal,
      grandTotal,
      duePayableAmount,
      currency
    },
    vatBreakdown: [...vatGroups.values()],
    ...(data.payment?.iban ? {
      payment: {
        meansCode: text(data.payment.meansCode, 10) || '58',
        iban: text(data.payment.iban, 34),
        bic: text(data.payment.bic, 11),
        dueDate: text(data.dueDate, 10),
        paymentReference: text(data.id, 70)
      }
    } : {}),
    ...(data.deliveryDate || data.deliveryAddressLine1 ? {
      delivery: {
        date: text(data.deliveryDate, 10),
        location: {
          line1: text(data.deliveryAddressLine1, 200),
          city: text(data.deliveryCity, 100),
          postalCode: text(data.deliveryPostalCode, 30),
          country: country(data.deliveryCountry)
        }
      }
    } : {})
  };
}

export default async function handler(req, res) {
  prepareResponse(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST, OPTIONS');

  const body = parseJsonBody(req);
  if (!isPlainObject(body)) {
    return errorResponse(res, 400, 'INVALID_JSON', 'Request body must be a JSON object.');
  }

  const htmlLayout = typeof body.htmlLayout === 'string' ? body.htmlLayout : '';
  if (!htmlLayout) return errorResponse(res, 400, 'MISSING_HTML', 'htmlLayout is required.');
  if (Buffer.byteLength(htmlLayout, 'utf8') > MAX_HTML_BYTES) {
    return errorResponse(res, 413, 'HTML_TOO_LARGE', 'htmlLayout exceeds the 1.5 MB limit.');
  }
  if (!isPlainObject(body.rawInvoiceData)) {
    return errorResponse(res, 400, 'MISSING_INVOICE_DATA', 'rawInvoiceData must be a JSON object.');
  }

  const paperSize = typeof body.paperSize === 'string'
    ? body.paperSize.toLowerCase()
    : 'a4';

  if (!['a4', 'letter'].includes(paperSize)) {
    return errorResponse(res, 400, 'INVALID_PAPER_SIZE', 'paperSize must be either a4 or letter.');
  }

  try {
    let phase = 'input-validation';
    const invoice = buildInvoiceInput(body.rawInvoiceData);

    phase = 'factur-x-input-validation';
    const validation = validateInput(invoice, Profile.EN16931);
    if (!validation.valid) {
      return errorResponse(
        res,
        422,
        'INVALID_FACTUR_X_DATA',
        'Invoice data does not satisfy EN 16931 requirements.',
        validation.errors
      );
    }

    phase = 'pdf-rendering';
    const standardPdfBuffer = await renderPdf(htmlLayout, paperSize);

    phase = 'factur-x-embedding';
    const result = await embedFacturX({
      pdf: standardPdfBuffer,
      input: invoice,
      profile: Profile.EN16931,
      flavor: Flavor.FACTUR_X,
      validateXsd: true
    });

    const pdf = Buffer.from(result.pdf);
    if (pdf.subarray(0, 5).toString() !== '%PDF-') {
      throw Object.assign(new Error('Factur-X embedding returned invalid PDF bytes.'), { phase: 'factur-x-output-validation' });
    }

    const safeId = invoice.document.id.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(pdf.length));
    res.setHeader('Content-Disposition', `attachment; filename="${safeId || 'invoice'}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(pdf);
  } catch (error) {
    const phase = error?.phase || 'unknown';
    const message = error instanceof Error ? error.message : String(error);
    console.error('generate-invoice:', { phase, error });

    return errorResponse(
      res,
      500,
      'INVOICE_GENERATION_FAILED',
      message || 'The invoice could not be generated.',
      { phase }
    );
  }
}
