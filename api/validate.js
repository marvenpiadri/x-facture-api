import { extractXml, validateXsd, Profile } from '@stackforge-eu/factur-x';
import { check } from '@stafyniaksacha/facturx';
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
    let businessRules = null;
    try {
      businessRules = await check({ xml, schematron: true });
    } catch {
      businessRules = null;
    }
    const errors = [...(result.errors || []), ...((businessRules && Array.isArray(businessRules.errors)) ? businessRules.errors : [])];
    return res.status(200).json({
      success: true,
      valid: result.valid && (businessRules ? businessRules.valid && businessRules.schematronValid !== false : true),
      profile: String(body.profile || 'en16931'),
      source,
      filename,
      detectedProfile,
      checks: {
        xmlWellFormed: true,
        facturXProfileXsd: result.valid,
        en16931BusinessRules: businessRules ? businessRules.valid : null,
        schematron: businessRules ? businessRules.schematronValid : null
      },
      errors,
      french2026: {
        status: 'readiness-layer',
        message: 'French BR-FR/2026 CIUS checks are tracked separately from the generic EN 16931 Schematron layer.'
      }
    });
  } catch (error) {
    return errorResponse(res, 422, 'VALIDATION_FAILED', error instanceof Error ? error.message : String(error));
  }
}
