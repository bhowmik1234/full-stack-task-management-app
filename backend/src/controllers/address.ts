import { TryCatch } from "../middlewares/error.js";
import { prisma } from "../utils/db.js";
import { serializeAddress, serializeAddresses } from "../utils/serialize.js";
import ErrorHandler from "../utils/utiliy-class.js";
import {
  LIMITS,
  MAX_ADDRESSES,
  optionalString,
  requirePhone,
  requireString,
} from "../utils/validate.js";

/**
 * The customer's address book.
 *
 * Every handler takes the owner from `req.appUser` — set by `verifyUser` from
 * the authenticated uid — and never from the body or from a query parameter.
 * The row id in the path is therefore only ever a *filter*, scoped by userId in
 * the same `where`, so guessing another customer's address id gets a 404 rather
 * than their address. `updateMany`/`deleteMany` are used for exactly that
 * reason: a `findUnique` by id followed by an ownership check is two statements
 * and one race.
 *
 * Nothing here touches Order. An order carries its own copy of the address it
 * shipped to; see the comment on the Address model.
 */

/** The five shipping columns plus who to hand the parcel to. */
const readAddressBody = (body: any) => ({
  label: optionalString(body.label, "label", LIMITS.addressLabel) ?? "Home",
  fullName: requireString(body.fullName, "full name", LIMITS.name),
  phone: requirePhone(body.phone),
  address: requireString(body.address, "address", LIMITS.address),
  city: requireString(body.city, "city", LIMITS.city),
  state: requireString(body.state, "state", LIMITS.state),
  country: requireString(body.country, "country", LIMITS.country),
  pinCode: requireString(body.pinCode, "pinCode", LIMITS.pinCode),
});

/**
 * Points the single default at `addressId`, clearing whatever held it.
 *
 * Both statements run in one transaction because `address_single_default` is a
 * unique index: setting the new default before clearing the old one violates
 * it, and doing the two in separate transactions leaves a window where the
 * customer has no default at all.
 */
const setDefaultWithin = async (tx: any, userId: string, addressId: string) => {
  await tx.address.updateMany({
    where: { userId, isDefault: true, NOT: { id: addressId } },
    data: { isDefault: false },
  });
  await tx.address.update({ where: { id: addressId }, data: { isDefault: true } });
};

export const myAddresses = TryCatch(async (req, res) => {
  const userId = req.appUser!.id;

  // Default first, then newest — the order the checkout picker renders in.
  const addresses = await prisma.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });

  return res.status(200).json({
    success: true,
    addresses: serializeAddresses(addresses),
  });
});

export const newAddress = TryCatch(async (req, res, next) => {
  const userId = req.appUser!.id;
  const data = readAddressBody(req.body);

  const count = await prisma.address.count({ where: { userId } });
  if (count >= MAX_ADDRESSES)
    return next(
      new ErrorHandler(
        `You can save at most ${MAX_ADDRESSES} addresses. Delete one first.`,
        400
      )
    );

  // The first address a customer saves is their default whether they asked for
  // it or not; an address book with nothing selected makes checkout prefill
  // nothing, which is the problem this table exists to solve.
  const makeDefault = count === 0 || req.body.isDefault === true;

  const address = await prisma.$transaction(async (tx) => {
    const created = await tx.address.create({ data: { ...data, userId } });
    if (makeDefault) await setDefaultWithin(tx, userId, created.id);
    return tx.address.findUniqueOrThrow({ where: { id: created.id } });
  });

  return res.status(201).json({
    success: true,
    address: serializeAddress(address),
    message: "Address saved",
  });
});

export const updateAddress = TryCatch(async (req, res, next) => {
  const userId = req.appUser!.id;
  const id = String(req.params.id);
  const data = readAddressBody(req.body);

  // Scoped by userId in the same statement — the id alone is not authority.
  const { count } = await prisma.address.updateMany({
    where: { id, userId },
    data,
  });
  if (count === 0) return next(new ErrorHandler("Address not found", 404));

  if (req.body.isDefault === true)
    await prisma.$transaction((tx) => setDefaultWithin(tx, userId, id));

  const address = await prisma.address.findUnique({ where: { id } });

  return res.status(200).json({
    success: true,
    address: serializeAddress(address),
    message: "Address updated",
  });
});

export const setDefaultAddress = TryCatch(async (req, res, next) => {
  const userId = req.appUser!.id;
  const id = String(req.params.id);

  const owned = await prisma.address.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!owned) return next(new ErrorHandler("Address not found", 404));

  await prisma.$transaction((tx) => setDefaultWithin(tx, userId, id));

  return res.status(200).json({ success: true, message: "Default address updated" });
});

export const deleteAddress = TryCatch(async (req, res, next) => {
  const userId = req.appUser!.id;
  const id = String(req.params.id);

  const existing = await prisma.address.findFirst({ where: { id, userId } });
  if (!existing) return next(new ErrorHandler("Address not found", 404));

  await prisma.$transaction(async (tx) => {
    await tx.address.delete({ where: { id } });

    // Deleting the default would otherwise leave the book with none, and
    // checkout back to a blank form. Promote the newest survivor.
    if (existing.isDefault) {
      const next_ = await tx.address.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (next_) await setDefaultWithin(tx, userId, next_.id);
    }
  });

  return res.status(200).json({ success: true, message: "Address deleted" });
});
