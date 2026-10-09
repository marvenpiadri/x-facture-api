/**
 * Xfacture compliance engine.
 *
 * This layer is deliberately separate from PDF/XML serialization and from
 * EN 16931 validation. Rules are versioned and jurisdiction-scoped so country
 * requirements can evolve without changing the common document model.
 *
 * Statuses are readiness findings, not legal advice or a claim of platform
 * acceptance. French mandate/transmission checks are not inferred from a PDF.
 */

const RULESET_VERSION = '2026-10-09.1';

const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : '';
const digits = (value) => text(value).replace(/\D/g, '');
const countryCode = (value) => text(value).toUpperCase();

function finding(ruleId, severity, title, message, path, applicability = 'always') {
  return { ruleId, severity, title, message, path, applicability };
}

function findIdentifier(party, types) {
  const identifiers = Array.isArray(party?.taxIdentifiers) ? party.taxIdentifiers : [];
  return identifiers.find((item) =>
    item && typeof item === 'object' && types.includes(String(item.type || '').toUpperCase()) && text(item.value)
  );
}

function validateFrenchParty(party, role, findings) {
  const prefix = role;
  const country = countryCode(party?.country || party?.address?.country);
  if (country !== 'FR') return;

  // The engine receives the normalized invoice model, not the original form payload.
  const siren = party?.legalOrganization?.schemeID === '0002'
    ? { value: party.legalOrganization.id }
    : undefined;
  const siret = party?.globalId?.schemeID === '0009'
    ? { value: party.globalId.value }
    : undefined;
  const vat = (Array.isArray(party?.taxRegistrations) ? party.taxRegistrations : [])
    .find((item) => item?.schemeId === 'VA' && text(item.id));
  const legalId = party?.legalOrganization?.id || party?.globalId?.value;

  if (siren && digits(siren.value).length !== 9) {
    findings.push(finding('FR-ID-001', 'error', 'Invalid SIREN', 'A SIREN must contain 9 digits.', `${prefix}.legalOrganization.id`));
  }
  if (siret && digits(siret.value).length !== 14) {
    findings.push(finding('FR-ID-002', 'error', 'Invalid SIRET', 'A SIRET must contain 14 digits.', `${prefix}.globalId.value`));
  }
  if (siren && !siret) {
    findings.push(finding('FR-ID-003', 'info', 'SIRET not supplied', 'A SIRET identifies an establishment. Include it when the transaction or applicable French rules require establishment-level identification.', `${prefix}.globalId`, 'when-applicable'));
  }
  if (vat && !/^FR[0-9A-HJ-NP-Z]{2}[0-9]{9}$/i.test(text(vat.id).replace(/\s/g, ''))) {
    findings.push(finding('FR-TAX-001', 'warning', 'Check French VAT number', 'The value does not match the usual French VAT number shape. Verify it against an authoritative source; format checks do not establish validity.', `${prefix}.taxRegistrations`));
  }
  if (!legalId) {
    findings.push(finding('FR-ID-004', 'warning', 'French business identifier missing', 'No business registration identifier was supplied. Confirm which legal identifier is applicable to this party and transaction.', `${prefix}.legalOrganization`, 'when-applicable'));
  }
}

function validateCommon(invoice, findings) {
  const document = invoice?.document || {};
  if (!text(document.id)) {
    findings.push(finding('INV-001', 'error', 'Invoice number missing', 'Provide a unique invoice/document identifier.', 'document.id'));
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(document.issueDate))) {
    findings.push(finding('INV-002', 'error', 'Issue date invalid', 'Use a real calendar date in YYYY-MM-DD format.', 'document.issueDate'));
  } else {
    const [year, month, day] = document.issueDate.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
      findings.push(finding('INV-002', 'error', 'Issue date invalid', 'Use a real calendar date in YYYY-MM-DD format.', 'document.issueDate'));
    }
  }
  if (!text(invoice?.seller?.name)) findings.push(finding('INV-003', 'error', 'Seller name missing', 'Provide the seller name.', 'seller.name'));
  if (!text(invoice?.buyer?.name)) findings.push(finding('INV-004', 'error', 'Buyer name missing', 'Provide the buyer name.', 'buyer.name'));
  if (!Array.isArray(invoice?.lines) || invoice.lines.length === 0) {
    findings.push(finding('INV-005', 'error', 'Invoice lines missing', 'At least one invoice line is required.', 'lines'));
  }
}

export function validateInvoiceCompliance(invoice, options = {}) {
  const findings = [];
  validateCommon(invoice, findings);

  const sellerCountry = countryCode(invoice?.seller?.address?.country || invoice?.seller?.country);
  const buyerCountry = countryCode(invoice?.buyer?.address?.country || invoice?.buyer?.country);
  const jurisdiction = countryCode(options.jurisdiction || (sellerCountry === 'FR' || buyerCountry === 'FR' ? 'FR' : sellerCountry || buyerCountry));

  if (jurisdiction === 'FR') {
    validateFrenchParty({ ...invoice?.seller, country: sellerCountry }, 'seller', findings);
    validateFrenchParty({ ...invoice?.buyer, country: buyerCountry }, 'buyer', findings);

    const documentType = String(invoice?.document?.typeCode || '380');
    if (!['380', '381', '384', '389'].includes(documentType)) {
      findings.push(finding('FR-DOC-001', 'warning', 'Check French invoice document type', 'Confirm that the document type code matches the commercial document and its French treatment.', 'document.typeCode'));
    }

    if (!invoice?.seller?.electronicAddress || !invoice?.seller?.electronicAddress?.schemeID) {
      findings.push(finding('FR-ROUTE-001', 'info', 'Seller routing address not supplied', 'No electronic routing identifier was supplied. This is not inferred from the SIREN, SIRET, or VAT number; determine whether the transaction requires one and use the registered identifier.', 'seller.electronicAddress', 'when-applicable'));
    }
    if (!invoice?.buyer?.electronicAddress || !invoice?.buyer?.electronicAddress?.schemeID) {
      findings.push(finding('FR-ROUTE-002', 'info', 'Buyer routing address not supplied', 'No electronic routing identifier was supplied. This is not inferred from the buyer tax ID; determine the recipient routing details through the appropriate directory or platform.', 'buyer.electronicAddress', 'when-applicable'));
    }
  }

  const errors = findings.filter((item) => item.severity === 'error');
  const warnings = findings.filter((item) => item.severity === 'warning');
  const infos = findings.filter((item) => item.severity === 'info');
  return {
    engine: 'xfacture-compliance',
    rulesetVersion: RULESET_VERSION,
    jurisdiction,
    status: errors.length ? 'invalid' : warnings.length ? 'review' : 'passed-with-notes',
    valid: errors.length === 0,
    summary: { errors: errors.length, warnings: warnings.length, infos: infos.length },
    findings
  };
}

export const complianceRulesetVersion = RULESET_VERSION;
