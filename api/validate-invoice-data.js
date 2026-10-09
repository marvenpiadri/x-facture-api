import { check } from '@stafyniaksacha/facturx';
import { buildInvoiceInput } from './generate-invoice.js';
import { invoiceToCiiXml } from '../lib/facturx/cii.js';
import { validateInvoiceCompliance } from '../lib/compliance/engine.js';
import { errorResponse, handleOptions, isPlainObject, methodNotAllowed, parseJsonBody, prepareResponse } from '../lib/http.js';

function missingFields(data, invoice) {
  const missing = [];
  const add = (path, label, value) => {
    if (typeof value !== 'string' || !value.trim()) missing.push({ path, label, severity: 'warning', message: label + ' has not been supplied.' });
  };
  add('seller.name', 'Seller name', invoice.seller.name);
  add('seller.address.country', 'Seller country', invoice.seller.address.country);
  add('buyer.name', 'Buyer name', invoice.buyer.name);
  add('buyer.address.country', 'Buyer country', invoice.buyer.address.country);
  add('document.id', 'Invoice number', invoice.document.id);
  if (!invoice.lines.length) add('lines', 'At least one invoice line', '');
  return missing;
}

export default async function handler(req, res) {
  prepareResponse(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST, OPTIONS');

  const body = parseJsonBody(req);
  if (!isPlainObject(body) || !isPlainObject(body.rawInvoiceData)) {
    return errorResponse(res, 400, 'MISSING_INVOICE_DATA', 'Request body must include rawInvoiceData as an object.');
  }

  try {
    const invoice = buildInvoiceInput(body.rawInvoiceData);
    const xml = invoiceToCiiXml(invoice);
    const compliance = validateInvoiceCompliance(invoice, { jurisdiction: body.jurisdiction });
    let validation;
    let engineError;

    try {
      validation = await check({ xml, flavor: 'facturx', level: 'en16931', schematron: true });
    } catch (error) {
      engineError = error instanceof Error ? error.message : String(error);
    }

    const xmlErrors = Array.isArray(validation?.errors) ? validation.errors : [];
    const businessErrors = Array.isArray(validation?.schematronErrors) ? validation.schematronErrors : [];
    const errors = [...xmlErrors, ...businessErrors];
    const missing = missingFields(body.rawInvoiceData, invoice);
    const valid = Boolean(validation?.valid) && compliance.valid && missing.length === 0;

    return res.status(200).json({
      success: true,
      valid,
      status: valid ? 'valid' : 'needs-attention',
      summary: {
        xmlSchemaValid: Array.isArray(validation?.errors) && validation.errors.length === 0,
        en16931Valid: validation?.schematronValid ?? null,
        complianceStatus: compliance.status,
        missingFields: missing.length,
        xmlIssues: errors.length,
        validationEngineAvailable: !engineError
      },
      missingFields: missing,
      errors,
      compliance: {
        jurisdiction: compliance.jurisdiction,
        status: compliance.status,
        summary: compliance.summary,
        findings: compliance.findings
      },
      ...(engineError ? { validationEngineError: engineError } : {}),
      xml
    });
  } catch (error) {
    return errorResponse(res, 422, 'INVOICE_VALIDATION_FAILED', error instanceof Error ? error.message : String(error));
  }
}
