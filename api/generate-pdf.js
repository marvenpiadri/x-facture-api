import {
  errorResponse,
  handleOptions,
  isPlainObject,
  methodNotAllowed,
  parseJsonBody,
  prepareResponse
} from '../lib/http.js';
import { renderPdf } from '../lib/pdf-renderer.js';

const MAX_HTML_BYTES = 1_500_000;

export default async function handler(req, res) {
  prepareResponse(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST, OPTIONS');

  const body = parseJsonBody(req);
  if (!isPlainObject(body)) {
    return errorResponse(res, 400, 'INVALID_JSON', 'Request body must be a JSON object.');
  }

  const htmlLayout = typeof body.htmlLayout === 'string' ? body.htmlLayout : '';
  if (!htmlLayout) {
    return errorResponse(res, 400, 'MISSING_HTML', 'htmlLayout is required.');
  }

  if (Buffer.byteLength(htmlLayout, 'utf8') > MAX_HTML_BYTES) {
    return errorResponse(res, 413, 'HTML_TOO_LARGE', 'htmlLayout exceeds the 1.5 MB limit.');
  }

  const paperSize = typeof body.paperSize === 'string'
    ? body.paperSize.toLowerCase()
    : 'a4';

  if (!['a4', 'letter'].includes(paperSize)) {
    return errorResponse(res, 400, 'INVALID_PAPER_SIZE', 'paperSize must be either a4 or letter.');
  }

  try {
    const pdf = await renderPdf(htmlLayout, paperSize);\n    if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 5).toString() !== '%PDF-') {\n      throw Object.assign(new Error('PDF renderer returned invalid PDF bytes.'), { phase: 'pdf-validation' });\n    }\n    res.setHeader('Content-Length', String(pdf.length));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="document.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(pdf);
  } catch (error) {
    const phase = error?.phase || 'pdf-generation';
    const message = error instanceof Error ? error.message : String(error);
    console.error('generate-pdf:', { phase, error });

    return errorResponse(
      res,
      500,
      'PDF_GENERATION_FAILED',
      message || 'The PDF could not be generated.',
      { phase }
    );
  }
}
