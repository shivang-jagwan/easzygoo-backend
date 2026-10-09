/**
 * Makes an existing account an ADMIN. This is the ONLY way an admin is created:
 * no API route can grant ADMIN (see routes/auth.ts).
 *
 *   pnpm promote-admin -- +919876543210
 *
 * The person must have signed up through one of the apps first, so a User row
 * exists for their phone. Accounts with a Vendor or Rider profile are refused:
 * changing their role would lock them out of the vendor/rider app that profile
 * belongs to. Runs against whatever DATABASE_URL points at — production too,
 * deliberately, since that is where admins are needed.
 */
import '../src/lib/env';
import { prisma } from '../src/lib/prisma';

const E164_RE = /^\+[1-9]\d{7,14}$/;

async function main(): Promise<number> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const phone = args[0]?.replace(/[\s-]/g, '');
  if (!phone || args.length !== 1 || !E164_RE.test(phone)) {
    console.error('Usage: pnpm promote-admin -- <phone in E.164, e.g. +919876543210>');
    return 2;
  }

  const user = await prisma.user.findUnique({
    where: { phone },
    include: { vendor: { select: { id: true } }, rider: { select: { id: true } } },
  });
  if (!user) {
    console.error(`No user with phone ${phone}. They must sign up in an app first.`);
    return 1;
  }
  if (user.vendor || user.rider) {
    console.error(
      `Refusing: ${phone} has a ${user.vendor ? 'vendor' : 'rider'} profile. ` +
        'Promoting it would lock them out of that app; use a separate number for admin.',
    );
    return 1;
  }
  if (user.role === 'ADMIN') {
    console.log(`${phone} (user ${user.id}) is already ADMIN — nothing to do.`);
    return 0;
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { role: 'ADMIN' },
    select: { id: true, phone: true, role: true },
  });
  console.log(`Promoted ${updated.phone} (user ${updated.id}): ${user.role} -> ${updated.role}`);
  return 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await prisma.$disconnect();
    process.exit(1);
  });
