-- Saved shipping addresses, and self-service account closure.

-- ---------------------------------------------------------------------------
-- Address book
-- ---------------------------------------------------------------------------
-- Not referenced by Order on purpose: Order keeps its own copy of the five
-- address columns, taken at checkout, because an order records where it was
-- actually sent. A foreign key would let a customer edit the destination of a
-- shipped parcel, and would break when they delete the address afterwards.
CREATE TABLE "Address" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "label"     TEXT NOT NULL DEFAULT 'Home',
    "fullName"  TEXT NOT NULL,
    "phone"     TEXT NOT NULL,
    "address"   TEXT NOT NULL,
    "city"      TEXT NOT NULL,
    "state"     TEXT NOT NULL,
    "country"   TEXT NOT NULL,
    "pinCode"   TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Address_userId_createdAt_idx" ON "Address"("userId", "createdAt");

ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- At most one default per customer. A partial unique index rather than a check
-- in the controller: "clear the old default, then set the new one" is a
-- read-then-write, and two concurrent requests both pass the read.
CREATE UNIQUE INDEX "address_single_default" ON "Address"("userId") WHERE "isDefault";

-- ---------------------------------------------------------------------------
-- Account closure
-- ---------------------------------------------------------------------------
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Closing an account clears both identifiers, so the "at least one" rule has to
-- apply to live rows only. Without this, anonymising would have to invent a
-- fake email to satisfy a constraint written for accounts that still exist.
ALTER TABLE "User" DROP CONSTRAINT "user_email_or_phone";
ALTER TABLE "User" ADD CONSTRAINT "user_email_or_phone"
  CHECK ("deletedAt" IS NOT NULL OR "email" IS NOT NULL OR "phone" IS NOT NULL);
