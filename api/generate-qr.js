import QRCode from 'qrcode';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

  const { text } = req.query;
  if (!text) return res.status(400).send('Missing "text" query parameter');

  try {
    const qrSvgString = await QRCode.toString(text, {
      type: 'svg',
      margin: 1,
      color: { dark: '#000000', light: '#FFFFFF' }
    });

    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable'); // Cache on Edge for 24h
    return res.status(200).send(qrSvgString);
  } catch (error) {
    return res.status(500).send('QR Generation Failed');
  }
}
