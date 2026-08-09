import { adminServer, currentIdToken } from "./config";
import { getDevSession } from "../utils/devAuth";
import type { SessionPayload } from "./types";

/**
 * Loads the console session for the signed-in Firebase user.
 *
 * Plain fetch rather than an RTK Query endpoint because it runs outside React —
 * in the `onAuthStateChanged` callback that decides whether the console renders
 * at all.
 *
 * It asks `/access/me`, and the server answers from the **token**, not from
 * anything this function passes it: who the caller is, and their *effective*
 * permissions, already expanded and already emptied if their access is
 * suspended. The console never turns a role name into a permission list of its
 * own — that is how the two sides end up disagreeing about what someone may do,
 * with the client's answer being the one people see.
 */
export const fetchSession = async (): Promise<SessionPayload> => {
  const token = await currentIdToken();

  // The dev bypass has no Firebase session and so no token; the server accepts
  // `?id=` for it in development only, and refuses outright in production.
  const devUid = token ? null : getDevSession();

  const url = `${adminServer}/api/v1/access/me${
    devUid ? `?id=${encodeURIComponent(devUid)}` : ""
  }`;

  const res = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    // The server's message is the useful one here — "your session is too old",
    // "the console does not accept phone sign-in" — so it is carried up rather
    // than replaced with a status code.
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Could not load session (${res.status})`);
  }

  return (await res.json()) as SessionPayload;
};
