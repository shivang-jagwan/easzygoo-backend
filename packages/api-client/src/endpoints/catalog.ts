import type { ApiClient } from '../client';
import type {
  Category,
  CreateCategoryRequest,
  CreateProductRequest,
  DeleteProductResponse,
  Product,
  StockUpdateResponse,
  UpdateProductRequest,
} from '../types';

/** GET /v1/categories — public. */
export function listCategories(client: ApiClient): Promise<Category[]> {
  return client.get<Category[]>('/v1/categories');
}

/** POST /v1/categories — ADMIN only. 400 if the name already exists. */
export function createCategory(client: ApiClient, data: CreateCategoryRequest): Promise<Category> {
  return client.post<Category>('/v1/categories', data);
}

/** GET /v1/vendors/:vendorId/products — public, active products only. */
export function listVendorProducts(client: ApiClient, vendorId: string): Promise<Product[]> {
  return client.get<Product[]>(`/v1/vendors/${encodeURIComponent(vendorId)}/products`);
}

/**
 * POST /v1/products — vendor only. The vendor is derived from the auth token
 * server-side; never send a vendorId.
 */
export function createProduct(client: ApiClient, data: CreateProductRequest): Promise<Product> {
  return client.post<Product>('/v1/products', data);
}

/** PUT /v1/products/:id — vendor only, must own the product. */
export function updateProduct(
  client: ApiClient,
  id: string,
  data: UpdateProductRequest,
): Promise<Product> {
  return client.put<Product>(`/v1/products/${encodeURIComponent(id)}`, data);
}

/** PATCH /v1/products/:id/stock — lightweight, for frequent stock resets. */
export function updateStock(
  client: ApiClient,
  id: string,
  stockQty: number,
): Promise<StockUpdateResponse> {
  return client.patch<StockUpdateResponse>(`/v1/products/${encodeURIComponent(id)}/stock`, {
    stockQty,
  });
}

/** DELETE /v1/products/:id — soft delete (sets isActive false). */
export function deleteProduct(client: ApiClient, id: string): Promise<DeleteProductResponse> {
  return client.delete<DeleteProductResponse>(`/v1/products/${encodeURIComponent(id)}`);
}
