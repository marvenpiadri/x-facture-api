import { extractXml } from '@stackforge-eu/factur-x';
import { errorResponse, handleOptions, methodNotAllowed, parseJsonBody, prepareResponse } from '../lib/http.js';

const MAX_BYTES = 12 * 1024 * 1024;

export default async function handler(req, res) {
  prepareResponse(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST, OPTIONS');

  const body = parseJsonBody(req);
  if (!body || typeof body !== 'object' || typeof body.pdfBase64 !== 'string') {
    return errorResponse(res, 400, 'MISSING_PDF', 'pdfBase64 is required.');
  }

  try {
    const pdf = Buffer.from(body.pdfBase64, 'base64');
    if (!pdf.length || pdf.length > MAX_BYTES) return errorResponse(res, 413, 'PDF_TOO_LARGE', 'PDF exceeds the 12 MB limit.');
    const result = await extractXml(pdf);
    return res.status(200).json({
      success: true,
      filename: result.filename,
      profile: result.profile,
      xml: result.xml
    });
  } catch (error) {
    return errorResponse(res, 422, 'EXTRACTION_FAILED', error instanceof Error ? error.message : String(error));
  }
}
