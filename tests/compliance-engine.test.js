import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInvoiceCompliance } from '../lib/compliance/engine.js';

const baseInvoice = {
  document: { id: 'INV-2026-10', issueDate: '2026-10-09', typeCode: '380' },
  seller: {
    name: 'Seller SARL',
    address: { country: 'FR' },
    taxRegistrations: [{ id: 'FR12123456789', schemeId: 'VA' }],
    legalOrganization: { id: '123456789', schemeID: '0002' },
    electronicAddress: { value: '123456789', schemeID: '0225' }
  },
  buyer: {
    name: 'Buyer SAS',
    address: { country: 'FR' },
    taxRegistrations: [{ id: 'FR12987654321', schemeId: 'VA' }],
    legalOrganization: { id: '987654321', schemeID: '0002' },
    electronicAddress: { value: '987654321', schemeID: '0225' }
  },
  lines: [{ id: '1', name: 'Service', quantity: 1, unitPrice: 100, lineTotal: 100 }],
  totals: { lineTotal: 100, taxTotal: 20, grandTotal: 120, currency: 'EUR' }
};

test('French compliance engine passes well-formed party identifiers and invoice basics', () => {
  const result = validateInvoiceCompliance(baseInvoice);
  assert.equal(result.valid, true);
  assert.equal(result.jurisdiction, 'FR');
  assert.equal(result.rulesetVersion, '2026-10-09.1');
  assert.equal(result.findings.some((item) => item.severity === 'error'), false);
});

test('French compliance engine reports malformed SIREN and SIRET as errors', () => {
  const invoice = structuredClone(baseInvoice);
  invoice.seller.taxIdentifiers = [
    { type: 'SIREN', value: '1234' },
    { type: 'SIRET', value: '123456' }
  ];
  const result = validateInvoiceCompliance(invoice);
  assert.equal(result.valid, false);
  assert.ok(result.findings.some((item) => item.ruleId === 'FR-ID-001' && item.severity === 'error'));
  assert.ok(result.findings.some((item) => item.ruleId === 'FR-ID-002' && item.severity === 'error'));
});

test('routing identifiers are not inferred from tax identifiers', () => {
  const invoice = structuredClone(baseInvoice);
  delete invoice.seller.electronicAddress;
  delete invoice.buyer.electronicAddress;
  const result = validateInvoiceCompliance(invoice);
  assert.ok(result.findings.some((item) => item.ruleId === 'FR-ROUTE-001' && item.severity === 'info'));
  assert.ok(result.findings.some((item) => item.ruleId === 'FR-ROUTE-002' && item.severity === 'info'));
  assert.equal(result.findings.some((item) => item.ruleId.startsWith('FR-ROUTE') && item.severity === 'error'), false);
});

test('French checks do not run for invoices outside France', () => {
  const invoice = structuredClone(baseInvoice);
  invoice.seller.address.country = 'DE';
  invoice.buyer.address.country = 'DE';
  const result = validateInvoiceCompliance(invoice);
  assert.equal(result.jurisdiction, 'DE');
  assert.equal(result.findings.some((item) => item.ruleId.startsWith('FR-')), false);
});

test('common invoice checks reject impossible issue dates and missing lines', () => {
  const invoice = structuredClone(baseInvoice);
  invoice.document.issueDate = '2026-02-30';
  invoice.lines = [];
  const result = validateInvoiceCompliance(invoice);
  assert.equal(result.valid, false);
  assert.ok(result.findings.some((item) => item.ruleId === 'INV-002'));
  assert.ok(result.findings.some((item) => item.ruleId === 'INV-005'));
});
