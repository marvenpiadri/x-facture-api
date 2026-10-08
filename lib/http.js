import { randomUUID } from 'node:crypto';

export function requestId(req) {
  return req.headers['x-request-id'] || randomUUID();
}

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
  res.setHeader('Vary', 'Origin');
}

export function prepareResponse(req, res) {
  const id = requestId(req);
  setCors(res);
  res.setHeader('X-Request-Id', id);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return id;
}

export function handleOptions(req, res) {
  if (req.method !== 'OPTIONS') return false;
  res.status(204).end();
  return true;
}

export function methodNotAllowed(res, allow) {
  res.setHeader('Allow', allow);
  return res.status(405).json({
    success: false,
    error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' }
  });
}

export function errorResponse(res, status, code, message, details = undefined) {
  return res.status(status).json({
    success: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details })
    }
  });
}

export function parseJsonBody(req) {
  if (!req.body) return null;
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return null;
  }
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function clampText(value, max) {
  return typeof value === 'string' && value.length <= max;
}
