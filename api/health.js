export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method not allowed.'
      }
    });
  }

  return res.status(200).json({
    success: true,
    service: 'x-facture-api',
    status: 'ok',
    version: 'v1',
    timestamp: new Date().toISOString()
  });
}
