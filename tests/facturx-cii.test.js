import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceToCiiXml } from '../lib/facturx/cii.js';

const invoice = {
  document: { id: 'INV-2026-001', issueDate: '2026-10-09', typeCode: '380', dueDate: '2026-10-30' },
  seller: {
    name: 'A & B Services',
    address: { line1: '10 Rue <Centre>', city: 'Paris', postalCode: '75001', country: 'FR' },
    legalOrganization: { id: '123456789', schemeID: '0002' },
    globalId: { value: '12345678901234', schemeID: '0009' },
    taxRegistrations: [{ id: 'FR12345678901', schemeId: 'VA' }],
    electronicAddress: { value: '123456789', schemeID: '0225' }
  },
  buyer: { name: 'Buyer Co', address: { city: 'Lyon', country: 'FR' }, taxRegistrations: [] },
  lines: [{
    id: '1', name: 'Consulting & delivery', quantity: 2, unitCode: 'C62',
    unitPrice: 50, lineTotal: 100, vatCategoryCode: 'S', vatRatePercent: 20
  }],
  vatBreakdown: [{ categoryCode: 'S', ratePercent: 20, taxableAmount: 100, taxAmount: 20 }],
  totals: { lineTotal: 100, taxBasisTotal: 100, taxTotal: 20, grandTotal: 120, duePayableAmount: 120, currency: 'EUR' }
};

test('serializes a normalized invoice as CII D22B XML', () => {
  const xml = invoiceToCiiXml(invoice);
  assert.match(xml, /CrossIndustryInvoice/);
  assert.match(xml, /urn:cen\.eu:en16931:2017/);
  assert.match(xml, /<ram:ID>INV-2026-001<\/ram:ID>/);
  assert.match(xml, /<ram:GlobalID schemeID="0009">12345678901234<\/ram:GlobalID>/);
  assert.match(xml, /<ram:URIID schemeID="0225">123456789<\/ram:URIID>/);
  assert.match(xml, /A &amp; B Services/);
  assert.match(xml, /10 Rue &lt;Centre&gt;/);
  assert.match(xml, /<ram:TaxTotalAmount currencyID="EUR">20\.00<\/ram:TaxTotalAmount>/);
});

test('rejects missing invoice model and invalid issue date', () => {
  assert.throws(() => invoiceToCiiXml({}), /normalized invoice model/);
  assert.throws(() => invoiceToCiiXml({ ...invoice, document: { ...invoice.document, issueDate: 'not-a-date' } }), /Issue date/);
});
