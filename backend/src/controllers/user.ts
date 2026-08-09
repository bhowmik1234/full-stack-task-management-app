import { NextFunction, Request, Response } from "express";
import { prisma } from "../utils/db.js";
import { newUserRequestBody } from "../types/types.js";
import ErrorHandler from "../utils/utiliy-class.js";
import { TryCatch } from "../middlewares/error.js";
import { serializeUser, serializeUsers } from "../utils/serialize.js";
import { recordAudit } from "../utils/audit.js";
import { invalidateCache } from "../utils/features.js";
import {
  providerIdentities,
  tokenAuthConfigured,
} from "../utils/firebaseAuth.js";
import {
  LIMITS,
  requireDate,
  requireEmail,
  requireHttpUrl,
  requirePhone,
  requireString,
} from "../utils/validate.js";
import { Gender } from "../generated/prisma/index.js";
import { verifyUnsubscribeToken } from "../utils/unsubscribe.js";

export const newUser = TryCatch(
  async (
    req: Request<{}, {}, newUserRequestBody>,
    res: Response,
    next: NextFunction
  ) => {
    const id = requireString(req.body._id, "id", LIMITS.userId);

    const existing = await prisma.user.findUnique({ where: { id } });
    if (existing) {
      // A closed account keeps its row (orders reference it) and keeps its
      // Firebase uid, so signing in again lands here. Silently reviving it
      // would undo a deletion the customer asked for and hand back a profile
      // that has already been anonymised — there is nothing left to restore.
      if (existing.deletedAt)
        return next(
          new ErrorHandler(
            "This account was closed. Contact support if you would like it back.",
            403
          )
        );

      return res.status(200).json({
        success: true,
        message: `welcome ${existing.name}`,
      });
    }

    const name = requireString(req.body.name, "name", LIMITS.name);
    const dob = requireDate(req.body.dob, "dob");
    const { gender } = req.body;

    // Which provider signed the user in decides which identifier is present:
    // Google gives an email (and usually a photo), phone sign-in gives a
    // number. The DB refuses a row with neither (`user_email_or_phone`), so
    // reject that here with a message instead of a 500 from the constraint.
    const email = req.body.email ? requireEmail(req.body.email) : null;
    const phone = req.body.phone ? requirePhone(req.body.phone) : null;
    if (!email && !phone)
      return next(new ErrorHandler("An email or a phone number is required", 400));

    // Phone accounts have no provider photo; the UI falls back to an initial.
    const photo = req.body.photo ? requireHttpUrl(req.body.photo, "photo") : null;

    if (gender !== "Male" && gender !== "Female")
      return next(new ErrorHandler("Gender must be Male or Female", 400));

    // both are @unique; report the clash instead of surfacing a Prisma P2002
    const taken = await prisma.user.findFirst({
      where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
    });
    if (taken)
      return next(
        new ErrorHandler(
          taken.email === email
            ? "An account with this email already exists"
            : "An account with this phone number already exists",
          409
        )
      );

    // `role` is deliberately not read from the body — an admin can only be
    // promoted directly in the database.
    const user = await prisma.user.create({
      data: {
        id,
        name,
        email,
        phone,
        gender: gender as Gender,
        photo,
        dob,
      },
    });

    return res.status(200).json({
      success: true,
      message: `welcome ${user.name}`,
    });
  }
);

/**
 * The console's customer list.
 *
 * Each row carries what the operator actually needs to act on — how many paid
 * orders the person has and what they have spent — so the page does not fire a
 * request per row to find out. Both come from one grouped aggregate rather than
 * a per-user join, and `Pending` orders are excluded: an abandoned checkout is
 * not money the customer has spent.
 */
export const getallUsers = TryCatch(async(req, res, next)=>{

    const [users, spend] = await Promise.all([
      prisma.user.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.order.groupBy({
        by: ["userId"],
        where: { paymentStatus: "Paid" },
        _count: { _all: true },
        _sum: { total: true },
      }),
    ]);

    const byUser = new Map(
      spend.map((s) => [
        s.userId,
        { orders: s._count._all, spent: Number(s._sum.total ?? 0) },
      ])
    );

    return res.status(200).json({
        success: true,
        users: serializeUsers(users).map((u: any) => ({
          ...u,
          orders: byUser.get(u.id)?.orders ?? 0,
          spent: byUser.get(u.id)?.spent ?? 0,
        })),
    })

})

export const getUser = TryCatch(async(req, res, next)=>{
    const id = String(req.params.id);

    const user = await prisma.user.findUnique({ where: { id } });
    if(!user){
        return next(new ErrorHandler("Invalid Id", 400));
    }
    return res.status(200).json({
        success: true,
        user: serializeUser(user)
    })

})

/**
 * The customer editing their own profile. Behind `requireSelf`, so there is no
 * operator path into it at all.
 *
 * Only the three fields the person actually owns are read. `email` and `phone`
 * are identity and belong to the sign-in provider — the only endpoint that
 * writes them is `syncIdentity` below, which reads them back from Firebase
 * rather than from a body. `role` is not read for the same reason `newUser`
 * does not read it: a field that grants something must never be settable by the
 * account it would grant it to.
 */
export const updateUser = TryCatch(async (req, res, next) => {
  const id = String(req.params.id);

  const data: { name?: string; gender?: Gender; dob?: Date } = {};

  if (req.body.name !== undefined)
    data.name = requireString(req.body.name, "name", LIMITS.name);

  if (req.body.gender !== undefined) {
    if (req.body.gender !== "Male" && req.body.gender !== "Female")
      return next(new ErrorHandler("Gender must be Male or Female", 400));
    data.gender = req.body.gender as Gender;
  }

  if (req.body.dob !== undefined) {
    const dob = requireDate(req.body.dob, "dob");
    if (dob.getTime() > Date.now())
      return next(new ErrorHandler("Date of birth cannot be in the future", 400));
    data.dob = dob;
  }

  if (Object.keys(data).length === 0)
    return next(new ErrorHandler("Nothing to update", 400));

  const user = await prisma.user.update({ where: { id }, data });

  return res.status(200).json({
    success: true,
    user: serializeUser(user),
    message: "Profile updated",
  });
});

/**
 * Reconciles the account's identifiers with what Firebase holds for the uid,
 * after the client has linked a second sign-in method with
 * `linkWithCredential`.
 *
 * Takes nothing from the body on purpose. Storefront auth is a bearer uid, so
 * an endpoint that believed a posted email would let anyone who learned a uid
 * write an arbitrary address onto that account — and, because the column is
 * unique, squat on an address somebody else is about to sign up with. Reading
 * it back from Firebase makes this a reconciliation of a link that already
 * happened rather than a claim about one.
 */
export const syncIdentity = TryCatch(async (req, res, next) => {
  const id = String(req.params.id);

  if (!tokenAuthConfigured())
    return next(
      new ErrorHandler(
        "Linking a sign-in method needs FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY set on the server.",
        503
      )
    );

  let identities;
  try {
    identities = await providerIdentities(id);
  } catch {
    // The uid exists in this database but not in Firebase — the dev bypass
    // accounts, or a project the server is not pointed at.
    return next(
      new ErrorHandler("No Firebase account matches this profile", 404)
    );
  }

  const email = identities.email ? requireEmail(identities.email) : null;
  const phone = identities.phone ? requirePhone(identities.phone) : null;

  if (!email && !phone)
    return next(new ErrorHandler("Nothing new to link", 400));

  // Both columns are @unique. Another row already holding the identifier means
  // the same person has two accounts here; report it instead of surfacing a
  // Prisma P2002, and do not move the identifier off the other account.
  const clash = await prisma.user.findFirst({
    where: {
      NOT: { id },
      OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
    },
  });
  if (clash)
    return next(
      new ErrorHandler(
        "That email or phone number is already on another account.",
        409
      )
    );

  const user = await prisma.user.update({
    where: { id },
    data: { email, phone },
  });

  return res.status(200).json({
    success: true,
    user: serializeUser(user),
    message: "Sign-in method linked",
  });
});

/**
 * The customer closing their own account.
 *
 * Anonymises rather than deletes, and the reason is `Order.userId`: a paid
 * order is a financial record that has to outlive the person's decision to
 * leave, and deleting the row would either violate the foreign key or take the
 * order history with it. So the identifying columns are cleared, `deletedAt` is
 * stamped — which every guard in middlewares/auth.ts refuses, so the uid stops
 * working immediately even though Firebase would still authenticate it — and
 * the rows that are purely the customer's own (wishlist, addresses, reviews)
 * are removed outright.
 *
 * Refused for an account with console access, for the same reason
 * `deleteUser` refuses it: `StaffMember` cascades, so this would otherwise be a
 * way to revoke access — including the owner's — outside the audited endpoint
 * that exists for it.
 */
/**
 * One-click unsubscribe from the email footer.
 *
 * Answers HTML rather than JSON — the caller is a browser that followed a link
 * from a mail client, and a person who clicks "unsubscribe" and lands on
 * `{"success":true}` cannot tell whether it worked.
 *
 * A bad or unsigned token is answered with the same calm page as a good one,
 * minus the confirmation: the endpoint must never become a way to test whether
 * a given uid exists, and someone whose link has been mangled by a mail client
 * is better served by "check your settings" than by a stack of red text.
 */
export const unsubscribeEmails = TryCatch(async (req, res) => {
  const userId = verifyUnsubscribeToken(req.query.token);

  // updateMany, not update: an unknown or already-closed uid updates nothing
  // and must not throw. Closed accounts are excluded because their mail has
  // already stopped.
  const done = userId
    ? (await prisma.user.updateMany({
        where: { id: userId, deletedAt: null },
        data: { emailOptOut: true },
      })).count > 0
    : false;

  const page = (heading: string, detail: string) =>
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading}</title></head>
     <body style="margin:0;padding:48px 24px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
       <div style="max-width:460px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;text-align:center;">
         <h1 style="margin:0 0 12px;font-size:20px;">${heading}</h1>
         <p style="margin:0;font-size:15px;line-height:1.6;color:#52525b;">${detail}</p>
       </div>
     </body></html>`;

  res.status(200).type("html").send(
    done
      ? page(
          "You have been unsubscribed",
          "You will no longer receive back-in-stock alerts, review requests or reminders about unfinished checkouts. Order confirmations and delivery updates still apply to orders you place — those are not marketing."
        )
      : page(
          "This link is no longer valid",
          "You can change your email preferences at any time from Settings in your account."
        )
  );
});

/** The signed-in equivalent, for the settings page. Both directions. */
export const updateEmailPreferences = TryCatch(async (req, res) => {
  const optOut = Boolean(req.body.emailOptOut);

  await prisma.user.update({
    where: { id: req.appUser!.id },
    data: { emailOptOut: optOut },
  });

  return res.status(200).json({
    success: true,
    emailOptOut: optOut,
    message: optOut ? "You will no longer receive these emails." : "Preferences saved.",
  });
});

export const closeMyAccount = TryCatch(async (req, res, next) => {
  const id = req.appUser!.id;

  const user = await prisma.user.findUnique({
    where: { id },
    include: { staff: true },
  });
  if (!user) return next(new ErrorHandler("Invalid Id", 400));

  if (user.staff)
    return next(
      new ErrorHandler(
        "This account has console access. Ask the store owner to revoke it before closing the account.",
        400
      )
    );

  // An order still holding reserved stock has to be resolved first, or closing
  // the account strands those units until the expiry sweep runs.
  const pending = await prisma.order.count({
    where: { userId: id, status: "PendingPayment" },
  });
  if (pending > 0)
    return next(
      new ErrorHandler(
        "You have a checkout waiting for payment. Pay for it or cancel it first.",
        400
      )
    );

  await prisma.$transaction(async (tx) => {
    // Reviews are attributed by name in public listings, so they go with the
    // account rather than being left signed by a person who has left.
    await tx.review.deleteMany({ where: { userId: id } });
    await tx.wishlistItem.deleteMany({ where: { userId: id } });
    await tx.address.deleteMany({ where: { userId: id } });

    await tx.user.update({
      where: { id },
      data: {
        name: "Closed account",
        email: null,
        phone: null,
        photo: null,
        deletedAt: new Date(),
      },
    });
  });

  // The reviews that just went carried this user's rating into every cached
  // product payload, and their wishlist has its own key.
  invalidateCache({ product: true, review: true, wishlist: true, userId: id, admin: true });

  return res.status(200).json({
    success: true,
    message: "Your account has been closed.",
  });
});

export const deleteUser = TryCatch(async(req, res, next)=>{
    const id = String(req.params.id);
    const user = await prisma.user.findUnique({
      where: { id },
      include: { staff: true },
    });

    if(!user) return next(new ErrorHandler("Invalid Id", 400));

    // An operator's console access is a row on their user account, so deleting
    // the account deletes the access with it (StaffMember cascades). Without
    // this check, anyone holding `customers_write` could remove a colleague —
    // or the owner — from the Customers page, which is a privilege boundary
    // being crossed sideways through an endpoint that looks unrelated.
    // Removing access is root's, and it has its own audited endpoint.
    if (user.staff)
      return next(
        new ErrorHandler(
          "That account has console access. Revoke it from the Access page first.",
          400
        )
      );

    // orders reference the user, so deleting one with order history would
    // violate the FK; report that rather than 500ing
    const orderCount = await prisma.order.count({ where: { userId: id } });
    if (orderCount > 0)
      return next(
        new ErrorHandler("Cannot delete a user who has placed orders", 400)
      );

    await prisma.user.delete({ where: { id } });

    recordAudit(req, {
      action: "user.delete",
      targetId: id,
      summary: `Deleted customer ${user.name}`,
    });

    return res.status(200).json({
        success: true,
        message: "User deleted successfully"
    })

})
