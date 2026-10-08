import { check } from '@stafyniaksacha/facturx';
import { errorResponse, handleOptions, methodNotAllowed, parseJsonBody, prepareResponse } from '../lib/http.js';

export default async function handler(req, res) {
  prepareResponse(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST, OPTIONS');
  const body = parseJsonBody(req);
  if (!body || typeof body.xml !== 'string' || !body.xml.trim()) {
    return errorResponse(res, 400, 'MISSING_XML', 'xml is required.');
  }
  try {
    const level = typeof body.level === 'string' && ['basic', 'comfort', 'extended'].includes(body.level) ? body.level : undefined;
    const result = await check({ xml: body.xml, flavor: 'orderx', level });
    return res.status(200).json({
      success: true,
      valid: result.valid,
      errors: result.errors || [],
      flavor: result.flavor || 'orderx',
      level: result.level || level || 'autodetect'
    });
  } catch (error) {
    return errorResponse(res, 422, 'ORDER_X_VALIDATION_FAILED', error instanceof Error ? error.message : String(error));
  }
}
