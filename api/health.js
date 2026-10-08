import { handleOptions, methodNotAllowed, prepareResponse } from '../lib/http.js';

export default async function handler(req, res) {
  const requestId = prepareResponse(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET, OPTIONS');

  return res.status(200).json({
    success: true,
    service: 'x-facture-api',
    status: 'ok',
    version: 'v1',
    requestId,
    timestamp: new Date().toISOString()
  });
}
