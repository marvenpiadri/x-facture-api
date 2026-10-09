import { errorResponse, handleOptions, isPlainObject, methodNotAllowed, parseJsonBody, prepareResponse } from '../lib/http.js';
import { buildInvoiceInput } from './generate-invoice.js';
import { validateInvoiceCompliance } from '../lib/compliance/engine.js';

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
    const report = validateInvoiceCompliance(invoice, { jurisdiction: body.jurisdiction });
    return res.status(report.valid ? 200 : 422).json({
      success: true,
      ...report,
      note: 'This report covers the checks implemented in this ruleset. It does not prove acceptance by a French approved platform or completion of electronic transmission/reporting obligations.'
    });
  } catch (error) {
    return errorResponse(res, 422, 'INVALID_INVOICE_INPUT', error instanceof Error ? error.message : String(error));
  }
}
