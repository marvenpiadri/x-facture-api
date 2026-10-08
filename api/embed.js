import { embedFacturX, Profile, Flavor } from '@stackforge-eu/factur-x';
import { errorResponse, handleOptions, methodNotAllowed, parseJsonBody, prepareResponse } from '../lib/http.js';

const MAX_BYTES = 12 * 1024 * 1024;
const profiles = new Map([
  ['minimum', Profile.MINIMUM],
  ['basic-wl', Profile.BASIC_WL],
  ['basic', Profile.BASIC],
  ['en16931', Profile.EN16931],
  ['extended', Profile.EXTENDED]
]);

export default async function handler(req, res) {
  prepareResponse(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST, OPTIONS');

  const body = parseJsonBody(req);
  if (!body || typeof body !== 'object' || typeof body.pdfBase64 !== 'string' || typeof body.xml !== 'string') {
    return errorResponse(res, 400, 'MISSING_INPUT', 'pdfBase64 and xml are required.');
  }

  try {
    const pdf = Buffer.from(body.pdfBase64, 'base64');
    if (!pdf.length || pdf.length > MAX_BYTES) return errorResponse(res, 413, 'PDF_TOO_LARGE', 'PDF exceeds the 12 MB limit.');
    const profile = profiles.get(String(body.profile || 'en16931').toLowerCase()) || Profile.EN16931;
    const result = await embedFacturX({
      pdf,
      xml: body.xml,
      profile,
      flavor: Flavor.FACTUR_X,
      validateXsd: true
    });
    const output = Buffer.from(result.pdf);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(output.length));
    res.setHeader('Content-Disposition', 'attachment; filename="factur-x.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(output);
  } catch (error) {
    return errorResponse(res, 422, 'EMBED_FAILED', error instanceof Error ? error.message : String(error));
  }
}
