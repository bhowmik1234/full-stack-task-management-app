import { ReactElement } from "react";
import { Link } from "react-router-dom";
import { FiLock } from "react-icons/fi";
import type { Permission } from "../permissions";
import { useAdminSelector, useCan, useIsRoot } from "../store";
import { landingFor } from "../navigation";

/**
 * Per-section guard inside the console.
 *
 * An operator can reach a section they cannot use in three ordinary ways: a
 * bookmark from before their permissions narrowed, a link someone pasted them,
 * or the address bar. None of those is an attack and none should look like one,
 * so this explains and offers the way back rather than redirecting silently —
 * a redirect leaves someone convinced the link was broken.
 *
 * Cosmetic by design. The endpoints behind every one of these pages check the
 * same permission again, so removing this component in a debugger reveals a
 * page of failed requests, not data.
 */
const RequirePermission = ({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactElement;
}) => {
  const can = useCan();
  const permissions = useAdminSelector((state) => state.session.permissions);
  const isRoot = useIsRoot();

  if (can(permission)) return children;

  const home = landingFor(permissions, isRoot);

  return (
    <div className="c-denied">
      <FiLock aria-hidden="true" />
      <h1>You don't have access to this section</h1>
      <p>
        Your account doesn't hold the <code>{permission}</code> permission. The
        store owner can grant it from the Access page.
      </p>
      {home ? (
        <Link className="c-btn" to={home}>
          Go to what you can see
        </Link>
      ) : null}
    </div>
  );
};

export default RequirePermission;
