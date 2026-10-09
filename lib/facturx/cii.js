/**
 * X-Facture-owned CII D22B invoice serializer.
 * Kept independent from PDF/A-3 packaging and XML validation.
 */
const NS = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100'
};
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const text = (v) => typeof v === 'string' ? v.trim() : '';
const tag = (n, v, attrs = '') => v === undefined || v === null || v === '' ? '' : `<${n}${attrs}>${esc(v)}</${n}>`;
const money = (v) => Number(v || 0).toFixed(2);
const id = (n, v, scheme) => tag(n, v, scheme ? ` schemeID="${esc(scheme)}"` : '');

function address(party) {
  const a = party?.address || {};
  const inner = tag('ram:PostcodeCode', a.postalCode) + tag('ram:LineOne', a.line1) +
    tag('ram:LineTwo', a.line2) + tag('ram:CityName', a.city) + tag('ram:CountryID', a.country);
  return inner ? `<ram:PostalTradeAddress>${inner}</ram:PostalTradeAddress>` : '';
}
function party(p) {
  const org = p?.legalOrganization;
  const gid = p?.globalId;
  const tax = (Array.isArray(p?.taxRegistrations) ? p.taxRegistrations : []).map(t =>
    t?.id ? `<ram:SpecifiedTaxRegistration>${id('ram:ID', t.id, t.schemeId)}</ram:SpecifiedTaxRegistration>` : ''
  ).join('');
  const endpoint = p?.electronicAddress?.value && p?.electronicAddress?.schemeID
    ? `<ram:URIUniversalCommunication>${id('ram:URIID', p.electronicAddress.value, p.electronicAddress.schemeID)}</ram:URIUniversalCommunication>`
    : '';
  return tag('ram:Name', p?.name) +
    (org?.id ? `<ram:SpecifiedLegalOrganization>${id('ram:ID', org.id, org.schemeID)}</ram:SpecifiedLegalOrganization>` : '') +
    (gid?.value ? `<ram:GlobalID${gid.schemeID ? ` schemeID="${esc(gid.schemeID)}"` : ''}>${esc(gid.value)}</ram:GlobalID>` : '') +
    address(p) + endpoint + tax;
}
function lineXml(line) {
  const rate = Number(line.vatRatePercent || 0);
  const category = line.vatCategoryCode || 'S';
  return `<ram:IncludedSupplyChainTradeLineItem>
    <ram:AssociatedDocumentLineDocument><ram:LineID>${esc(line.id)}</ram:LineID></ram:AssociatedDocumentLineDocument>
    <ram:SpecifiedTradeProduct><ram:Name>${esc(line.name)}</ram:Name></ram:SpecifiedTradeProduct>
    <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${money(line.unitPrice)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
    <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${esc(line.unitCode || 'C62')}">${Number(line.quantity).toString()}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
    <ram:SpecifiedLineTradeSettlement><ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${esc(category)}</ram:CategoryCode><ram:RateApplicablePercent>${money(rate)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
    <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${money(line.lineTotal)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement>
  </ram:IncludedSupplyChainTradeLineItem>`;
}

export function invoiceToCiiXml(invoice) {
  if (!invoice?.document || !invoice?.seller || !invoice?.buyer || !Array.isArray(invoice.lines) || !invoice.lines.length) {
    throw new TypeError('A normalized invoice model with at least one line is required.');
  }
  const d = invoice.document;
  const t = invoice.totals || {};
  const currency = text(t.currency) || 'EUR';
  const issueDate = text(d.issueDate).replace(/-/g, '');
  if (!/^\\d{8}$/.test(issueDate)) throw new Error('Issue date must be YYYY-MM-DD.');
  const dueDate = text(d.dueDate).replace(/-/g, '');
  const dueDateXml = /^\\d{8}$/.test(dueDate)
    ? `<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">${dueDate}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>` : '';
  const taxes = (Array.isArray(invoice.vatBreakdown) ? invoice.vatBreakdown : []).map(g =>
    `<ram:ApplicableTradeTax><ram:CalculatedAmount>${money(g.taxAmount)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode><ram:BasisAmount>${money(g.taxableAmount)}</ram:BasisAmount><ram:CategoryCode>${esc(g.categoryCode || 'S')}</ram:CategoryCode><ram:RateApplicablePercent>${money(g.ratePercent)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>`
  ).join('');
  const payment = invoice.payment?.iban ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>${esc(invoice.payment.meansCode || '58')}</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${esc(invoice.payment.iban)}</ram:IBANID>${invoice.payment.bic ? `<ram:PayeeSpecifiedCreditorFinancialInstitution><ram:BICID>${esc(invoice.payment.bic)}</ram:BICID></ram:PayeeSpecifiedCreditorFinancialInstitution>` : ''}</ram:PayeePartyCreditorFinancialAccount></ram:SpecifiedTradeSettlementPaymentMeans>` : '';
  const delivery = invoice.delivery ? `<ram:ApplicableHeaderTradeDelivery>${/^\\d{8}$/.test(text(invoice.delivery.date).replace(/-/g, '')) ? `<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${esc(invoice.delivery.date.replace(/-/g, ''))}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>` : ''}</ram:ApplicableHeaderTradeDelivery>` : '<ram:ApplicableHeaderTradeDelivery/>';
  const prepaid = Math.max(0, Number(t.grandTotal || 0) - Number(t.duePayableAmount || 0));
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="${NS.rsm}" xmlns:ram="${NS.ram}" xmlns:udt="${NS.udt}">
 <rsm:ExchangedDocumentContext><ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter></rsm:ExchangedDocumentContext>
 <rsm:ExchangedDocument><ram:ID>${esc(d.id)}</ram:ID><ram:TypeCode>${esc(d.typeCode || '380')}</ram:TypeCode><ram:IssueDateTime><udt:DateTimeString format="102">${issueDate}</udt:DateTimeString></ram:IssueDateTime></rsm:ExchangedDocument>
 <rsm:SupplyChainTradeTransaction>
 ${invoice.lines.map(lineXml).join('')}
 <ram:ApplicableHeaderTradeAgreement><ram:SellerTradeParty>${party(invoice.seller)}</ram:SellerTradeParty><ram:BuyerTradeParty>${party(invoice.buyer)}</ram:BuyerTradeParty>${tag('ram:BuyerReference', d.buyerReference)}</ram:ApplicableHeaderTradeAgreement>
 ${delivery}
 <ram:ApplicableHeaderTradeSettlement><ram:InvoiceCurrencyCode>${esc(currency)}</ram:InvoiceCurrencyCode>${payment}${taxes}${dueDateXml}
 <ram:SpecifiedTradeSettlementHeaderMonetarySummation><ram:LineTotalAmount>${money(t.lineTotal)}</ram:LineTotalAmount><ram:TaxBasisTotalAmount>${money(t.taxBasisTotal)}</ram:TaxBasisTotalAmount><ram:TaxTotalAmount currencyID="${esc(currency)}">${money(t.taxTotal)}</ram:TaxTotalAmount><ram:GrandTotalAmount>${money(t.grandTotal)}</ram:GrandTotalAmount><ram:TotalPrepaidAmount>${money(prepaid)}</ram:TotalPrepaidAmount><ram:DuePayableAmount>${money(t.duePayableAmount)}</ram:DuePayableAmount></ram:SpecifiedTradeSettlementHeaderMonetarySummation>
 </ram:ApplicableHeaderTradeSettlement>
 </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}
