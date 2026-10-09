/**
 * Wire types — what the backend actually sends over HTTP, not Prisma's
 * in-process types.
 *
 * Two things differ from the Prisma models and matter a lot:
 *   - Prisma `Decimal` columns (price, subtotal, total, ...) serialise to
 *     JSON as STRINGS, e.g. "20", not numbers. Parse before doing maths.
 *   - `DateTime` columns serialise as ISO 8601 strings.
 */

export type Role = 'CUSTOMER' | 'VENDOR' | 'RIDER' | 'ADMIN';
/** Roles a client may self-assign at signup; ADMIN is never grantable. */
export type SignupRole = Exclude<Role, 'ADMIN'>;

export type VendorStatus = 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'REJECTED';
export type RiderStatus = VendorStatus;

export type ProductUnit = 'GRAM' | 'KILOGRAM' | 'PIECE' | 'BUNCH';

/**
 * NOTE: the backend also has PENDING_PAYMENT (ONLINE orders awaiting Razorpay).
 * It is deliberately not in this union yet: ONLINE is refused server-side, so no
 * order can be in that state, and adding it would break the customer app's
 * exhaustive Record<OrderStatus, ...> label maps. Add it here — and to those
 * maps — in the same change that enables ONLINE payment.
 */
export type OrderStatus =
  | 'PLACED'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED';

export type PaymentMethod = 'COD' | 'ONLINE';
export type DiscountType = 'FLAT' | 'PERCENT';

/** Statuses a vendor may set via PATCH /v1/orders/:id/vendor-status. */
export type VendorOrderStatus = 'ACCEPTED' | 'PREPARING' | 'READY_FOR_PICKUP' | 'CANCELLED';

/** A Decimal column as it arrives over the wire. */
export type DecimalString = string;
/** An ISO 8601 timestamp. */
export type IsoDateString = string;

// ---------- Entities ----------

/** What POST /v1/auth/verify returns — deliberately narrow, not the whole row. */
export interface AuthUser {
  id: string;
  role: Role;
  name: string | null;
}

/**
 * A vendor's own (or an admin's view of a) Vendor row. Bank details are never
 * sent in full: only the last 4 digits of the account number, and no IFSC.
 */
export interface Vendor {
  id: string;
  userId: string;
  storeName: string;
  latitude: number;
  longitude: number;
  address: string;
  pincode: string;
  deliveryRadiusKm: number;
  /** "HH:MM", 24-hour. */
  openTime: string | null;
  closeTime: string | null;
  isOpen: boolean;
  status: VendorStatus;
  bankAccountLast4: string | null;
  cashfreeBeneficiaryId: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

/** Same bank-detail masking as Vendor. */
export interface Rider {
  id: string;
  userId: string;
  vehicleType: string | null;
  vehicleNumber: string | null;
  idProofUrl: string | null;
  status: RiderStatus;
  isAvailable: boolean;
  currentLat: number | null;
  currentLng: number | null;
  bankAccountLast4: string | null;
  cashfreeBeneficiaryId: string | null;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

/** GET /v1/vendors/:vendorId — public storefront detail, APPROVED stores only. */
export interface PublicVendor {
  id: string;
  storeName: string;
  address: string;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
  deliveryRadiusKm: number;
  /** Always null until ratings ship. */
  averageRating: number | null;
}

/**
 * A delivery address. Hangs off User, so customers, vendors and riders all
 * manage their own through the same endpoints.
 *
 * Invariant the backend enforces: once an account has any address, exactly one
 * of them has isDefault true. The first address created is forced default, and
 * deleting the default promotes the next most recent one.
 *
 * Note there is no updatedAt column on this model, unlike Vendor/Rider.
 */
export interface Address {
  id: string;
  userId: string;
  /** "Home", "Work", ... Blank input is stored as null, never "". */
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  pincode: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
  createdAt: IsoDateString;
}

export interface Category {
  id: string;
  name: string;
  imageUrl: string | null;
  sortOrder: number;
}

export interface Product {
  id: string;
  vendorId: string;
  categoryId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  unit: ProductUnit;
  unitValue: number;
  price: DecimalString;
  stockQty: number;
  isActive: boolean;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  unitPrice: DecimalString;
  lineTotal: DecimalString;
}

/** An OrderItem as returned by GET /v1/orders/:id, which joins the product name. */
export interface OrderItemWithProduct extends OrderItem {
  product: { id: string; name: string };
}

export interface Order {
  id: string;
  customerId: string;
  vendorId: string;
  riderId: string | null;
  addressId: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  subtotal: DecimalString;
  deliveryFee: DecimalString;
  discount: DecimalString;
  total: DecimalString;
  couponCode: string | null;
  placedAt: IsoDateString;
  deliveredAt: IsoDateString | null;
  cancelledAt: IsoDateString | null;
  cancelReason: string | null;
  items: OrderItem[];
}

/** GET /v1/orders/:id — same as Order but items carry product names. */
export interface OrderDetail extends Omit<Order, 'items'> {
  items: OrderItemWithProduct[];
}

/** GET /v1/orders/mine — deliberately light, no item details. */
/** Where an order ships, as shown to its vendor and rider. Never includes a phone number. */
export interface OrderAddressSummary {
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  pincode: string;
  latitude: number;
  longitude: number;
}

/** One order in GET /v1/vendors/me/orders. */
export interface VendorOrder {
  id: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  subtotal: DecimalString;
  deliveryFee: DecimalString;
  discount: DecimalString;
  total: DecimalString;
  couponCode: string | null;
  placedAt: IsoDateString;
  deliveredAt: IsoDateString | null;
  cancelledAt: IsoDateString | null;
  riderId: string | null;
  items: {
    id: string;
    productId: string;
    quantity: number;
    unitPrice: DecimalString;
    lineTotal: DecimalString;
    product: { name: string };
  }[];
  address: OrderAddressSummary;
}

/** GET /v1/vendors/me/orders — pass nextCursor back as `cursor`; null on the last page. */
export interface VendorOrdersPage {
  orders: VendorOrder[];
  nextCursor: string | null;
}

/** "active" (default) = live queue, "all" = history, or one specific status. */
export type VendorOrdersFilter = 'active' | 'all' | OrderStatus;

export interface VendorOrdersQuery {
  status?: VendorOrdersFilter;
  cursor?: string;
  /** 1–50, default 20. */
  limit?: number;
}

/** One delivery in GET /v1/riders/me/orders. */
export interface RiderOrder {
  id: string;
  status: OrderStatus;
  /** COD means the rider collects `total` in cash. */
  paymentMethod: PaymentMethod;
  total: DecimalString;
  placedAt: IsoDateString;
  deliveredAt: IsoDateString | null;
  vendor: { storeName: string; address: string; latitude: number; longitude: number };
  address: OrderAddressSummary;
  items: { quantity: number; product: { name: string } }[];
}

export type RiderOrdersFilter = 'active' | 'history';

export interface OrderSummary {
  id: string;
  vendorId: string;
  /** The vendor's storeName, joined server-side so a history list needs one call. */
  vendorName: string;
  status: OrderStatus;
  total: DecimalString;
  placedAt: IsoDateString;
  itemCount: number;
}

export interface PushToken {
  id: string;
  userId: string;
  token: string;
  platform: string | null;
  createdAt: IsoDateString;
}

// ---------- Endpoint request / response shapes ----------

export interface VerifyRequest {
  role?: SignupRole;
}

export interface CreateProductRequest {
  categoryId: string;
  name: string;
  unit: ProductUnit;
  unitValue: number;
  price: number;
  description?: string | null;
  imageUrl?: string | null;
  stockQty?: number;
}

/** Every field optional; the backend rejects an empty body with 400. */
export interface UpdateProductRequest {
  categoryId?: string;
  name?: string;
  unit?: ProductUnit;
  unitValue?: number;
  price?: number;
  description?: string | null;
  imageUrl?: string | null;
  stockQty?: number;
  isActive?: boolean;
}

/** PATCH /v1/products/:id/stock — intentionally minimal. */
export interface StockUpdateResponse {
  id: string;
  stockQty: number;
}

/** DELETE /v1/products/:id — soft delete. */
export interface DeleteProductResponse {
  id: string;
  isActive: false;
}

/** GET /v1/vendors/nearby */
export interface NearbyVendor {
  id: string;
  storeName: string;
  latitude: number;
  longitude: number;
  deliveryRadiusKm: number;
  /** Rounded to 2 decimal places by the backend. */
  distanceKm: number;
}

/** GET /v1/search — a vendor as it appears in search results. */
export interface SearchVendorHit {
  id: string;
  storeName: string;
  /** Rounded to 2 decimal places by the backend. */
  distanceKm: number;
}

/** GET /v1/search — a product, with the vendor that stocks it attached. */
export interface SearchProductHit {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  unit: ProductUnit;
  unitValue: number;
  price: DecimalString;
  stockQty: number;
  vendor: SearchVendorHit;
}

/**
 * Both lists are scoped to vendors that can actually deliver to the caller, and
 * are ordered nearest-first (products then break ties by name).
 */
export interface SearchResults {
  vendors: SearchVendorHit[];
  products: SearchProductHit[];
}

/**
 * POST /v1/addresses. Sending isDefault false for an account's very first
 * address is ignored — the backend forces the first one to be the default.
 */
export interface CreateAddressRequest {
  line1: string;
  city: string;
  pincode: string;
  latitude: number;
  longitude: number;
  label?: string | null;
  line2?: string | null;
  isDefault?: boolean;
}

/**
 * PUT /v1/addresses/:id. Every field optional, but an empty body is rejected
 * with 400. Passing isDefault true demotes whichever address was default.
 *
 * Passing isDefault false on the address that is *currently* default is a 400 —
 * an account must never be left without one. Promote a different address
 * instead; that clears this one as a side effect.
 */
export interface UpdateAddressRequest {
  label?: string | null;
  line1?: string;
  line2?: string | null;
  city?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  isDefault?: boolean;
}

/**
 * DELETE /v1/addresses/:id — a hard delete, unlike products. Returns 409 if any
 * order still references the address, so past orders keep the address they
 * actually shipped to.
 */
export interface DeleteAddressResponse {
  id: string;
  deleted: true;
}

export interface CreateOrderItemInput {
  productId: string;
  quantity: number;
}

export interface CreateOrderRequest {
  vendorId: string;
  addressId: string;
  items: CreateOrderItemInput[];
  couponCode?: string;
  /** Defaults to COD. ONLINE is currently refused with 400. */
  paymentMethod?: PaymentMethod;
}

export interface VendorOrderStatusRequest {
  status: VendorOrderStatus;
}

/**
 * GET /v1/riders/available-orders — pickups within 5 km of the rider, nearest
 * first, at most 20. APPROVED riders only.
 */
export interface AvailableOrder {
  id: string;
  total: DecimalString;
  placedAt: IsoDateString;
  pickup: {
    storeName: string;
    address: string;
    latitude: number;
    longitude: number;
  };
  dropoff: {
    latitude: number;
    longitude: number;
  };
  /** Rider to pickup, km, rounded to 2 decimals. */
  distanceKm: number;
}

/**
 * GET /v1/vendors/me. A discriminated union on purpose: a vendor with no
 * profile yet is a normal state, and this shape makes a caller check for it
 * before reaching for the row.
 */
export type MyVendorResponse = { onboarded: false } | { onboarded: true; vendor: Vendor };

/** GET /v1/riders/me — same shape pattern as MyVendorResponse. */
export type MyRiderResponse = { onboarded: false } | { onboarded: true; rider: Rider };

/**
 * PATCH /v1/vendors/me — APPROVED stores only. Every field optional; an empty
 * body is a 400. Send null to clear openTime/closeTime.
 */
export interface UpdateVendorRequest {
  storeName?: string;
  address?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  /** "HH:MM", 24-hour. */
  openTime?: string | null;
  closeTime?: string | null;
  isOpen?: boolean;
  /** 1–15. */
  deliveryRadiusKm?: number;
}

/** PUT /v1/vendors/me/bank — allowed in any vendor status. */
export interface UpdateBankRequest {
  /** 9–18 digits. */
  bankAccountNumber: string;
  /** e.g. HDFC0001234; lower case is accepted and upper-cased. */
  bankIfsc: string;
}

/** PATCH /v1/riders/me/location */
export interface RiderLocationResponse {
  /** False when throttled — the position was still broadcast, just not stored. */
  persisted: boolean;
  /** The order the position was broadcast to, if any is out for delivery. */
  activeOrderId: string | null;
}

/** PATCH /v1/users/me — send null to clear a field; an empty body is a 400. */
export interface UpdateMeRequest {
  name?: string | null;
  email?: string | null;
}

export interface UserProfile {
  id: string;
  role: Role;
  name: string | null;
  email: string | null;
}

/**
 * POST /v1/uploads/sign — post the file to
 * https://api.cloudinary.com/v1_1/{cloudName}/image/upload with
 * api_key, timestamp, signature and folder exactly as returned.
 */
export interface UploadSignature {
  timestamp: number;
  signature: string;
  apiKey: string;
  cloudName: string;
  folder: string;
}

// ---------- Admin ----------

/** GET /v1/admin/vendors/pending — the masked Vendor plus the owner's phone. */
export interface PendingVendor extends Vendor {
  phone: string;
}

export interface PendingRider extends Rider {
  phone: string;
}

export interface Coupon {
  id: string;
  code: string;
  discountType: DiscountType;
  discountValue: DecimalString;
  minOrderValue: DecimalString | null;
  maxUses: number | null;
  usedCount: number;
  /** 1 = once per customer; null = no per-customer cap. */
  perUserLimit: number | null;
  validFrom: IsoDateString;
  validUntil: IsoDateString;
  isActive: boolean;
}

export interface CreateCouponRequest {
  code: string;
  discountType: DiscountType;
  discountValue: number;
  minOrderValue?: number | null;
  maxUses?: number | null;
  /** 1 (default) or null; values above 1 are rejected. */
  perUserLimit?: 1 | null;
  validFrom: IsoDateString;
  validUntil: IsoDateString;
}

export interface CreateCategoryRequest {
  name: string;
  imageUrl?: string | null;
  sortOrder?: number;
}

export interface ServiceZone {
  id: string;
  pincode: string;
  isActive: boolean;
  baseDeliveryFee: DecimalString;
}

/** GET /v1/admin/dlq — a push notification that failed every retry. */
export interface DeadLetter {
  id: string;
  originalJobId: string | null;
  queue: string;
  payload: { userId: string; title: string; body: string; data?: Record<string, string> };
  failedReason: string;
  stacktrace: string[];
  attemptsMade: number;
  failedAt: IsoDateString;
}

/** POST /v1/admin/zones — creates or updates the zone for that pincode. */
export interface UpsertZoneRequest {
  /** 6 digits. */
  pincode: string;
  baseDeliveryFee: number;
  /** Defaults to true. */
  isActive?: boolean;
}

export interface OnboardVendorRequest {
  storeName: string;
  address: string;
  pincode: string;
  latitude: number;
  longitude: number;
  bankAccountNumber?: string;
  bankIfsc?: string;
}

export interface OnboardRiderRequest {
  vehicleType: string;
  vehicleNumber: string;
  idProofUrl: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
}

export interface RegisterPushTokenRequest {
  token: string;
  platform?: string;
}
