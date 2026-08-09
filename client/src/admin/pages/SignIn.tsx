import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { FcGoogle } from "react-icons/fc";
import { auth } from "../firebase";
import { DEV_ACCOUNTS, isDevAuthEnabled, setDevSession } from "../../utils/devAuth";
import { useAdminSelector } from "../store";

/**
 * The console's sign-in.
 *
 * **Google only** — no phone, unlike the storefront. SMS is the weakest link in
 * the set: a SIM swap or an intercepted code is a well-worn route into an
 * account, and the accounts reachable from here can read every customer record
 * and empty the catalogue. The storefront keeps phone sign-in because a
 * shopper's exposure is their own order history.
 *
 * The restriction is **not** enforced by this page. `ADMIN_SIGN_IN_PROVIDERS`
 * on the server rejects a token whose `sign_in_provider` is not on the list, so
 * signing in with SMS on the storefront and calling the admin API directly
 * fails there too. Removing the button here only saves an operator from
 * discovering that the hard way — the rule itself lives in the backend, which
 * is the only place a rule about credentials can live.
 *
 * This page also never creates an account. An operator's row exists before it
 * can be granted anything — access is given by the owner, from the Access page
 * — so there is nothing to collect here beyond proof of identity.
 */
const SignIn = () => {
  const { status } = useAdminSelector((state) => state.session);
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [busy, setBusy] = useState(false);

  // Anything but "anonymous" means the provider step is done. Whether the
  // account may actually use the console — and whether its access is merely
  // suspended, or its sign-in method refused — is RequireAdmin's to explain;
  // signing in again would not change any of those answers.
  if (status !== "anonymous" && status !== "loading")
    return <Navigate to={from} replace />;

  const google = async () => {
    try {
      setBusy(true);
      await signInWithPopup(auth, new GoogleAuthProvider());
      // onAuthStateChanged in AdminApp takes it from here.
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request")
        return;
      toast.error(
        code === "auth/popup-blocked"
          ? "Your browser blocked the sign-in popup. Allow popups for this site."
          : code === "auth/unauthorized-domain"
          ? "This domain is not authorised in the Firebase console. Add the admin host there."
          : "Sign in failed."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="c-signin">
      <div className="c-signin__card">
        <span className="c-signin__mark">eb</span>
        <h1>Console</h1>
        <p>Sign in with the account that has console access on this store.</p>

        <button
          type="button"
          className="c-btn c-btn--primary c-btn--block"
          disabled={busy}
          onClick={google}
        >
          <FcGoogle aria-hidden="true" /> Continue with Google
        </button>

        <p className="c-signin__policy">
          The console accepts Google sign-in only. Phone sign-in works on the
          shop, but not here.
        </p>

        {isDevAuthEnabled && (
          <div className="c-signin__dev">
            <p>Dev bypass</p>
            {DEV_ACCOUNTS.map((account) => (
              <button
                key={account.uid}
                type="button"
                className="c-btn c-btn--tiny"
                onClick={() => {
                  setDevSession(account.uid);
                  window.location.assign("/");
                }}
              >
                {account.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
};

export default SignIn;
