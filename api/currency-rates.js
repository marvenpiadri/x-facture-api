import {
  errorResponse,
  handleOptions,
  methodNotAllowed,
  prepareResponse
} from '../lib/http.js';

const CACHE_SECONDS = 3600;
const BASE_URL = 'https://open.er-api.com/v6/latest';

export default async function handler(req, res) {
  prepareResponse(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET, OPTIONS');

  const base = String(req.query?.base || 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(base)) {
    return errorResponse(res, 400, 'INVALID_CURRENCY', 'base must be a 3-letter ISO currency code.');
  }

  try {
    const response = await fetch(`${BASE_URL}/${encodeURIComponent(base)}`, {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}.`);
    const data = await response.json();

    if (data.result !== 'success' || !data.rates) {
      throw new Error('Currency provider returned an invalid response.');
    }

    res.setHeader(
      'Cache-Control',
      `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400`
    );

    return res.status(200).json({
      success: true,
      base: data.base_code,
      rates: data.rates,
      provider: 'ExchangeRate-API',
      updated: data.time_last_update_utc,
      nextUpdate: data.time_next_update_utc
    });
  } catch (error) {
    console.error('currency-rates:', error);
    return errorResponse(res, 502, 'UPSTREAM_ERROR', 'Unable to retrieve exchange rates right now.');
  }
}
