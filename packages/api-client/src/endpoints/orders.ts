import type { ApiClient } from '../client';
import type {
  CreateOrderRequest,
  Order,
  OrderDetail,
  OrderSummary,
  VendorOrderStatus,
} from '../types';

/**
 * POST /v1/orders — customer only. paymentMethod defaults to COD (ONLINE is
 * refused for now). 400 if the store is closed, the address is outside its
 * delivery radius, or the address pincode has no active service zone.
 */
export function createOrder(client: ApiClient, data: CreateOrderRequest): Promise<Order> {
  return client.post<Order>('/v1/orders', data);
}

/** GET /v1/orders/mine — customer's order history, newest first, no item details. */
export function myOrders(client: ApiClient): Promise<OrderSummary[]> {
  return client.get<OrderSummary[]>('/v1/orders/mine');
}

/** GET /v1/orders/:id — the order's customer, its vendor, its assigned rider, or an admin. */
export function getOrder(client: ApiClient, id: string): Promise<OrderDetail> {
  return client.get<OrderDetail>(`/v1/orders/${encodeURIComponent(id)}`);
}

/** PATCH /v1/orders/:id/vendor-status — vendor drives the prep pipeline. */
export function updateVendorOrderStatus(
  client: ApiClient,
  id: string,
  status: VendorOrderStatus,
): Promise<Order> {
  return client.patch<Order>(`/v1/orders/${encodeURIComponent(id)}/vendor-status`, { status });
}

/** POST /v1/orders/:id/claim — rider only; first claim wins, losers get 409. */
export function claimOrder(client: ApiClient, id: string): Promise<Order> {
  return client.post<Order>(`/v1/orders/${encodeURIComponent(id)}/claim`);
}

/** PATCH /v1/orders/:id/delivered — assigned rider only. */
export function markDelivered(client: ApiClient, id: string): Promise<Order> {
  return client.patch<Order>(`/v1/orders/${encodeURIComponent(id)}/delivered`);
}

/** PATCH /v1/orders/:id/cancel — customer only, and only while still PLACED. */
export function cancelOrder(client: ApiClient, id: string): Promise<Order> {
  return client.patch<Order>(`/v1/orders/${encodeURIComponent(id)}/cancel`);
}
