import { Permission, Prisma, StaffMember, User } from "../generated/prisma/index.js";
import { TryCatch } from "../middlewares/error.js";
import { recordAuditWithin } from "../utils/audit.js";
import { prisma } from "../utils/db.js";
import {
  ALL_PERMISSIONS,
  GRANTABLE_PERMISSIONS,
  PERMISSION_META,
  PRESETS,
  effectivePermissions,
  expandPermissions,
} from "../utils/permissions.js";
import ErrorHandler from "../utils/utiliy-class.js";
import { LIMITS, requireString } from "../utils/validate.js";

/**
 * Console access management.
 *
 * Everything here is behind `requireRoot`, except `me` — which has to be
 * callable by anyone signed in, because "you are not staff" is one of the
 * answers it exists to give.
 *
 * Two rules run through the whole file:
 *
 *   1. Root is never granted, only transferred. `access_manage` is refused as
 *      an ordinary permission, so there is no path by which an operator ends up
 *      able to widen their own access.
 *   2. Root cannot act on its own row. Self-suspension and self-revocation
 *      would lock the store out of its own administration with no way back in
 *      over HTTP, and "there is a shell script for that" is not an answer at
 *      3am.
 */

type StaffRow = StaffMember & { user: User };

const publicUser = (user: User) => ({
  _id: user.id,
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  photo: user.photo,
});

const serializeStaff = (
  row: StaffRow,
  extras: { grantedBy?: string | null; lastActiveAt?: Date | null } = {}
) => ({
  ...publicUser(row.user),
  isRoot: row.isRoot,
  status: row.status,
  permissions: effectivePermissions(row),
  note: row.note,
  grantedAt: row.grantedAt,
  grantedById: row.grantedById,
  grantedBy: extras.grantedBy ?? null,
  lastActiveAt: extras.lastActiveAt ?? null,
});

/**
 * Who am I, and what may I do — the console's bootstrap call.
 *
 * The permission list is computed server-side and sent whole. The alternative,
 * shipping a role name and letting the client expand it, gives the two sides
 * two copies of the same rule that drift the first time one changes.
 *
 * Behind `verifyUser`, not `requireStaff`: a signed-in customer needs a real
 * answer here, and `staff: null` is that answer.
 */
export const me = TryCatch(async (req, res) => {
  const user = req.appUser!;
  const staff = req.staff ?? null;

  return res.status(200).json({
    success: true,
    user: publicUser(user),
    staff: staff
      ? {
          isRoot: staff.isRoot,
          status: staff.status,
          // A suspended operator is told they are suspended and given nothing
          // else. Sending the permission list they *would* have would let the
          // console render a working-looking UI against a door that is shut.
          permissions: staff.status === "active" ? effectivePermissions(staff) : [],
          grantedAt: staff.grantedAt,
        }
      : null,
  });
});

/** The permission catalog and presets, so the console never hardcodes them. */
export const catalog = TryCatch(async (req, res) => {
  return res.status(200).json({
    success: true,
    permissions: PERMISSION_META,
    grantable: GRANTABLE_PERMISSIONS,
    presets: Object.entries(PRESETS).map(([name, preset]) => ({ name, ...preset })),
  });
});

/** Everyone who can open the console, with who let them in and when. */
export const listStaff = TryCatch(async (req, res) => {
  const rows = await prisma.staffMember.findMany({
    include: { user: true },
    orderBy: [{ isRoot: "desc" }, { grantedAt: "asc" }],
  });

  // Two lookups rather than N: the granter's name, and when each operator last
  // did anything. "Granted six months ago, never used it" is exactly the row a
  // review wants to find.
  const [granters, lastActive] = await Promise.all([
    prisma.user.findMany({
      where: {
        id: { in: [...new Set(rows.map((r) => r.grantedById).filter(Boolean))] as string[] },
      },
      select: { id: true, name: true },
    }),
    prisma.adminAuditLog.groupBy({
      by: ["actorId"],
      where: { actorId: { in: rows.map((r) => r.userId) } },
      _max: { createdAt: true },
    }),
  ]);

  const nameOf = new Map(granters.map((g) => [g.id, g.name]));
  const activeAt = new Map(lastActive.map((a) => [a.actorId, a._max.createdAt]));

  return res.status(200).json({
    success: true,
    staff: rows.map((row) =>
      serializeStaff(row, {
        grantedBy: row.grantedById ? nameOf.get(row.grantedById) ?? null : null,
        lastActiveAt: activeAt.get(row.userId) ?? null,
      })
    ),
  });
});

/**
 * Finds an account to grant access to.
 *
 * Granting takes a uid, never a typed email, and this is where the uid comes
 * from: the operator picks a row they can see the name and address of. Typing
 * an address into a grant form is how access ends up on the wrong account with
 * a similar address, and nothing about that failure is visible afterwards.
 */
export const candidates = TryCatch(async (req, res, next) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 3)
    return next(new ErrorHandler("Type at least three characters to search", 400));

  const users = await prisma.user.findMany({
    where: {
      staff: null, // already-staff accounts are managed from the list, not granted again
      OR: [
        { email: { contains: q, mode: "insensitive" } },
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ],
    },
    take: 10,
    orderBy: { createdAt: "desc" },
  });

  return res.status(200).json({ success: true, users: users.map(publicUser) });
});

/** Validates a submitted permission list into what will actually be stored. */
const readPermissions = (raw: unknown): Permission[] => {
  if (!Array.isArray(raw))
    throw new ErrorHandler("Permissions must be a list", 400);

  for (const value of raw) {
    if (!ALL_PERMISSIONS.includes(value as Permission))
      throw new ErrorHandler(`Unknown permission: ${String(value)}`, 400);

    // The escalation guard. `access_manage` is what would let its holder grant
    // themselves everything else, so it is refused here rather than filtered
    // out silently — an operator who tried to send it should be told no.
    if (!GRANTABLE_PERMISSIONS.includes(value as Permission))
      throw new ErrorHandler(
        "Access management belongs to the owner account and cannot be granted",
        400
      );
  }

  const permissions = expandPermissions(raw as Permission[]);
  if (permissions.length === 0)
    throw new ErrorHandler("Choose at least one permission", 400);

  return permissions;
};

const readNote = (raw: unknown) =>
  raw === undefined || raw === null || raw === ""
    ? null
    : requireString(raw, "note", LIMITS.name);

/** Names permissions in a way the activity page reads as a sentence. */
const summarize = (permissions: Permission[]) =>
  permissions.length === GRANTABLE_PERMISSIONS.length
    ? "all operator permissions"
    : permissions.join(", ");

export const grantAccess = TryCatch(async (req, res, next) => {
  const userId = requireString(req.body?.userId, "userId", LIMITS.userId);
  const permissions = readPermissions(req.body?.permissions);
  const note = readNote(req.body?.note);

  const target = await prisma.user.findUnique({
    where: { id: userId },
    include: { staff: true },
  });
  if (!target) return next(new ErrorHandler("No such account", 404));
  if (target.staff)
    return next(
      new ErrorHandler("That account already has console access", 409)
    );

  await prisma.$transaction(async (tx) => {
    await tx.staffMember.create({
      data: {
        userId,
        permissions,
        status: "active",
        grantedById: req.appUser!.id,
        note,
      },
    });

    // `role` is the storefront's hint, kept in step here and nowhere else. No
    // server-side decision reads it any more, so the worst a stale value could
    // do is render a link to a door that refuses.
    await tx.user.update({ where: { id: userId }, data: { role: "admin" } });

    await recordAuditWithin(tx, req, {
      action: "access.grant",
      targetId: userId,
      summary: `Granted ${target.name} console access: ${summarize(permissions)}`,
    });
  });

  return res
    .status(201)
    .json({ success: true, message: `${target.name} now has console access` });
});

/** The row being acted on, with the checks every mutation shares. */
const loadTarget = async (req: { params: { userId?: string } }, actorId: string) => {
  const userId = String(req.params.userId ?? "");
  const staff = await prisma.staffMember.findUnique({
    where: { userId },
    include: { user: true },
  });

  if (!staff) throw new ErrorHandler("That account has no console access", 404);

  if (staff.userId === actorId)
    throw new ErrorHandler(
      "You cannot change your own access. Transfer ownership first.",
      400
    );

  if (staff.isRoot)
    throw new ErrorHandler(
      "That is the owner account. Transfer ownership to change it.",
      400
    );

  return staff;
};

export const updateAccess = TryCatch(async (req, res) => {
  const permissions = readPermissions(req.body?.permissions);
  const note = readNote(req.body?.note);
  const target = await loadTarget(req, req.appUser!.id);

  await prisma.$transaction(async (tx) => {
    await tx.staffMember.update({
      where: { userId: target.userId },
      data: { permissions, note },
    });

    await recordAuditWithin(tx, req, {
      action: "access.update",
      targetId: target.userId,
      summary: `Set ${target.user.name}'s permissions to ${summarize(permissions)}`,
    });
  });

  return res
    .status(200)
    .json({ success: true, message: `Updated ${target.user.name}'s access` });
});

/**
 * Suspend and restore.
 *
 * Suspension takes effect on the operator's very next request — every guard
 * re-reads the row, there is no token to wait out. That immediacy is the point:
 * it is the control you reach for when something is wrong and you do not yet
 * know what.
 */
export const setStatus = (status: "active" | "suspended") =>
  TryCatch(async (req, res) => {
    const target = await loadTarget(req, req.appUser!.id);

    if (target.status === status)
      return res.status(200).json({
        success: true,
        message: `${target.user.name} is already ${
          status === "active" ? "active" : "suspended"
        }`,
      });

    await prisma.$transaction(async (tx) => {
      await tx.staffMember.update({ where: { userId: target.userId }, data: { status } });
      await tx.user.update({
        where: { id: target.userId },
        data: { role: status === "active" ? "admin" : "user" },
      });

      await recordAuditWithin(tx, req, {
        action: status === "active" ? "access.restore" : "access.suspend",
        targetId: target.userId,
        summary: `${status === "active" ? "Restored" : "Suspended"} ${
          target.user.name
        }'s console access`,
      });
    });

    return res.status(200).json({
      success: true,
      message: `${target.user.name}'s access is now ${
        status === "active" ? "active" : "suspended"
      }`,
    });
  });

/**
 * Revoke.
 *
 * Deletes the grant but not the account, and not the audit trail — AdminAuditLog
 * carries no foreign keys precisely so a revoked operator's history outlives
 * their access. That history is the thing you most want to read after revoking
 * someone.
 */
export const revokeAccess = TryCatch(async (req, res) => {
  const target = await loadTarget(req, req.appUser!.id);

  await prisma.$transaction(async (tx) => {
    await tx.staffMember.delete({ where: { userId: target.userId } });
    await tx.user.update({ where: { id: target.userId }, data: { role: "user" } });

    await recordAuditWithin(tx, req, {
      action: "access.revoke",
      targetId: target.userId,
      summary: `Revoked ${target.user.name}'s console access`,
    });
  });

  return res
    .status(200)
    .json({ success: true, message: `${target.user.name} no longer has access` });
});

/**
 * Hands the owner account to someone else.
 *
 * The outgoing root does not lose the console — they keep every operator
 * permission and lose only the ability to manage access. Demoting them to
 * nothing would make "transfer ownership" a move nobody dares make, and the
 * store ends up with a root account belonging to someone who left.
 *
 * `staff_single_root` (a partial unique index) is what actually guarantees
 * there is one owner; the ordering below exists so the constraint is never
 * momentarily violated inside the transaction.
 */
export const transferRoot = TryCatch(async (req, res, next) => {
  const userId = requireString(req.body?.userId, "userId", LIMITS.userId);

  if (req.body?.confirm !== "TRANSFER")
    return next(
      new ErrorHandler("Confirm the transfer by sending confirm: \"TRANSFER\"", 400)
    );

  if (userId === req.appUser!.id)
    return next(new ErrorHandler("You already own this store", 400));

  const target = await prisma.staffMember.findUnique({
    where: { userId },
    include: { user: true },
  });

  if (!target)
    return next(
      new ErrorHandler("Ownership can only go to someone who already has console access", 400)
    );

  if (target.status !== "active")
    return next(new ErrorHandler("That operator's access is suspended", 400));

  const outgoing = req.appUser!.id;

  await prisma.$transaction(
    async (tx) => {
      // Clear first: the unique index permits one root at a time, so setting
      // the new one before releasing the old one fails.
      await tx.staffMember.update({
        where: { userId: outgoing },
        data: { isRoot: false, permissions: GRANTABLE_PERMISSIONS },
      });

      await tx.staffMember.update({
        where: { userId },
        data: { isRoot: true, permissions: ALL_PERMISSIONS },
      });

      await recordAuditWithin(tx, req, {
        action: "access.root_transfer",
        targetId: userId,
        summary: `Transferred store ownership to ${target.user.name}`,
      });
    },
    // Serializable: two concurrent transfers would otherwise both read one root
    // and race to replace it. The unique index would catch it, but as a 500;
    // this makes it a clean retryable conflict.
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );

  return res.status(200).json({
    success: true,
    message: `${target.user.name} is now the owner. You keep full operator access.`,
  });
});
