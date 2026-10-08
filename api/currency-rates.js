import axios from 'axios';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

  try {
    const targetUrl = `https://er-api.com`;
    const response = await axios.get(targetUrl);

    // Caches conversion rates at Vercel Edge networks for 1 hour
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    res.setHeader('Content-Type', 'application/json');
    
    return res.status(200).json({
      success: true,
      base: response.data.base_code,
      rates: response.data.rates,
      updated: response.data.time_last_update_utc
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to sync exchange metrics' });
  }
}

