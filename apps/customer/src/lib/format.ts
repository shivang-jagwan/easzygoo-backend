import type { ProductUnit } from '@easzygoo/api-client';

/** "500g", "1kg", "6 pieces" — how a pack size reads on a shelf label. */
export function formatUnit(unit: ProductUnit, value: number): string {
  switch (unit) {
    case 'GRAM':
      return `${value}g`;
    case 'KILOGRAM':
      return `${value}kg`;
    case 'PIECE':
      return value === 1 ? '1 piece' : `${value} pieces`;
    case 'BUNCH':
      return value === 1 ? '1 bunch' : `${value} bunches`;
  }
}

/** Whole rupees stay whole; anything else shows both paise digits. */
export function formatPrice(amount: number): string {
  return Number.isInteger(amount) ? `₹${amount}` : `₹${amount.toFixed(2)}`;
}

/**
 * A short, unambiguous date for a list row: "3 Sep 2026". Deliberately not
 * locale-formatted — dd/mm vs mm/dd is a real ambiguity in a list of orders,
 * and a named month has none.
 */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Float money drifts (0.1 + 0.2), so round before displaying a computed amount.
 * CartContext already does this for the subtotal; line totals need it too.
 */
export function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}
