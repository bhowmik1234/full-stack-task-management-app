import { ReactElement } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { clearDevSession } from "../../utils/devAuth";
import { useAdminSelector } from "../store";
import Spinner from "./Spinner";

/**
 * The console's front door.
 *
 * Four outcomes, because each one needs a different sentence. A signed-in
 * customer is *not* sent back to the sign-in form — they have already signed
 * in, and doing it again would change nothing — and someone whose access was
 * suspended is told that specifically, because "you have no access" would send
 * them chasing a sign-in problem that isn't one.
 *
 * This guard is a courtesy to the operator, never a security boundary: every
 * endpoint behind it re-checks the caller's permissions server-side.
 */

const Gate = ({
  title,
  children,
}: {
  title: string;
  children: ReactElement | string;
}) => (
  <div className="c-gate">
    <div className="c-gate__card">
      <h1>{title}</h1>
      <p>{children}</p>
      <button
        type="button"
        className="c-btn c-btn--ghost"
        onClick={async () => {
          clearDevSession();
          await signOut(auth).catch(() => {});
        }}
      >
        Sign out
      </button>
    </div>
  </div>
);

const RequireAdmin = ({ children }: { children: ReactElement }) => {
  const { status, user, message } = useAdminSelector((state) => state.session);
  const location = useLocation();

  if (status === "loading") return <Spinner full />;

  if (status === "anonymous")
    return (
      <Navigate
        to="/sign-in"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );

  if (status === "forbidden")
    return (
      <Gate title="No console access">
        <>
          You are signed in as <strong>{user?.name}</strong>, which does not have
          access to this console. Access is granted by the store owner — ask them
          to add your account.
        </>
      </Gate>
    );

  // The provider let them in and the server did not. Signing in again the same
  // way would produce the same refusal, so the server's reason is the whole
  // content of this screen.
  if (status === "rejected")
    return (
      <Gate title="Sign-in not accepted">
        {message ?? "The console could not accept this sign-in."}
      </Gate>
    );

  if (status === "suspended")
    return (
      <Gate title="Access suspended">
        <>
          <strong>{user?.name}</strong>'s console access has been suspended. The
          account still exists and nothing has been deleted — the store owner can
          restore it.
        </>
      </Gate>
    );

  return children;
};

export default RequireAdmin;
