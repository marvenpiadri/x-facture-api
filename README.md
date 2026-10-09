# x-facture API

Shared serverless infrastructure for x-facture and future products.

## Endpoints

- `GET /api/health` — deployment health check.
- `GET /api/currency-rates?base=USD` — cached exchange rates.
- `GET /api/generate-qr?text=...&format=svg|png` — QR generation.
- `POST /api/invoice-calculate` — deterministic invoice totals and VAT breakdown.
- `POST /api/generate-invoice` — HTML invoice rendering, X-Facture-owned CII D22B XML generation, EN 16931 Schematron validation, and Factur-X PDF/A-3 packaging.

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

## Factur-X engine

Invoice data is normalized by X-Facture, serialized by the in-repository CII D22B engine at `lib/facturx/cii.js`, then checked with the Factur-X XSD and EN 16931 Schematron rules before PDF/A-3 packaging. The generated PDF is then checked by extracting the embedded XML back out.

The legacy `@stackforge-eu/factur-x` generation path has been removed. The remaining Factur-X package is used for standards-based validation and PDF/A-3 packaging, not for mapping the X-Facture invoice model into XML. French-specific rules are an additional layer and still require the official applicable French CIUS/Schematron and mandate-specific fixtures before claiming full French compliance.

## Configuration

- `CORS_ORIGIN` — optional allowed origin. Defaults to `*`.
- `CHROMIUM_PACK_URL` — optional HTTPS URL for the Chromium pack.

## Local checks

```bash
npm install
npm run check
```

The service is designed to remain stateless so it can later be shared by QR, POS, invoicing, document, astronomy, and other products.
