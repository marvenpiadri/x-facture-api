import {
  errorResponse,
  handleOptions,
  isPlainObject,
  methodNotAllowed,
  parseJsonBody,
  prepareResponse
} from '../lib/http.js';

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

function number(value, field) {
  if (typeof value === 'string' && value.trim() !== '') value = Number(value);
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric value for ${field}.`);
  return value;
}

export default async function handler(req, res) {
  prepareResponse(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST, OPTIONS');

  const body = parseJsonBody(req);
  if (!isPlainObject(body)) {
    return errorResponse(res, 400, 'INVALID_JSON', 'Request body must be a JSON object.');
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0 || items.length > 500) {
    return errorResponse(res, 400, 'INVALID_ITEMS', 'items must contain between 1 and 500 entries.');
  }

  try {
    const currency = typeof body.currency === 'string' && /^[A-Z]{3}$/.test(body.currency)
      ? body.currency
      : 'EUR';

    const totals = {
      subtotal: 0,
      discount: 0,
      taxable: 0,
      tax: 0,
      total: 0
    };
    const vat = new Map();

    const normalizedItems = items.map((item, index) => {
      if (!isPlainObject(item)) throw new Error(`Item ${index + 1} must be an object.`);

      const quantity = number(item.quantity ?? item.qty ?? 1, `items[${index}].quantity`);
      const unitPrice = number(item.unitPrice ?? item.price ?? 0, `items[${index}].unitPrice`);
      const discountPercent = number(item.discountPercent ?? 0, `items[${index}].discountPercent`);
      const vatRate = number(item.vatRate ?? item.vatPercentage ?? 0, `items[${index}].vatRate`);

      if (quantity <= 0 || unitPrice < 0 || discountPercent < 0 || discountPercent > 100 || vatRate < 0 || vatRate > 100) {
        throw new Error(`Invalid values for item ${index + 1}.`);
      }

      const lineSubtotal = round2(quantity * unitPrice);
      const discount = round2(lineSubtotal * discountPercent / 100);
      const taxable = round2(lineSubtotal - discount);
      const tax = round2(taxable * vatRate / 100);
      const total = round2(taxable + tax);

      totals.subtotal = round2(totals.subtotal + lineSubtotal);
      totals.discount = round2(totals.discount + discount);
      totals.taxable = round2(totals.taxable + taxable);
      totals.tax = round2(totals.tax + tax);
      totals.total = round2(totals.total + total);

      const key = vatRate.toFixed(2);
      const group = vat.get(key) || { rate: vatRate, taxable: 0, tax: 0 };
      group.taxable = round2(group.taxable + taxable);
      group.tax = round2(group.tax + tax);
      vat.set(key, group);

      return {
        description: typeof item.description === 'string' ? item.description.slice(0, 500) : '',
        quantity,
        unitPrice,
        discountPercent,
        vatRate,
        subtotal: lineSubtotal,
        discount,
        taxable,
        tax,
        total
      };
    });

    const amountPaid = Math.max(0, number(body.amountPaid ?? 0, 'amountPaid'));
    const due = round2(Math.max(0, totals.total - amountPaid));

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      currency,
      items: normalizedItems,
      totals: {
        ...totals,
        amountPaid,
        due
      },
      vatBreakdown: [...vat.values()],
      calculatedAt: new Date().toISOString()
    });
  } catch (error) {
    return errorResponse(res, 400, 'INVALID_INVOICE', error.message);
  }
}
