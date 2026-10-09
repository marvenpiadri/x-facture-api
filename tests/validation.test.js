import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { check, generate } from '@stafyniaksacha/facturx';
import { PDFDocument } from 'pdf-lib';
import validateHandler from '../api/validate.js';
import extractHandler from '../api/extract.js';
import embedHandler from '../api/embed.js';
import validateOrderXHandler from '../api/validate-order-x.js';
import { buildInvoiceInput } from '../api/generate-invoice.js';

const facturXXml = await readFile(new URL('./fixtures/factur-x-en16931.xml', import.meta.url), 'utf8');
const facturXMinimumXml = await readFile(new URL('./fixtures/factur-x-minimum.xml', import.meta.url), 'utf8');
const orderXXml = await readFile(new URL('./fixtures/order-x-basic.xml', import.meta.url), 'utf8');

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    end() { return this; }
  };
}

test('Factur-X fixture passes XSD and EN 16931 Schematron', async () => {
  const result = await check({ xml: facturXXml, flavor: 'facturx', level: 'en16931', schematron: true });
  assert.equal(result.valid, true, JSON.stringify({ errors: result.errors, schematronErrors: result.schematronErrors }));
  assert.equal(result.schematronValid, true);
});

test('Order-X fixture passes the official Order-X XSD', async () => {
  const result = await check({ xml: orderXXml, flavor: 'orderx', level: 'basic' });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.flavor, 'orderx');
});

test('malformed XML is rejected by the validation engine', async () => {
  let valid = false;
  try {
    const result = await check({ xml: '<CrossIndustryInvoice><broken>', flavor: 'facturx', level: 'en16931' });
    valid = result.valid;
  } catch {
    valid = false;
  }
  assert.equal(valid, false);
});

test('Factur-X API endpoint returns detailed validation checks for valid CII', async () => {
  const req = { method: 'POST', headers: {}, body: { xml: facturXXml, profile: 'en16931' } };
  const res = mockResponse();
  await validateHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.valid, true, JSON.stringify(res.body.errors));
  assert.equal(res.body.checks.facturXProfileXsd, true);
  assert.equal(res.body.checks.en16931BusinessRules, true);
  assert.equal(res.body.checks.schematron, true);
});

test('Order-X API endpoint validates a real Order-X document', async () => {
  const req = { method: 'POST', headers: {}, body: { xml: orderXXml, level: 'basic' } };
  const res = mockResponse();
  await validateOrderXHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.valid, true, JSON.stringify(res.body.errors));
  assert.equal(res.body.flavor, 'orderx');
  assert.equal(res.body.level, 'basic');
});

test('well-formed XML with the wrong document root fails schema validation', async () => {
  const req = { method: 'POST', headers: {}, body: { xml: '<NotAnInvoice/>', profile: 'en16931' } };
  const res = mockResponse();
  await validateHandler(req, res);
  assert.ok(res.statusCode === 200 || res.statusCode === 422);
  assert.ok(res.body.valid === false || res.body.success === false);
  if (res.body.checks) assert.equal(res.body.checks.facturXProfileXsd, false);
});

test('unknown validation profiles are rejected explicitly', async () => {
  const req = { method: 'POST', headers: {}, body: { xml: facturXXml, profile: 'not-a-profile' } };
  const res = mockResponse();
  await validateHandler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'INVALID_PROFILE');
});

test('minimum-profile invoices are validated against their XSD without EN 16931-only rules', async () => {
  const req = { method: 'POST', headers: {}, body: { xml: facturXMinimumXml, profile: 'minimum' } };
  const res = mockResponse();
  await validateHandler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.valid, true, JSON.stringify(res.body.errors));
  assert.equal(res.body.checks.facturXProfileXsd, true);
  assert.equal(res.body.checks.en16931BusinessRules, null);
  assert.equal(res.body.checks.schematron, null);
});


test('Factur-X input defaults a missing issue date to today and preserves identifier schemes', () => {
  const invoice = buildInvoiceInput({
    id: 'INV-TEST-1',
    currency: 'EUR',
    items: [{ description: 'Service', quantity: 1, unitPrice: 100, vatRate: 20 }],
    seller: {
      name: 'French seller',
      country: 'FR',
      taxIdentifiers: [
        { id: 'siren', type: 'SIREN', value: '123456789', schemeId: '0002' },
        { id: 'siret', type: 'SIRET', value: '12345678900012', schemeId: '0009' },
        { id: 'vat', type: 'VAT', value: 'FR12123456789' }
      ],
      electronicAddress: '123456789',
      electronicAddressScheme: '0225'
    },
    buyer: {
      name: 'French buyer',
      country: 'FR',
      taxIdentifiers: [{ id: 'buyer-siren', type: 'SIREN', value: '987654321', schemeId: '0002' }],
      electronicAddress: '987654321',
      electronicAddressScheme: '0225'
    }
  });

  assert.match(invoice.document.issueDate, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
  assert.equal(invoice.seller.legalOrganization.id, '123456789');
  assert.equal(invoice.seller.legalOrganization.schemeID, '0002');
  assert.equal(invoice.seller.globalId.value, '12345678900012');
  assert.equal(invoice.seller.globalId.schemeID, '0009');
  assert.equal(invoice.seller.taxRegistrations[0].schemeId, 'VA');
  assert.deepEqual(invoice.seller.electronicAddress, { value: '123456789', schemeID: '0225' });
  assert.deepEqual(invoice.buyer.electronicAddress, { value: '987654321', schemeID: '0225' });
});

test('Factur-X input rejects impossible issue dates', () => {
  assert.throws(() => buildInvoiceInput({
    id: 'INV-TEST-2',
    issueDate: '2026-02-30',
    items: [{ description: 'Service', quantity: 1, unitPrice: 10, vatRate: 0 }]
  }), /real calendar date/);
});


test('Factur-X PDF upload is extracted and validated by the API endpoint', async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const sourcePdf = Buffer.from(await source.save());
  const pdf = Buffer.from(await generate({ pdf: sourcePdf, xml: facturXXml }));

  const req = {
    method: 'POST',
    headers: {},
    body: { pdfBase64: pdf.toString('base64'), profile: 'en16931' }
  };
  const res = mockResponse();
  await validateHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.source, 'pdf');
  assert.equal(res.body.valid, true, JSON.stringify(res.body.errors));
  assert.equal(res.body.checks.facturXProfileXsd, true);
  assert.equal(res.body.checks.en16931BusinessRules, true);
});

test('malformed XML produces a readable validation failure response', async () => {
  const req = { method: 'POST', headers: {}, body: { xml: '<CrossIndustryInvoice><broken>', profile: 'en16931' } };
  const res = mockResponse();
  await validateHandler(req, res);

  assert.equal(res.statusCode, 422, JSON.stringify(res.body));
  assert.equal(res.body.success, false);
  assert.equal(typeof res.body.error.message, 'string');
  assert.ok(res.body.error.message.length > 0);
});


test('Factur-X extraction endpoint returns the embedded XML from a generated PDF', async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const pdf = Buffer.from(await generate({ pdf: Buffer.from(await source.save()), xml: facturXXml }));

  const req = { method: 'POST', headers: {}, body: { pdfBase64: pdf.toString('base64') } };
  const res = mockResponse();
  await extractHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.match(res.body.xml, /CrossIndustryInvoice/);
  assert.equal(res.body.profile, 'en16931');
});

test('embed endpoint validates XML and returns a PDF with extractable invoice XML', async () => {
  const source = await PDFDocument.create();
  source.addPage([595, 842]);
  const sourcePdf = Buffer.from(await source.save());

  const req = {
    method: 'POST',
    headers: {},
    body: { pdfBase64: sourcePdf.toString('base64'), xml: facturXXml, profile: 'en16931' }
  };
  const res = mockResponse();
  await embedHandler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/pdf');
  assert.equal(Buffer.from(res.body).subarray(0, 5).toString(), '%PDF-');

  const extracted = await extract({ pdf: Buffer.from(res.body), flavor: 'facturx' });
  assert.match(extracted.xml, /FA-2017-0010/);
});
