-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('analytics_read', 'orders_read', 'orders_write', 'products_read', 'products_write', 'customers_read', 'customers_write', 'coupons_read', 'coupons_write', 'activity_read', 'access_manage');

-- CreateEnum
CREATE TYPE "StaffStatus" AS ENUM ('active', 'suspended');

-- CreateTable
CREATE TABLE "StaffMember" (
    "userId" TEXT NOT NULL,
    "isRoot" BOOLEAN NOT NULL DEFAULT false,
    "permissions" "Permission"[],
    "status" "StaffStatus" NOT NULL DEFAULT 'active',
    "grantedById" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffMember_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "StaffMember_status_idx" ON "StaffMember"("status");

-- AddForeignKey
ALTER TABLE "StaffMember" ADD CONSTRAINT "StaffMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- There is exactly one root account, and the database is what says so. Root is
-- transferred, never granted a second time, so the "who else can I promote to
-- take over my own access" race cannot produce two owners. Enforcing it here
-- rather than in a handler means a bug in the transfer path fails loudly
-- instead of quietly leaving two people able to lock each other out.
CREATE UNIQUE INDEX "staff_single_root" ON "StaffMember" ((TRUE)) WHERE "isRoot";

-- Root cannot be suspended. Suspension is how access is paused, and pausing
-- the only account that can manage access locks the whole console out of its
-- own administration with no way back in over HTTP.
ALTER TABLE "StaffMember"
  ADD CONSTRAINT "staff_root_is_active" CHECK (NOT ("isRoot" AND "status" = 'suspended'));

-- Backfill: every existing role='admin' account keeps working, with the full
-- operator permission set. `access_manage` is deliberately withheld — it goes
-- to root alone, below.
INSERT INTO "StaffMember" ("userId", "permissions", "status", "grantedAt", "updatedAt", "note")
SELECT
  "id",
  ARRAY[
    'analytics_read', 'orders_read', 'orders_write',
    'products_read', 'products_write',
    'customers_read', 'customers_write',
    'coupons_read', 'coupons_write', 'activity_read'
  ]::"Permission"[],
  'active',
  NOW(),
  NOW(),
  'Migrated from role = admin'
FROM "User"
WHERE "role" = 'admin';

-- The longest-standing admin becomes root. If the store has no admin rows yet
-- this does nothing and there is no root — bootstrap one with
-- `npm run grant:root <userId>`, which is a shell command on purpose: the first
-- owner must not be creatable over HTTP.
UPDATE "StaffMember"
SET "isRoot" = TRUE,
    "permissions" = "permissions" || 'access_manage'::"Permission",
    "note" = 'Migrated from role = admin (longest-standing, made root)'
WHERE "userId" = (
  SELECT u."id"
  FROM "User" u
  JOIN "StaffMember" s ON s."userId" = u."id"
  ORDER BY u."createdAt" ASC, u."id" ASC
  LIMIT 1
);
