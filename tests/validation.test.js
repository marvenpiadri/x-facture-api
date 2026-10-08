import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { check } from '@stafyniaksacha/facturx';
import validateHandler from '../api/validate.js';
import validateOrderXHandler from '../api/validate-order-x.js';

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
