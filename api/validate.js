import { check, extract } from '@stafyniaksacha/facturx';
import { errorResponse, handleOptions, methodNotAllowed, parseJsonBody, prepareResponse } from '../lib/http.js';

const MAX_BYTES = 12 * 1024 * 1024;

const profiles = new Map([
  ['minimum', { level: 'minimum' }],
  ['basic-wl', { level: 'basicwl' }],
  ['basicwl', { level: 'basicwl' }],
  ['basic', { level: 'basic' }],
  ['en16931', { level: 'en16931' }],
  ['extended', { level: 'extended' }]
]);

function decodeBase64(value) {
  if (typeof value !== 'string' || !value) throw new Error('base64 data is required.');
  const buffer = Buffer.from(value, 'base64');
  if (!buffer.length || buffer.length > MAX_BYTES) throw new Error('Uploaded data is empty or too large.');
  return buffer;
}

function uniqueErrors(...groups) {
  const seen = new Set();
  return groups.flatMap(group => Array.isArray(group) ? group : []).filter(error => {
    const key = typeof error === 'string' ? error : JSON.stringify(error);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default async function handler(req, res) {
  prepareResponse(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST, OPTIONS');

  const body = parseJsonBody(req);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorResponse(res, 400, 'INVALID_JSON', 'Request body must be an object.');
  }

  const requestedProfile = String(body.profile || 'en16931').trim().toLowerCase();
  const profile = profiles.get(requestedProfile);
  if (!profile) {
    return errorResponse(res, 400, 'INVALID_PROFILE', 'profile must be minimum, basic-wl, basic, en16931, or extended.');
  }

  try {
    let xml = typeof body.xml === 'string' ? body.xml : '';
    let source = 'xml';
    let filename = 'factur-x.xml';
    let detectedProfile;

    if (!xml && body.pdfBase64) {
      const pdf = decodeBase64(body.pdfBase64);
      const extracted = await extract({ pdf, flavor: 'facturx' });
      xml = extracted.xml;
      filename = extracted.filename || filename;
      const detected = await check({ xml, flavor: 'facturx' });
      detectedProfile = detected.level;
      source = 'pdf';
    }

    if (!xml.trim()) return errorResponse(res, 400, 'MISSING_DOCUMENT', 'Provide XML or pdfBase64.');

    const shouldRunBusinessRules = ['en16931', 'extended'].includes(profile.level);
    let validation;
    try {
      validation = await check({
        xml,
        flavor: 'facturx',
        level: profile.level,
        schematron: shouldRunBusinessRules
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const engineUnavailable = /ENOENT|EACCES|ERR_MODULE_NOT_FOUND|WebAssembly|\\bwasm\\b|failed to initialize|could not initialize|schema file.{0,40}not found|cannot (?:open|read|load).{0,40}(?:xsd|schema|schematron)/i.test(detail);

      if (engineUnavailable) {
        return errorResponse(
          res,
          503,
          'VALIDATION_ENGINE_UNAVAILABLE',
          'The Factur-X XML validation engine could not complete.',
          detail
        );
      }

      return errorResponse(
        res,
        422,
        'INVALID_DOCUMENT',
        detail || 'The document could not be validated against the selected Factur-X profile.'
      );
    }

    const errors = uniqueErrors(validation.errors, validation.schematronErrors);
    const xsdValid = Array.isArray(validation.errors) && validation.errors.length === 0;
    const businessRulesValid = shouldRunBusinessRules && validation.schematronValid !== undefined
      ? Boolean(validation.schematronValid)
      : null;

    return res.status(200).json({
      success: true,
      valid: Boolean(validation.valid),
      profile: requestedProfile === 'basicwl' ? 'basic-wl' : requestedProfile,
      source,
      filename,
      detectedProfile,
      checks: {
        xmlWellFormed: true,
        facturXProfileXsd: Boolean(xsdValid),
        en16931BusinessRules: businessRulesValid,
        schematron: shouldRunBusinessRules ? validation.schematronValid ?? null : null
      },
      errors,
      french2026: {
        status: 'readiness-layer',
        message: 'French BR-FR and 2026 mandate checks are not included in this generic EN 16931 validation result.'
      }
    });
  } catch (error) {
    return errorResponse(res, 422, 'VALIDATION_FAILED', error instanceof Error ? error.message : String(error));
  }
}
