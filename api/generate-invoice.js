import { check, extract, generate } from '@stafyniaksacha/facturx';
import { invoiceToCiiXml } from '../lib/facturx/cii.js';
import { validateInvoiceCompliance } from '../lib/compliance/engine.js';
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

function todayIsoDate() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}

function isValidIsoDate(value) {
  if (typeof value !== 'string' || value.length !== 10 || value[4] !== '-' || value[7] !== '-') return false;
  const digits = value.slice(0, 4) + value.slice(5, 7) + value.slice(8, 10);
  if (![...digits].every(char => char >= '0' && char <= '9')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
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
    if (type === 'VAT') {
      return [{ id, schemeId: 'VA' }];
    }
    if (['TAX_ID', 'IF', 'EIN', 'TIN', 'NIF', 'CODICE_FISCALE', 'CNPJ', 'CPF', 'PAN', 'UTR', 'NPWP', 'KRA_PIN', 'MAT_FISCAL', 'VKN', 'NTN', 'INCOME_TAX', 'PATENTE', 'GST', 'GSTIN', 'TRN', 'INVOICE_REG', 'SALES_TAX', 'SST'].includes(type || '')) {
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
  const businessTypes = new Set(['ICE', 'SIREN', 'RC', 'RCS', 'CRN', 'CBE', 'KVK', 'ABN', 'ACN', 'NZBN', 'CIN', 'UEN', 'USCC', 'CR', 'ORG_NO', 'CVR', 'BUSINESS_ID', 'CUI', 'KRS', 'REGON', 'NIB', 'MERSIS', 'EDRPOU']);
  const item = identifiers.find((candidate) => isPlainObject(candidate) && String(candidate.type || '').toUpperCase() === 'SIREN' && text(candidate.value, 100))
    || identifiers.find((candidate) => isPlainObject(candidate) && candidate.schemeId && !['0009', '0060', '0088'].includes(String(candidate.schemeId)) && businessTypes.has(String(candidate.type || '').toUpperCase()) && text(candidate.value, 100))
    || identifiers.find((candidate) => isPlainObject(candidate) && businessTypes.has(String(candidate.type || '').toUpperCase()) && text(candidate.value, 100));
  if (!item) return undefined;
  const id = text(item.value, 100);
  const type = String(item.type || '').toUpperCase();
  const schemeID = text(item.schemeId, 4) || (type === 'SIREN' ? '0002' : undefined);
  const validScheme = schemeID && schemeID.length === 4 && [...schemeID].every(char => char >= '0' && char <= '9');
  return { id, ...(validScheme ? { schemeID } : {}) };
}

function globalIdentifier(source) {
  const identifiers = Array.isArray(source?.taxIdentifiers) ? source.taxIdentifiers : [];
  const item = identifiers.find((candidate) => isPlainObject(candidate)
    && ['SIRET', 'GLN', 'DUNS'].includes(String(candidate.type || '').toUpperCase())
    && text(candidate.value, 100));
  if (!item) return undefined;
  const type = String(item.type || '').toUpperCase();
  const schemeID = text(item.schemeId, 4) || (type === 'SIRET' ? '0009' : type === 'GLN' ? '0088' : '0060');
  return { value: text(item.value, 100), schemeID };
}

export function buildInvoiceInput(data) {
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
      vatCategoryCode: vatRate === 0 ? 'Z' : 'S',
      vatRatePercent: vatRate
    };
  });

  const lineTotal = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  const vatGroups = new Map();

  for (const line of lines) {
    const key = line.vatRatePercent.toFixed(2);
    const group = vatGroups.get(key) || {
      categoryCode: line.vatCategoryCode,
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
    ...(globalIdentifier(data.seller || {}) ? { globalId: globalIdentifier(data.seller || {}) } : {}),
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
    ...(globalIdentifier(buyerSource) ? { globalId: globalIdentifier(buyerSource) } : {}),
    ...(buyerSource.electronicAddress && buyerSource.electronicAddressScheme ? {
      electronicAddress: {
        value: text(buyerSource.electronicAddress, 200),
        schemeID: text(buyerSource.electronicAddressScheme, 20)
      }
    } : {})
  };

  const issueDate = text(data.date || data.issueDate, 10) || todayIsoDate();
  if (!isValidIsoDate(issueDate)) {
    throw new Error('Issue date must be a real calendar date in YYYY-MM-DD format.');
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

    phase = 'xfacture-compliance-preflight';
    const compliance = validateInvoiceCompliance(invoice);
    if (!compliance.valid) {
      return errorResponse(res, 422, 'INVALID_FACTUR_X_DATA', 'Invoice data failed X-Facture preflight checks.', compliance.findings);
    }

    phase = 'cii-xml-serialization';
    const xml = invoiceToCiiXml(invoice);

    phase = 'cii-xml-validation';
    const validation = await check({ xml, schematron: true });
    if (!validation.valid) {
      return errorResponse(
        res,
        422,
        'INVALID_FACTUR_X_XML',
        'The generated CII XML failed Factur-X schema or EN 16931 business-rule validation.',
        validation.errors
      );
    }

    phase = 'pdf-rendering';
    const standardPdfBuffer = await renderPdf(htmlLayout, paperSize);

    phase = 'factur-x-pdf-a3-packaging';
    const pdf = Buffer.from(await generate({ pdf: standardPdfBuffer, xml }));
    if (pdf.subarray(0, 5).toString() !== '%PDF-') {
      throw Object.assign(new Error('Factur-X packaging returned invalid PDF bytes.'), { phase: 'factur-x-output-validation' });
    }

    phase = 'factur-x-roundtrip-verification';
    const extracted = await extract({ pdf });
    if (!extracted?.xml || !extracted.xml.includes('CrossIndustryInvoice')) {
      throw Object.assign(new Error('Generated PDF did not retain an extractable CII invoice.'), { phase });
    }
    const roundTripValidation = await check({ xml: extracted.xml, schematron: true });
    if (!roundTripValidation.valid) {
      throw Object.assign(
        new Error('The XML extracted from the final PDF failed Factur-X validation.'),
        { phase, validationErrors: roundTripValidation.errors }
      );
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
