import { Resend } from "resend";

/**
 * Outbound email, in one place.
 *
 * Every send from this module is **fire-and-forget and swallows its own
 * errors**, exactly like `recordAudit` and for the same reason: the things that
 * trigger mail here are payments and fulfilment transitions that have already
 * committed. A customer whose money has moved must not see a 500 because a
 * third-party mail API was slow, and an order must never fail to ship because
 * the shipping notice could not be delivered. Mail is a notification *about* a
 * thing that happened, never part of whether it happened.
 *
 * That means a failed send is only ever visible in the logs. If mail ever
 * becomes something the business cannot lose — an invoice it is legally obliged
 * to deliver — it needs a queue with retries, not a stricter version of this.
 */

const FROM = () => process.env.MAIL_FROM || "";
const apiKey = () => process.env.RESEND_API_KEY || "";

let client: Resend | null = null;

/**
 * Built on first use, not at import. `utils/db.ts` documents the same trap: ESM
 * evaluates every import before `app.ts` reaches its own `config()`, so a
 * module-level read of process.env sees `undefined` for anything that comes
 * from a `.env` file, and the feature silently disables itself on exactly the
 * deploys that configure it that way.
 */
const resend = () => {
  if (!client && apiKey()) client = new Resend(apiKey());
  return client;
};

export const mailConfigured = () => Boolean(apiKey() && FROM());

export type Mail = {
  to: string;
  subject: string;
  html: string;
  /**
   * Plain-text alternative. Not optional by choice: a message with no text part
   * scores worse with spam filters and is unreadable in text-only clients, and
   * these are transactional messages that must arrive.
   */
  text: string;
};

/**
 * Sends, or explains in the log why it did not. Never throws, never rejects.
 *
 * Returns whether the message was handed to the provider, which callers may
 * ignore — it exists for tests and for the dev-time log line, not to be
 * branched on in a request handler.
 */
export const sendMail = async (mail: Mail): Promise<boolean> => {
  try {
    // A missing address is normal here rather than exceptional: User.email is
    // nullable because a phone sign-in has no address at all, so "nobody to
    // tell" is a routine outcome and not a failure worth logging loudly.
    if (!mail.to) return false;

    if (!mailConfigured()) {
      // In development this is the expected path and printing the message is
      // the useful behaviour. In production it means mail was configured
      // wrong, which is worth an error even though nothing can be done here.
      const note = `[mail] not configured — would send "${mail.subject}" to ${mail.to}`;
      if (process.env.NODE_ENV === "production") console.error(note);
      else console.log(note);
      return false;
    }

    const { error } = await resend()!.emails.send({
      from: FROM(),
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });

    // The SDK reports API-level failures in the body rather than by throwing,
    // so a send can "succeed" and still not have been accepted.
    if (error) {
      console.error(`[mail] ${mail.subject} -> ${mail.to} rejected:`, error);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`[mail] ${mail.subject} -> ${mail.to} failed:`, error);
    return false;
  }
};

/**
 * `sendMail` detached from the caller's promise chain.
 *
 * The call sites are inside or immediately after transactions that have already
 * committed; awaiting a third-party HTTP round trip there would add its latency
 * to the customer's checkout response for no benefit to them. `void` is
 * deliberate and is what makes the fire-and-forget contract visible at the call
 * site rather than buried in this file.
 */
export const queueMail = (mail: Mail) => void sendMail(mail);
