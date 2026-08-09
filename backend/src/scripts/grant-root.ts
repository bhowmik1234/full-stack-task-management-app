import { prisma } from "../utils/db.js";
import { ALL_PERMISSIONS } from "../utils/permissions.js";

/**
 * Bootstraps the owner account.
 *
 *   local dev:   npm run grant:root -- <firebase-uid>
 *   in a container:  node dist/scripts/grant-root.js <firebase-uid>
 *
 * It lives under src/ rather than in backend/scripts/ so that `tsc` compiles it
 * into dist/ — tsconfig only includes `src*`. That is not tidiness: the runner
 * stage of the Dockerfile copies dist/ and installs with `--omit=dev`, so a
 * script sitting outside src/ and launched through `tsx` is absent from the
 * production image *and* has no runtime to run under. It could therefore only
 * be run against a live database from a developer's laptop.
 *
 * Which would make it unrunnable in exactly the deployment that needs it: this
 * is the only way to create the *first* owner, so with no way to invoke it in a
 * container, a fresh production deploy has an admin console nobody can ever
 * sign in to.
 *
 * A shell command on purpose. Every other access change goes through the
 * console, authorized by the existing owner — but the *first* owner has no
 * owner to authorize them, and any HTTP endpoint that could create one would be
 * an endpoint that can create one at any time. Requiring shell access to the
 * server for this single case means the bootstrap path is the one an attacker
 * cannot reach over the network.
 *
 * Also the recovery path: if ownership ends up on an account nobody can sign
 * into, this is how it moves.
 */
const [userId] = process.argv.slice(2);

if (!userId) {
  console.error("Usage: npm run grant:root -- <firebase-uid>");
  process.exit(1);
}

const user = await prisma.user.findUnique({ where: { id: userId } });
if (!user) {
  console.error(`No user with id ${userId}. Sign in once on the storefront first.`);
  process.exit(1);
}

const current = await prisma.staffMember.findFirst({ where: { isRoot: true } });

if (current?.userId === userId) {
  console.log(`${user.name} is already the owner.`);
  process.exit(0);
}

await prisma.$transaction(async (tx) => {
  // The single-root index allows one at a time, so the incumbent is stood down
  // before the new owner is set. They keep every operator permission — see
  // transferRoot in controllers/access.ts for why demoting them to nothing is
  // the wrong default.
  if (current)
    await tx.staffMember.update({
      where: { userId: current.userId },
      data: {
        isRoot: false,
        permissions: ALL_PERMISSIONS.filter((p) => p !== "access_manage"),
      },
    });

  await tx.staffMember.upsert({
    where: { userId },
    create: {
      userId,
      isRoot: true,
      permissions: ALL_PERMISSIONS,
      status: "active",
      note: "Bootstrapped with grant:root",
    },
    update: { isRoot: true, permissions: ALL_PERMISSIONS, status: "active" },
  });

  await tx.user.update({ where: { id: userId }, data: { role: "admin" } });

  await tx.adminAuditLog.create({
    data: {
      actorId: "cli",
      actorName: "grant:root (shell)",
      action: "access.root_transfer",
      targetId: userId,
      summary: `Ownership set to ${user.name} from the command line`,
    },
  });
});

console.log(`${user.name} (${user.email ?? user.phone}) is now the owner account.`);
await prisma.$disconnect();
