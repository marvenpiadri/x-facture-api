import { extractXml, validateXsd, Profile } from '@stackforge-eu/factur-x';
import { errorResponse, handleOptions, methodNotAllowed, parseJsonBody, prepareResponse } from '../lib/http.js';

const MAX_BYTES = 12 * 1024 * 1024;

const profiles = new Map([
  ['minimum', Profile.MINIMUM],
  ['basic-wl', Profile.BASIC_WL],
  ['basic', Profile.BASIC],
  ['en16931', Profile.EN16931],
  ['extended', Profile.EXTENDED]
]);

function getProfile(value) {
  const key = String(value || 'en16931').toLowerCase();
  return profiles.get(key) || Profile.EN16931;
}

function decodeBase64(value) {
  if (typeof value !== 'string' || !value) throw new Error('base64 data is required.');
  const buffer = Buffer.from(value, 'base64');
  if (!buffer.length || buffer.length > MAX_BYTES) throw new Error('Uploaded data is empty or too large.');
  return buffer;
}

export default async function handler(req, res) {
  prepareResponse(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST, OPTIONS');

  const body = parseJsonBody(req);
  if (!body || typeof body !== 'object') return errorResponse(res, 400, 'INVALID_JSON', 'Request body must be an object.');

  try {
    const profile = getProfile(body.profile);
    let xml = typeof body.xml === 'string' ? body.xml : '';
    let source = 'xml';
    let filename = 'factur-x.xml';
    let detectedProfile;

    if (!xml && body.pdfBase64) {
      const pdf = decodeBase64(body.pdfBase64);
      const extracted = await extractXml(pdf);
      xml = extracted.xml;
      filename = extracted.filename || filename;
      detectedProfile = extracted.profile;
      source = 'pdf';
    }

    if (!xml) return errorResponse(res, 400, 'MISSING_DOCUMENT', 'Provide XML or pdfBase64.');

    const result = await validateXsd(xml, profile);
    return res.status(200).json({
      success: true,
      valid: result.valid,
      profile: String(body.profile || 'en16931'),
      source,
      filename,
      detectedProfile,
      checks: {
        xmlWellFormed: true,
        facturXProfileXsd: result.valid
      },
      errors: result.errors || [],
      note: 'XSD validation is authoritative for the selected Factur-X profile. French BR-FR/2026 CIUS validation is a separate rule layer and is not inferred from XSD success.'
    });
  } catch (error) {
    return errorResponse(res, 422, 'VALIDATION_FAILED', error instanceof Error ? error.message : String(error));
  }
}
