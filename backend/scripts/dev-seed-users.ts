/**
 * Seeds the two accounts the client's dev sign-in bypass expects
 * (client/src/utils/devAuth.ts). Run with `npm run seed:dev`.
 *
 * The admin row is the reason this script exists: `newUser` deliberately never
 * reads `role` from the request body, so an admin can only be made in the
 * database. Refuses to run against NODE_ENV=production.
 */
import "dotenv/config";
import { prisma } from "../src/utils/db.js";
import { ALL_PERMISSIONS, GRANTABLE_PERMISSIONS } from "../src/utils/permissions.js";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed dev accounts with NODE_ENV=production.");
  process.exit(1);
}

const accounts = [
  {
    id: "dev-customer",
    name: "Dev Customer",
    email: "dev.customer@example.com",
    gender: "Female" as const,
    dob: new Date("1995-06-15"),
    role: "user" as const,
  },
  {
    id: "dev-admin",
    name: "Dev Admin",
    email: "dev.admin@example.com",
    gender: "Male" as const,
    dob: new Date("1990-01-01"),
    role: "admin" as const,
  },
];

for (const account of accounts) {
  // Upsert on the uid so re-running is harmless, and so a row the client
  // already created through /user/new gets its role corrected.
  await prisma.user.upsert({
    where: { id: account.id },
    update: { role: account.role },
    create: account,
  });
  console.log(`seeded ${account.id} (${account.role})`);
}

// Console access lives in StaffMember, not in `role` — seeding an admin row
// without one produces an account that signs in and is told it has no access,
// which looks like a bug in the console rather than a missing seed step.
//
// dev-admin gets ownership only if the store has none yet: on a developer's
// empty database that is the account you want to be root, and on anything with
// a real owner already this must not take it away from them.
const existingRoot = await prisma.staffMember.findFirst({ where: { isRoot: true } });
const asRoot = !existingRoot || existingRoot.userId === "dev-admin";

await prisma.staffMember.upsert({
  where: { userId: "dev-admin" },
  update: {
    status: "active",
    isRoot: asRoot,
    permissions: asRoot ? ALL_PERMISSIONS : GRANTABLE_PERMISSIONS,
  },
  create: {
    userId: "dev-admin",
    isRoot: asRoot,
    permissions: asRoot ? ALL_PERMISSIONS : GRANTABLE_PERMISSIONS,
    note: "Seeded by seed:dev",
  },
});
console.log(`dev-admin has console access${asRoot ? " and owns the store" : ""}`);

await prisma.$disconnect();
