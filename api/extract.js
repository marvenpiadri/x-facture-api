import { check, extract } from '@stafyniaksacha/facturx';
import { errorResponse, handleOptions, methodNotAllowed, parseJsonBody, prepareResponse } from '../lib/http.js';

const MAX_BYTES = 12 * 1024 * 1024;

function decodePdf(value) {
  if (typeof value !== 'string' || !value) throw new Error('pdfBase64 is required.');
  const pdf = Buffer.from(value, 'base64');
  if (!pdf.length || pdf.length > MAX_BYTES) throw new Error('PDF is empty or exceeds the 12 MB limit.');
  if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('The uploaded file is not a PDF.');
  return pdf;
}

export default async function handler(req, res) {
  prepareResponse(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST, OPTIONS');

  const body = parseJsonBody(req);
  if (!body || typeof body !== 'object' || typeof body.pdfBase64 !== 'string') {
    return errorResponse(res, 400, 'MISSING_PDF', 'pdfBase64 is required.');
  }

  try {
    const result = await extract({ pdf: decodePdf(body.pdfBase64), flavor: 'facturx' });
    const detected = await check({ xml: result.xml, flavor: 'facturx' });
    return res.status(200).json({
      success: true,
      filename: 'factur-x.xml',
      profile: detected.level,
      xml: result.xml
    });
  } catch (error) {
    return errorResponse(res, 422, 'EXTRACTION_FAILED', error instanceof Error ? error.message : String(error));
  }
}
