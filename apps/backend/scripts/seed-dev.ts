/**
 * Dev-only reference data — NOT for production, and never fake people.
 *
 *   pnpm seed:dev
 *   SEED_PINCODES=248001,248002,248003 pnpm seed:dev
 *
 * Creates, if missing:
 *   - an active ServiceZone (baseDeliveryFee 25) for each pincode in
 *     SEED_PINCODES (default 248001,248002), so orders to them are accepted;
 *   - the base product categories.
 *
 * Idempotent: rows that already exist are left exactly as they are (an admin
 * may have changed a zone's fee since), so it is safe to re-run. No users,
 * vendors, riders or orders are ever created — those come from the real apps.
 */
import { env } from '../src/lib/env';
import { prisma } from '../src/lib/prisma';

if (env.NODE_ENV === 'production') {
  console.error('seed:dev refuses to run with NODE_ENV=production.');
  process.exit(1);
}

const DEFAULT_PINCODES = '248001,248002';
const BASE_DELIVERY_FEE = 25;
const CATEGORIES = ['Leafy', 'Root', 'Fruits', 'Exotic', 'Combos'];

function seedPincodes(): string[] {
  const raw = process.env.SEED_PINCODES?.trim() || DEFAULT_PINCODES;
  const pincodes = [...new Set(raw.split(',').map((p) => p.trim()).filter(Boolean))];
  const invalid = pincodes.filter((p) => !/^\d{6}$/.test(p));
  if (invalid.length > 0) {
    throw new Error(`SEED_PINCODES must be 6-digit pincodes; invalid: ${invalid.join(', ')}`);
  }
  return pincodes;
}

async function main() {
  const pincodes = seedPincodes();

  for (const pincode of pincodes) {
    const existed = await prisma.serviceZone.findUnique({ where: { pincode } });
    await prisma.serviceZone.upsert({
      where: { pincode },
      create: { pincode, baseDeliveryFee: BASE_DELIVERY_FEE, isActive: true },
      update: {},
    });
    console.log(`zone ${pincode}: ${existed ? 'exists, unchanged' : `created (fee ${BASE_DELIVERY_FEE}, active)`}`);
  }

  for (const [i, name] of CATEGORIES.entries()) {
    const existed = await prisma.category.findUnique({ where: { name } });
    await prisma.category.upsert({
      where: { name },
      create: { name, sortOrder: i + 1 },
      update: {},
    });
    console.log(`category ${name}: ${existed ? 'exists, unchanged' : 'created'}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await prisma.$disconnect();
    process.exit(1);
  });
