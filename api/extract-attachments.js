import { PDFDocument } from '@cantoo/pdf-lib';
import { errorResponse, handleOptions, methodNotAllowed, parseJsonBody, prepareResponse } from '../lib/http.js';

const MAX_BYTES = 12 * 1024 * 1024;

function decodeBase64(value) {
  if (typeof value !== 'string' || !value) throw new Error('base64 data is required.');
  const buffer = Buffer.from(value, 'base64');
  if (!buffer.length || buffer.length > MAX_BYTES) throw new Error('Uploaded PDF is empty or too large.');
  if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new Error('The uploaded file is not a PDF.');
  return buffer;
}

function toBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

export default async function handler(req, res) {
  prepareResponse(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST, OPTIONS');

  const body = parseJsonBody(req);
  if (!body || typeof body.pdfBase64 !== 'string') {
    return errorResponse(res, 400, 'MISSING_PDF', 'pdfBase64 is required.');
  }

  try {
    const pdf = await PDFDocument.load(decodeBase64(body.pdfBase64), {
      ignoreEncryption: false,
      updateMetadata: false
    });
    const source = pdf.getAttachments();
    const entries = Array.isArray(source)
      ? source.map(attachment => [attachment.name, attachment])
      : Object.entries(source);
    const attachments = entries.map(([name, attachment]) => ({
      name,
      mimeType: attachment.mimeType || 'application/octet-stream',
      size: attachment.data.length,
      dataBase64: toBase64(attachment.data)
    }));

    return res.status(200).json({ success: true, count: attachments.length, attachments });
  } catch (error) {
    return errorResponse(res, 422, 'ATTACHMENT_EXTRACTION_FAILED', error instanceof Error ? error.message : String(error));
  }
}
