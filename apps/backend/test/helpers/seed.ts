import { Prisma, type OrderStatus, type Role, type RiderStatus, type VendorStatus } from '@prisma/client';
import { prisma } from '../../src/lib/prisma';
import { tokenFor } from './app';

/*
 * Seed helpers write straight to the DB (not through the API), so each test
 * sets up exactly the state it needs. Every helper returns the token to act as
 * that user.
 */

let seq = 0;
const next = () => ++seq;

/** Central Bengaluru; addresses default to the same point as stores. */
export const BASE = { lat: 12.9716, lng: 77.5946 };
export const DEFAULT_PINCODE = '560001';

/** Roughly `km` kilometres north of `from`. */
export function northOf(km: number, from = BASE) {
  return { lat: from.lat + km / 111.045, lng: from.lng };
}

export interface SeededUser {
  id: string;
  role: Role;
  token: string;
}

export async function createUser(role: Role): Promise<SeededUser> {
  const n = next();
  const firebaseUid = `uid-${role.toLowerCase()}-${n}-${Date.now()}`;
  const phone = `+91${String(9000000000 + n * 7919 + (Date.now() % 1000))}`.slice(0, 13);
  const user = await prisma.user.create({ data: { firebaseUid, phone, role } });
  return { id: user.id, role, token: tokenFor(firebaseUid, phone) };
}

export async function createCustomer(
  opts: { lat?: number; lng?: number; pincode?: string } = {},
): Promise<SeededUser & { addressId: string }> {
  const user = await createUser('CUSTOMER');
  const address = await prisma.address.create({
    data: {
      userId: user.id,
      line1: '1 Test Street',
      city: 'Bengaluru',
      pincode: opts.pincode ?? DEFAULT_PINCODE,
      latitude: opts.lat ?? BASE.lat,
      longitude: opts.lng ?? BASE.lng,
      isDefault: true,
    },
  });
  return { ...user, addressId: address.id };
}

export async function createVendor(
  opts: {
    status?: VendorStatus;
    isOpen?: boolean;
    lat?: number;
    lng?: number;
    deliveryRadiusKm?: number;
    bankAccountNumber?: string | null;
    bankIfsc?: string | null;
  } = {},
): Promise<SeededUser & { vendorId: string }> {
  const user = await createUser('VENDOR');
  const vendor = await prisma.vendor.create({
    data: {
      userId: user.id,
      storeName: `Store ${next()}`,
      address: '2 Market Road',
      pincode: DEFAULT_PINCODE,
      latitude: opts.lat ?? BASE.lat,
      longitude: opts.lng ?? BASE.lng,
      deliveryRadiusKm: opts.deliveryRadiusKm ?? 3,
      isOpen: opts.isOpen ?? true,
      status: opts.status ?? 'APPROVED',
      bankAccountNumber: opts.bankAccountNumber ?? null,
      bankIfsc: opts.bankIfsc ?? null,
    },
  });
  return { ...user, vendorId: vendor.id };
}

export async function createRider(
  opts: {
    status?: RiderStatus;
    isAvailable?: boolean;
    bankAccountNumber?: string | null;
    bankIfsc?: string | null;
  } = {},
): Promise<SeededUser & { riderId: string }> {
  const user = await createUser('RIDER');
  const rider = await prisma.rider.create({
    data: {
      userId: user.id,
      vehicleType: 'bike',
      vehicleNumber: `KA01AB${1000 + next()}`,
      idProofUrl: 'https://example.test/id.jpg',
      status: opts.status ?? 'APPROVED',
      isAvailable: opts.isAvailable ?? true,
      bankAccountNumber: opts.bankAccountNumber ?? null,
      bankIfsc: opts.bankIfsc ?? null,
    },
  });
  return { ...user, riderId: rider.id };
}

export const createAdmin = () => createUser('ADMIN');

let categoryId: string | null = null;
async function defaultCategory(): Promise<string> {
  if (categoryId && (await prisma.category.findUnique({ where: { id: categoryId } }))) {
    return categoryId;
  }
  const c = await prisma.category.create({ data: { name: `Vegetables ${next()}` } });
  categoryId = c.id;
  return c.id;
}

export async function createProduct(
  vendorId: string,
  opts: { price?: string; stockQty?: number; isActive?: boolean; name?: string } = {},
) {
  return prisma.product.create({
    data: {
      vendorId,
      categoryId: await defaultCategory(),
      name: opts.name ?? `Tomato ${next()}`,
      unit: 'KILOGRAM',
      unitValue: 1,
      price: new Prisma.Decimal(opts.price ?? '40.00'),
      stockQty: opts.stockQty ?? 100,
      isActive: opts.isActive ?? true,
    },
  });
}

export async function createZone(pincode = DEFAULT_PINCODE, baseDeliveryFee = '25.00', isActive = true) {
  return prisma.serviceZone.upsert({
    where: { pincode },
    create: { pincode, baseDeliveryFee: new Prisma.Decimal(baseDeliveryFee), isActive },
    update: { baseDeliveryFee: new Prisma.Decimal(baseDeliveryFee), isActive },
  });
}

export async function createCoupon(
  opts: {
    code?: string;
    discountType?: 'FLAT' | 'PERCENT';
    discountValue?: string;
    maxUses?: number | null;
    perUserLimit?: number | null;
    minOrderValue?: string | null;
  } = {},
) {
  const day = 24 * 3600 * 1000;
  return prisma.coupon.create({
    data: {
      code: opts.code ?? `SAVE${next()}`,
      discountType: opts.discountType ?? 'FLAT',
      discountValue: new Prisma.Decimal(opts.discountValue ?? '10.00'),
      maxUses: opts.maxUses === undefined ? null : opts.maxUses,
      perUserLimit: opts.perUserLimit === undefined ? 1 : opts.perUserLimit,
      minOrderValue: opts.minOrderValue ? new Prisma.Decimal(opts.minOrderValue) : null,
      validFrom: new Date(Date.now() - day),
      validUntil: new Date(Date.now() + day),
    },
  });
}

/**
 * An order row in any status, written directly — for state-machine tests that
 * need to start from e.g. PREPARING without walking every edge first.
 */
export async function createOrderRow(opts: {
  customerId: string;
  addressId: string;
  vendorId: string;
  productId: string;
  status: OrderStatus;
  riderId?: string | null;
  quantity?: number;
  couponCode?: string | null;
}) {
  const quantity = opts.quantity ?? 1;
  const unitPrice = new Prisma.Decimal('40.00');
  const lineTotal = unitPrice.mul(quantity);
  return prisma.order.create({
    data: {
      customerId: opts.customerId,
      addressId: opts.addressId,
      vendorId: opts.vendorId,
      riderId: opts.riderId ?? null,
      status: opts.status,
      subtotal: lineTotal,
      deliveryFee: new Prisma.Decimal('25.00'),
      total: lineTotal.add(25),
      couponCode: opts.couponCode ?? null,
      items: { create: [{ productId: opts.productId, quantity, unitPrice, lineTotal }] },
    },
  });
}
