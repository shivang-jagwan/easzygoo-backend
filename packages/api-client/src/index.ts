/**
 * @easzygoo/api-client — the shared typed API layer for the Customer, Vendor
 * and Rider apps.
 *
 * Pure TypeScript: no React Native, no Firebase. Each app supplies its own
 * `getToken` when creating the client.
 *
 *   const api = createApiClient({
 *     baseUrl: process.env.EXPO_PUBLIC_API_URL!,
 *     getToken: () => auth().currentUser?.getIdToken() ?? Promise.resolve(null),
 *   });
 *   const cats = await listCategories(api);
 */

export { createApiClient, ApiError } from './client';
export type { ApiClient, ApiClientOptions, RequestOptions } from './client';

export * from './types';

export * from './endpoints/addresses';
export * from './endpoints/admin';
export * from './endpoints/auth';
export * from './endpoints/catalog';
export * from './endpoints/discovery';
export * from './endpoints/onboarding';
export * from './endpoints/orders';
export * from './endpoints/notifications';
export * from './endpoints/riders';
export * from './endpoints/search';
export * from './endpoints/uploads';
export * from './endpoints/users';
export * from './endpoints/vendors';
