import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { extract, generate } from '@stafyniaksacha/facturx';

test('Factur-X packaging emits PDF/A-3 metadata and retains extractable CII XML', async () => {
  const xml = await readFile(new URL('./fixtures/factur-x-en16931.xml', import.meta.url), 'utf8');
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const sourcePdf = Buffer.from(await source.save());

  const output = Buffer.from(await generate({ pdf: sourcePdf, xml }));
  assert.equal(output.subarray(0, 5).toString(), '%PDF-');

  const metadata = output.toString('latin1');
  assert.match(metadata, /<pdfaid:part>\s*3\s*<\/pdfaid:part>/i);
  assert.match(metadata, /<pdfaid:conformance>\s*[ABU]\s*<\/pdfaid:conformance>/i);

  const extracted = await extract({ pdf: output });
  assert.match(extracted.xml, /CrossIndustryInvoice/);
  assert.match(extracted.xml, /INV-2026-001/);
});
