import type { OrderStatus } from '@easzygoo/api-client';

import type { ThemeColors } from '../theme/colors';

/**
 * The one place order statuses are turned into words and colour, shared by the
 * tracking timeline and the history list so the two can never drift apart.
 */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  PLACED: 'Order placed',
  ACCEPTED: 'Accepted by the store',
  PREPARING: 'Being prepared',
  READY_FOR_PICKUP: 'Ready for pickup',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

/** Shorter wording for a badge, where the full sentence would not fit. */
export const STATUS_BADGE: Record<OrderStatus, string> = {
  PLACED: 'Placed',
  ACCEPTED: 'Accepted',
  PREPARING: 'Preparing',
  READY_FOR_PICKUP: 'Ready',
  OUT_FOR_DELIVERY: 'On the way',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

/**
 * Three outcomes, three tokens: still happening, finished well, finished badly.
 * There is no danger/red token in the palette, so a cancelled order recedes
 * into the secondary text colour rather than shouting in an invented colour.
 */
export function statusColor(status: OrderStatus, colors: ThemeColors): string {
  if (status === 'DELIVERED') return colors.success;
  if (status === 'CANCELLED') return colors.textSecondary;
  return colors.primaryGreen;
}
