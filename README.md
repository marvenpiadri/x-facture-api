# x-facture API

Shared serverless infrastructure for x-facture and future products.

## Endpoints

- `GET /api/health` — deployment health check.
- `GET /api/currency-rates?base=USD` — cached exchange rates.
- `GET /api/generate-qr?text=...&format=svg|png` — QR generation.
- `POST /api/invoice-calculate` — deterministic invoice totals and VAT breakdown.
- `POST /api/generate-invoice` — HTML invoice rendering plus Factur-X EN 16931 embedding.
- `POST /api/compliance-check` — structured preflight findings for invoice data, with a versioned country-rule engine (France is the first jurisdiction).

## Invoice generation

The PDF endpoint expects:

```json
{
  "htmlLayout": "<!doctype html>...",
  "rawInvoiceData": {
    "id": "INV-2026-001",
    "date": "2026-10-08",
    "currency": "EUR",
    "sellerName": "Example Seller",
    "sellerVat": "DE123456789",
    "sellerAddressLine1": "Example Street 1",
    "sellerCity": "Berlin",
    "sellerPostalCode": "10115",
    "sellerCountry": "DE",
    "buyerName": "Example Buyer",
    "buyerAddressLine1": "Example Street 2",
    "buyerCity": "Berlin",
    "buyerPostalCode": "10117",
    "buyerCountry": "DE",
    "items": [
      {
        "description": "Service",
        "qty": 1,
        "unitPrice": 100,
        "vatPercentage": 19
      }
    ]
  }
}
```

For production, keep invoice HTML self-contained. The renderer intentionally blocks external network requests to reduce SSRF risk and make output deterministic.

Set `CHROMIUM_PACK_URL` only if you want to host the matching Chromium pack yourself. The default points to the pinned Chromium 131 pack used by the current Puppeteer dependency.

## Compliance preflight\n\nSend `POST /api/compliance-check` with `{ "rawInvoiceData": { ... } }`, using the same invoice data shape as `/api/generate-invoice`. An optional `jurisdiction` can select a ruleset explicitly (for example `FR`). The response contains a versioned report with `error`, `warning`, and `info` findings and paths back to the relevant fields.\n\nThe current French ruleset validates common invoice essentials and basic identifier formats, and flags routing identifiers for review without deriving them from tax IDs. It is an extensible starting layer, not a declaration of complete French 2026 compliance. It does not prove approval-platform acceptance, transmission, or e-reporting completion.\n\n## Configuration

- `CORS_ORIGIN` — optional allowed origin. Defaults to `*`.
- `CHROMIUM_PACK_URL` — optional HTTPS URL for the Chromium pack.

## Local checks

```bash
npm install
npm run check
```

The service is designed to remain stateless so it can later be shared by QR, POS, invoicing, document, astronomy, and other products.
