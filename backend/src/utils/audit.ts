import type { Request } from "express";
import { prisma } from "./db.js";

/**
 * Admin action trail.
 *
 * Auth here is a bearer uid on the query string, so a mutation carries no
 * identity once it has been applied — the row it changed does not remember who
 * changed it. Every admin write therefore records one line here, and the
 * console's Activity page reads them back.
 *
 * Deliberately not awaited by callers and deliberately swallowing its own
 * errors: an audit write must never turn a successful product update into a
 * 500. A failure is logged and the request stands. If the trail ever becomes
 * load-bearing for compliance rather than for operators, this is the line to
 * revisit — at that point the write belongs inside the mutation's transaction.
 */
export type AuditAction =
  | "product.create"
  | "product.update"
  | "product.delete"
  | "order.process"
  | "order.delete"
  // Returns. Each transition is recorded separately rather than as one
  // "return.update", because the question an operator asks the trail is which
  // of them happened and who decided — approving and refusing are the same row
  // change and very different acts.
  | "return.approve"
  | "return.reject"
  | "return.receive"
  | "return.refund"
  | "user.delete"
  | "coupon.create"
  | "coupon.update"
  | "coupon.delete"
  // Access changes. These are the actions that decide who can perform the
  // others, so they are recorded differently — see recordAuditWithin.
  | "access.grant"
  | "access.update"
  | "access.suspend"
  | "access.restore"
  | "access.revoke"
  | "access.root_transfer";

type AuditInput = {
  action: AuditAction;
  targetId?: string | null;
  summary: string;
};

export const recordAudit = (req: Request, { action, targetId, summary }: AuditInput) => {
  // adminOnly attaches the row it looked up; without it there is no actor to
  // name and writing "unknown" would be worse than not writing at all.
  const actor = req.appUser;
  if (!actor) return;

  void prisma.adminAuditLog
    .create({
      data: {
        actorId: actor.id,
        actorName: actor.name,
        action,
        targetId: targetId ?? null,
        summary: summary.slice(0, 500),
        // `app.set("trust proxy", 1)` is what makes this the real client
        // address behind the nginx container rather than the proxy's.
        ip: req.ip ?? null,
      },
    })
    .catch((error) => {
      console.error("[audit] failed to record", action, error);
    });
};

/**
 * The transactional variant, for access changes only.
 *
 * Everywhere else the trail is an operator convenience and a lost line is
 * cheaper than a failed request. Access changes are the exception: an
 * unrecorded grant is a person with permissions nobody can account for, which
 * is precisely the event the log exists for. Writing it inside the same
 * transaction as the change means either both happen or neither does.
 *
 * Takes the transaction client rather than the global one — passing `prisma`
 * here would write outside the transaction and silently lose the guarantee.
 */
export const recordAuditWithin = (
  tx: Pick<typeof prisma, "adminAuditLog">,
  req: Request,
  { action, targetId, summary }: AuditInput
) => {
  const actor = req.appUser;
  if (!actor) throw new Error("recordAuditWithin called without an actor");

  return tx.adminAuditLog.create({
    data: {
      actorId: actor.id,
      actorName: actor.name,
      action,
      targetId: targetId ?? null,
      summary: summary.slice(0, 500),
      ip: req.ip ?? null,
    },
  });
};
