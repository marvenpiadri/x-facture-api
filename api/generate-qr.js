import QRCode from 'qrcode';
import {
  errorResponse,
  handleOptions,
  methodNotAllowed,
  prepareResponse
} from '../lib/http.js';

const MAX_TEXT_LENGTH = 4096;

export default async function handler(req, res) {
  prepareResponse(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET, OPTIONS');

  const text = typeof req.query?.text === 'string' ? req.query.text : '';
  if (!text) return errorResponse(res, 400, 'MISSING_TEXT', 'Missing "text" query parameter.');
  if (text.length > MAX_TEXT_LENGTH) {
    return errorResponse(res, 413, 'TEXT_TOO_LARGE', `QR content must be ${MAX_TEXT_LENGTH} characters or less.`);
  }

  const format = String(req.query?.format || 'svg').toLowerCase();
  const margin = Number(req.query?.margin ?? 1);
  const errorCorrectionLevel = String(req.query?.ecLevel || 'M').toUpperCase();

  if (!['svg', 'png'].includes(format)) {
    return errorResponse(res, 400, 'INVALID_FORMAT', 'format must be svg or png.');
  }
  if (!Number.isInteger(margin) || margin < 0 || margin > 16) {
    return errorResponse(res, 400, 'INVALID_MARGIN', 'margin must be an integer between 0 and 16.');
  }
  if (!['L', 'M', 'Q', 'H'].includes(errorCorrectionLevel)) {
    return errorResponse(res, 400, 'INVALID_EC_LEVEL', 'ecLevel must be L, M, Q, or H.');
  }

  try {
    const options = {
      margin,
      errorCorrectionLevel,
      color: { dark: '#000000', light: '#FFFFFF' }
    };

    if (format === 'png') {
      const buffer = await QRCode.toBuffer(text, { ...options, type: 'png' });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
      return res.status(200).send(buffer);
    }

    const svg = await QRCode.toString(text, { ...options, type: 'svg' });
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    return res.status(200).send(svg);
  } catch (error) {
    console.error('generate-qr:', error);
    return errorResponse(res, 400, 'QR_GENERATION_FAILED', 'The supplied content could not be encoded as a QR code.');
  }
}
