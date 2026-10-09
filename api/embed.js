import { check, generate } from '@stafyniaksacha/facturx';
import { errorResponse, handleOptions, methodNotAllowed, parseJsonBody, prepareResponse } from '../lib/http.js';

const MAX_BYTES = 12 * 1024 * 1024;
const profiles = new Map([
  ['minimum', 'minimum'],
  ['basic-wl', 'basicwl'],
  ['basicwl', 'basicwl'],
  ['basic', 'basic'],
  ['en16931', 'en16931'],
  ['extended', 'extended']
]);

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
  if (!body || typeof body !== 'object' || typeof body.pdfBase64 !== 'string' || typeof body.xml !== 'string') {
    return errorResponse(res, 400, 'MISSING_INPUT', 'pdfBase64 and xml are required.');
  }

  const requestedProfile = String(body.profile || 'en16931').trim().toLowerCase();
  const profile = profiles.get(requestedProfile);
  if (!profile) {
    return errorResponse(res, 400, 'INVALID_PROFILE', 'profile must be minimum, basic-wl, basic, en16931, or extended.');
  }

  try {
    const pdf = decodePdf(body.pdfBase64);
    if (!body.xml.trim()) return errorResponse(res, 400, 'MISSING_XML', 'xml must not be empty.');

    const runBusinessRules = profile === 'en16931' || profile === 'extended';
    const validation = await check({
      xml: body.xml,
      flavor: 'facturx',
      level: profile,
      schematron: runBusinessRules
    });
    if (!validation.valid) {
      const issues = [
        ...(Array.isArray(validation.errors) ? validation.errors : []),
        ...(Array.isArray(validation.schematronErrors) ? validation.schematronErrors : [])
      ];
      return errorResponse(
        res,
        422,
        'INVALID_XML',
        'The XML does not pass validation for the selected Factur-X profile.',
        issues
      );
    }

    const output = Buffer.from(await generate({
      pdf,
      xml: body.xml,
      flavor: 'facturx',
      level: profile,
      check: false
    }));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', String(output.length));
    res.setHeader('Content-Disposition', 'attachment; filename="factur-x.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(output);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const engineUnavailable = /ENOENT|EACCES|ERR_MODULE_NOT_FOUND|WebAssembly|\\bwasm\\b|failed to initialize|could not initialize|schema file.{0,40}not found/i.test(detail);
    return errorResponse(
      res,
      engineUnavailable ? 503 : 422,
      engineUnavailable ? 'FACTURX_ENGINE_UNAVAILABLE' : 'EMBED_FAILED',
      engineUnavailable ? 'The Factur-X processing engine could not complete.' : detail
    );
  }
}
