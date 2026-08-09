import { GoogleAuthProvider, reauthenticateWithPopup } from "firebase/auth";
import toast from "react-hot-toast";
import { auth } from "./firebase";
import { currentIdToken } from "./config";
import { report } from "./mutation";

/**
 * Re-authentication for access changes.
 *
 * The server refuses to grant, narrow, suspend, revoke or transfer access on a
 * session where the human last actually signed in more than five minutes ago —
 * see `requireRecentAuth` in the backend. A token refreshes itself silently for
 * as long as the browser is open, so without this the only thing standing
 * between an unattended console and a new operator is the screen lock.
 *
 * The flow is: try, and if the server asks for proof, prove it and try again.
 * Asking *up front* would make every access change cost a popup even when one
 * was answered thirty seconds ago, and people click through prompts they see
 * constantly — which is the failure mode this is meant to avoid, not create.
 */

const needsReauth = (result: unknown) =>
  (result as { error?: { status?: number; data?: { code?: string } } })?.error?.data
    ?.code === "REAUTH_REQUIRED";

/**
 * Runs an access mutation, prompting for re-authentication once if asked.
 *
 * Returns the final result so the caller reports it exactly as it would any
 * other mutation. A cancelled popup returns the original challenge, which
 * `report` renders as the server's own message rather than as a crash.
 */
export const withStepUp = async <T>(run: () => Promise<T>): Promise<T> => {
  const first = await run();
  if (!needsReauth(first)) return first;

  const user = auth.currentUser;
  if (!user) return first;

  try {
    // Google is the console's only provider, so there is no method to choose
    // between here — see pages/SignIn.tsx for why.
    await reauthenticateWithPopup(user, new GoogleAuthProvider());
    // auth_time only advances on a real re-authentication, and the cached
    // token still carries the old one until it is refreshed.
    await currentIdToken(true);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request")
      toast.error("Could not confirm your identity.");
    return first;
  }

  return run();
};

/** `withStepUp`, announced — the shape the Access page's handlers want. */
export const stepUpToast = async <T>(run: () => Promise<T>, fallback: string) => {
  const result = await withStepUp(run);
  const { ok, message } = report(result, fallback);
  (ok ? toast.success : toast.error)(message);
  return ok;
};
