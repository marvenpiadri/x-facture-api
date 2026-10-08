import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import generateInvoiceHandler from '../api/generate-invoice.js';
import validateHandler from '../api/validate.js';

test('Factur-X generation returns a PDF artifact', async () => {
  const htmlLayout = '<html><head><style>body{font-family:Arial,sans-serif}</style></head><body><h1>Print test</h1><p>Invoice FX-PRINT-TEST-001</p></body></html>';
  const rawInvoiceData = {
    id: 'FX-PRINT-TEST-001',
    date: '2026-10-08',
    deliveryDate: '2026-10-08',
    deliveryAddressLine1: '25 Avenue Exemple',
    deliveryCity: 'Lyon',
    deliveryPostalCode: '69001',
    deliveryCountry: 'FR',
    currency: 'EUR',
    sellerName: 'X Facture Test SARL',
    seller: { name: 'X Facture Test SARL', address: { line1: '10 Rue de Test', city: 'Paris', postalCode: '75001', country: 'FR' } },
    buyer: { name: 'Example Customer', address: { line1: '25 Avenue Exemple', city: 'Lyon', postalCode: '69001', country: 'FR' } },
    items: [{ description: 'Consulting service', quantity: 2, unitPrice: 100, vatRate: 20, unitCode: 'C62' }]
  };
  const req = { method: 'POST', headers: {}, body: { htmlLayout, rawInvoiceData, paperSize: 'a4' } };
  const res = { statusCode: 200, headers: {}, body: undefined, setHeader(k,v){this.headers[k]=v;return this;}, status(c){this.statusCode=c;return this;}, json(v){this.body=v;return this;}, send(v){this.body=v;return this;}, end(){return this;} };
  await generateInvoiceHandler(req, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.ok(Buffer.isBuffer(res.body));
  assert.equal(res.body.subarray(0, 5).toString(), '%PDF-');
  const pdf = await PDFDocument.load(res.body);
  assert.ok(pdf.getPageCount() > 0);
  const validationReq = { method: 'POST', headers: {}, body: { pdfBase64: res.body.toString('base64'), profile: 'en16931' } };
  const validationRes = { statusCode: 200, body: undefined, setHeader(){return this;}, status(c){this.statusCode=c;return this;}, json(v){this.body=v;return this;}, end(){return this;} };
  await validateHandler(validationReq, validationRes);
  assert.equal(validationRes.statusCode, 200, JSON.stringify(validationRes.body));
  assert.equal(validationRes.body.source, 'pdf');
  assert.equal(validationRes.body.valid, true, JSON.stringify(validationRes.body.errors));
  assert.equal(validationRes.body.checks.facturXProfileXsd, true);
  assert.equal(validationRes.body.checks.en16931BusinessRules, true);
  assert.equal(validationRes.body.checks.schematron, true);
});
