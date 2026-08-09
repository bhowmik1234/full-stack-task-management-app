-- Phone sign-in. A Firebase phone user has no email and no photo URL, so both
-- columns become nullable and a `phone` column joins them. Existing rows all
-- came from Google, so they keep their email and are unaffected.
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "photo" DROP NOT NULL;

ALTER TABLE "User" ADD COLUMN "phone" TEXT;
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- An account has to be reachable by one identifier or the other; nullable on
-- both columns must not mean nullable on both at once.
ALTER TABLE "User" ADD CONSTRAINT "user_email_or_phone"
  CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL);
