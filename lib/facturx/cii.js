/**
 * X-Facture CII D22B serializer.
 *
 * This module owns invoice-to-XML mapping. PDF/A-3 packaging and standards
 * validation are intentionally separate concerns.
 */
const NS = {
  rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
  ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
  udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100'
};

const escapeXml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const clean = (value) => typeof value === 'string' ? value.trim() : '';
const tag = (name, value, attrs = '') => value === undefined || value === null || value === ''
  ? '' : `<${name}${attrs}>${escapeXml(value)}</${name}>`;
const amount = (value) => Number(value || 0).toFixed(2);
const quantity = (value) => Number(value || 0).toString();

function idTag(name, value, scheme) {
  if (!value) return '';
  return tag(name, value, scheme ? ` schemeID="${escapeXml(scheme)}"` : '');
}

function addressXml(party) {
  const address = party?.address || {};
  return `<ram:PostalTradeAddress>
    ${tag('ram:PostcodeCode', address.postalCode)}
    ${tag('ram:LineOne', address.line1)}
    ${tag('ram:LineTwo', address.line2)}
    ${tag('ram:CityName', address.city)}
    ${tag('ram:CountryID', address.country)}
  </ram:PostalTradeAddress>`;
}

function partyXml(role, party) {
  const name = clean(party?.name);
  const org = party?.legalOrganization;
  const globalId = party?.globalId;
  const registrations = Array.isArray(party?.taxRegistrations) ? party.taxRegistrations : [];
  const electronic = party?.electronicAddress;
  const endpoint = electronic?.value && electronic?.schemeID
    ? `<ram:URIUniversalCommunication><ram:URIID schemeID="${escapeXml(electronic.schemeID)}">${escapeXml(electronic.value)}</ram:URIID></ram:URIUniversalCommunication>`
    : '';
  const taxXml = registrations.map((registration) =>
    `<ram:SpecifiedTaxRegistration>${idTag('ram:ID', registration.id, registration.schemeId)}</ram:SpecifiedTaxRegistration>`
  ).join('');
  return `<ram:${role}>
    <ram:Name>${escapeXml(name)}</ram:Name>
    <ram:DefinedTradeContact/>
    <ram:SpecifiedLegalOrganization>${idTag('ram:ID', org?.id, org?.schemeID)}</ram:SpecifiedLegalOrganization>
    <ram:GlobalID>${escapeXml(globalId?.value || '')}</ram:GlobalID>
    <ram:PostalTradeAddress>${tag('ram:PostcodeCode', party?.address?.postalCode)}${tag('ram:LineOne', party?.address?.line1)}${tag('ram:LineTwo', party?.address?.line2)}${tag('ram:CityName', party?.address?.city)}${tag('ram:CountryID', party?.address?.country)}</ram:PostalTradeAddress>
    ${endpoint}
    ${taxXml}
  </ram:${role}>`;
}

function taxCategory(rate) {
  if (Number(rate) === 0) return 'Z';
  return 'S';
}

function lineXml(line, currency) {
  const rate = Number(line.vatRatePercent || 0);
  const category = line.vatCategoryCode || taxCategory(rate);
  return `<ram:IncludedSupplyChainTradeLineItem>
    <ram:AssociatedDocumentLineDocument><ram:LineID>${escapeXml(line.id)}</ram:LineID></ram:AssociatedDocumentLineDocument>
    <ram:SpecifiedTradeProduct><ram:Name>${escapeXml(line.name)}</ram:Name></ram:SpecifiedTradeProduct>
    <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${amount(line.unitPrice)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
    <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${escapeXml(line.unitCode || 'C62')}">${quantity(line.quantity)}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
    <ram:SpecifiedLineTradeSettlement>
      <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>${escapeXml(category)}</ram:CategoryCode><ram:RateApplicablePercent>${amount(rate)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
      <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${amount(line.lineTotal)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
    </ram:SpecifiedLineTradeSettlement>
  </ram:IncludedSupplyChainTradeLineItem>`;
}

export function invoiceToCiiXml(invoice, options = {}) {
  if (!invoice || !invoice.document || !invoice.seller || !invoice.buyer || !Array.isArray(invoice.lines)) {
    throw new TypeError('A normalized invoice model is required.');
  }
  const doc = invoice.document;
  const totals = invoice.totals || {};
  const currency = clean(totals.currency) || 'EUR';
  const profile = options.profile || 'EN 16931';
  const dateDigits = clean(doc.issueDate).replace(/-/g, '');
  if (!/^\\d{8}$/.test(dateDigits)) throw new Error('Issue date must be YYYY-MM-DD.');

  const vatGroups = Array.isArray(invoice.vatBreakdown) ? invoice.vatBreakdown : [];
  const taxXml = vatGroups.map((group) => `<ram:ApplicableTradeTax>
    <ram:CalculatedAmount>${amount(group.taxAmount)}</ram:CalculatedAmount>
    <ram:TypeCode>VAT</ram:TypeCode>
    <ram:BasisAmount>${amount(group.taxableAmount)}</ram:BasisAmount>
    <ram:CategoryCode>${escapeXml(group.categoryCode || taxCategory(group.ratePercent))}</ram:CategoryCode>
    <ram:RateApplicablePercent>${amount(group.ratePercent)}</ram:RateApplicablePercent>
  </ram:ApplicableTradeTax>`).join('');

  const dueDate = clean(doc.dueDate).replace(/-/g, '');
  const dueDateXml = /^\\d{8}$/.test(dueDate)
    ? `<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">${dueDate}</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>`
    : '';
  const payment = invoice.payment;
  const paymentXml = payment?.iban
    ? `<ram:SpecifiedTradeSettlementPaymentMeans><ram:TypeCode>${escapeXml(payment.meansCode || '58')}</ram:TypeCode><ram:PayeePartyCreditorFinancialAccount><ram:IBANID>${escapeXml(payment.iban)}</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>${tag('ram:PayeeSpecifiedCreditorFinancialInstitution', payment.bic)}</ram:SpecifiedTradeSettlementPaymentMeans>`
    : '';

  const delivery = invoice.delivery;
  const deliveryXml = delivery
    ? `<ram:ApplicableHeaderTradeDelivery>${delivery.date ? `<ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${escapeXml(delivery.date.replace(/-/g, ''))}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent>` : ''}</ram:ApplicableHeaderTradeDelivery>`
    : '<ram:ApplicableHeaderTradeDelivery/>';

  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="${NS.rsm}" xmlns:ram="${NS.ram}" xmlns:udt="${NS.udt}">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
    <ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>${escapeXml(profile)}</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${escapeXml(doc.id)}</ram:ID>
    <ram:TypeCode>${escapeXml(doc.typeCode || '380')}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">${dateDigits}</udt:DateTimeString></ram:IssueDateTime>
    ${tag('ram:IncludedNote', options.note)}
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    ${invoice.lines.map((line) => lineXml(line, currency)).join('')}
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>${partyXml('SellerTradeParty', invoice.seller).replace(/^<ram:SellerTradeParty>|<\\/ram:SellerTradeParty>$/g, '')}</ram:SellerTradeParty>
      <ram:BuyerTradeParty>${partyXml('BuyerTradeParty', invoice.buyer).replace(/^<ram:BuyerTradeParty>|<\\/ram:BuyerTradeParty>$/g, '')}</ram:BuyerTradeParty>
      ${tag('ram:BuyerReference', doc.buyerReference)}
    </ram:ApplicableHeaderTradeAgreement>
    ${deliveryXml}
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>${escapeXml(currency)}</ram:InvoiceCurrencyCode>
      ${paymentXml}
      ${taxXml}
      ${dueDateXml}
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>${amount(totals.lineTotal)}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>${amount(totals.taxBasisTotal)}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="${escapeXml(currency)}">${amount(totals.taxTotal)}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>${amount(totals.grandTotal)}</ram:GrandTotalAmount>
        <ram:TotalPrepaidAmount>${amount(Number(totals.grandTotal || 0) - Number(totals.duePayableAmount || 0))}</ram:TotalPrepaidAmount>
        <ram:DuePayableAmount>${amount(totals.duePayableAmount)}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}
