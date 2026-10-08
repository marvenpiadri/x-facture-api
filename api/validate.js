import { extractXml, validateXsd, Profile } from '@stackforge-eu/factur-x';
import { check } from '@stafyniaksacha/facturx';
import { errorResponse, handleOptions, methodNotAllowed, parseJsonBody, prepareResponse } from '../lib/http.js';

const MAX_BYTES = 12 * 1024 * 1024;

const profiles = new Map([
  ['minimum', { schema: Profile.MINIMUM, level: 'minimum' }],
  ['basic-wl', { schema: Profile.BASIC_WL, level: 'basicwl' }],
  ['basicwl', { schema: Profile.BASIC_WL, level: 'basicwl' }],
  ['basic', { schema: Profile.BASIC, level: 'basic' }],
  ['en16931', { schema: Profile.EN16931, level: 'en16931' }],
  ['extended', { schema: Profile.EXTENDED, level: 'extended' }]
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
      const extracted = await extractXml(pdf);
      xml = extracted.xml;
      filename = extracted.filename || filename;
      detectedProfile = extracted.profile;
      source = 'pdf';
    }

    if (!xml.trim()) return errorResponse(res, 400, 'MISSING_DOCUMENT', 'Provide XML or pdfBase64.');

    const xsd = await validateXsd(xml, profile.schema);
    const shouldRunBusinessRules = ['en16931', 'extended'].includes(profile.level);
    let businessRules = null;

    if (xsd.valid && shouldRunBusinessRules) {
      try {
        businessRules = await check({
          xml,
          flavor: 'facturx',
          level: profile.level,
          schematron: true
        });
      } catch (error) {
        return errorResponse(
          res,
          503,
          'BUSINESS_RULES_UNAVAILABLE',
          'The XML passed profile XSD validation, but the EN 16931 Schematron check could not complete.',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    const errors = uniqueErrors(
      xsd.errors,
      businessRules?.errors,
      businessRules?.schematronErrors
    );

    return res.status(200).json({
      success: true,
      valid: Boolean(xsd.valid && (!shouldRunBusinessRules || (businessRules?.valid && businessRules?.schematronValid !== false))),
      profile: requestedProfile === 'basicwl' ? 'basic-wl' : requestedProfile,
      source,
      filename,
      detectedProfile,
      checks: {
        xmlWellFormed: true,
        facturXProfileXsd: Boolean(xsd.valid),
        en16931BusinessRules: shouldRunBusinessRules && businessRules ? Boolean(businessRules.valid) : null,
        schematron: shouldRunBusinessRules && businessRules ? businessRules.schematronValid ?? null : null
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
