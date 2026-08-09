import { useState } from "react";
import { FiPause, FiPlay, FiSearch, FiShield, FiTrash2, FiUserPlus } from "react-icons/fi";
import {
  useAccessCatalogQuery,
  useCandidatesQuery,
  useGrantAccessMutation,
  useRevokeAccessMutation,
  useSetAccessStatusMutation,
  useStaffQuery,
  useTransferRootMutation,
  useUpdateAccessMutation,
} from "../api";
import { stepUpToast } from "../stepUp";
import { formatDate, formatDateTime } from "../hooks";
import type { Permission } from "../permissions";
import type { Candidate, StaffRow } from "../types";
import PermissionPicker from "../components/PermissionPicker";
import { SkeletonRows } from "../components/Spinner";
import { Card, EmptyState, PageHeader } from "../components/ui";

/**
 * Access management. Root's page, and root's only.
 *
 * Every control here is re-authorized server-side by `requireRoot`, which is a
 * column check rather than a permission check — so there is no permission an
 * operator could be granted that reaches these endpoints. This page is the
 * interface to that rule, not the rule.
 *
 * Three things it deliberately makes hard:
 *   - granting by typed email (you pick an account you can see the name of),
 *   - granting access management (there is no checkbox; ownership transfers),
 *   - acting on your own row (the server refuses; the UI doesn't offer it).
 */

const Identity = ({ row }: { row: Pick<StaffRow, "name" | "email" | "phone" | "photo"> }) => (
  <span className="c-identity">
    {row.photo ? (
      <img className="c-thumb c-thumb--round" src={row.photo} alt="" loading="lazy" />
    ) : (
      <span className="c-initial">{row.name.charAt(0).toUpperCase()}</span>
    )}
    <span>
      <strong>{row.name}</strong>
      <small>{row.email ?? row.phone ?? "—"}</small>
    </span>
  </span>
);

/** The grant flow: search for an account, choose what it may do, grant. */
const GrantPanel = ({
  grantable,
  catalog,
  presets,
  onDone,
}: {
  grantable: Permission[];
  catalog: NonNullable<ReturnType<typeof useAccessCatalogQuery>["data"]>["permissions"];
  presets: NonNullable<ReturnType<typeof useAccessCatalogQuery>["data"]>["presets"];
  onDone: () => void;
}) => {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [note, setNote] = useState("");
  const [grant, { isLoading }] = useGrantAccessMutation();

  // The server refuses fewer than three characters, so the query is not even
  // sent until it would be accepted.
  const { data: results, isFetching } = useCandidatesQuery(query.trim(), {
    skip: query.trim().length < 3 || picked !== null,
  });

  const submit = async () => {
    if (!picked || permissions.length === 0) return;

    // Granting is one of the changes the server will not accept on a stale
    // sign-in; stepUpToast answers the challenge and retries rather than
    // surfacing it as a failure the operator can do nothing about.
    const ok = await stepUpToast(
      () => grant({ userId: picked._id, permissions, note: note || undefined }),
      "Access granted"
    );
    if (ok) onDone();
  };

  return (
    <Card
      title="Grant console access"
      hint="Find an existing account. People sign in to the shop first; access is added to the account they already have."
    >
      {picked ? (
        <div className="c-grant">
          <div className="c-grant__picked">
            <Identity row={picked} />
            <button type="button" className="c-btn c-btn--tiny" onClick={() => setPicked(null)}>
              Choose someone else
            </button>
          </div>

          <PermissionPicker
            catalog={catalog}
            grantable={grantable}
            presets={presets}
            value={permissions}
            onChange={setPermissions}
          />

          <div className="c-field">
            <label htmlFor="grant-note">Note (optional)</label>
            <input
              id="grant-note"
              value={note}
              placeholder="Warehouse team, contract to March"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="c-grant__actions">
            <button type="button" className="c-btn" onClick={onDone}>
              Cancel
            </button>
            <button
              type="button"
              className="c-btn c-btn--primary"
              disabled={isLoading || permissions.length === 0}
              onClick={submit}
            >
              <FiUserPlus aria-hidden="true" /> Grant access
            </button>
          </div>
          {permissions.length === 0 && (
            <p className="c-hint">Choose at least one permission.</p>
          )}
        </div>
      ) : (
        <div className="c-grant">
          <div className="c-field">
            <label htmlFor="grant-search">Search accounts</label>
            <div className="c-search">
              <FiSearch aria-hidden="true" />
              <input
                id="grant-search"
                value={query}
                placeholder="Name, email or phone"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          {query.trim().length < 3 ? (
            <p className="c-hint">Type at least three characters.</p>
          ) : isFetching ? (
            <p className="c-hint">Searching…</p>
          ) : results?.users.length ? (
            <ul className="c-candidates">
              {results.users.map((user) => (
                <li key={user._id}>
                  <button type="button" onClick={() => setPicked(user)}>
                    <Identity row={user} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="c-hint">
              No matching account without console access. They need to sign in to
              the shop once before access can be granted.
            </p>
          )}
        </div>
      )}
    </Card>
  );
};

/** The expanded row: edit permissions, suspend, revoke, hand over ownership. */
const StaffDetail = ({
  row,
  grantable,
  catalog,
  presets,
  onClose,
}: {
  row: StaffRow;
  grantable: Permission[];
  catalog: NonNullable<ReturnType<typeof useAccessCatalogQuery>["data"]>["permissions"];
  presets: NonNullable<ReturnType<typeof useAccessCatalogQuery>["data"]>["presets"];
  onClose: () => void;
}) => {
  const [permissions, setPermissions] = useState<Permission[]>(row.permissions);
  const [note, setNote] = useState(row.note ?? "");
  const [confirming, setConfirming] = useState<"revoke" | "transfer" | null>(null);

  const [update, { isLoading: saving }] = useUpdateAccessMutation();
  const [setStatus] = useSetAccessStatusMutation();
  const [revoke] = useRevokeAccessMutation();
  const [transfer] = useTransferRootMutation();

  const act = async (run: () => Promise<unknown>, fallback: string, close = false) => {
    if ((await stepUpToast(run, fallback)) && close) onClose();
    setConfirming(null);
  };

  return (
    <div className="c-staffdetail">
      <PermissionPicker
        catalog={catalog}
        grantable={grantable}
        presets={presets}
        value={permissions}
        onChange={setPermissions}
      />

      <div className="c-field">
        <label htmlFor={`note-${row._id}`}>Note</label>
        <input
          id={`note-${row._id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="c-staffdetail__actions">
        <button
          type="button"
          className="c-btn c-btn--primary"
          disabled={saving || permissions.length === 0}
          onClick={() =>
            act(
              () => update({ userId: row._id, permissions, note: note || null }),
              "Permissions updated"
            )
          }
        >
          Save permissions
        </button>

        <button
          type="button"
          className="c-btn"
          onClick={() =>
            act(
              () =>
                setStatus({
                  userId: row._id,
                  action: row.status === "active" ? "suspend" : "restore",
                }),
              row.status === "active" ? "Access suspended" : "Access restored"
            )
          }
        >
          {row.status === "active" ? (
            <>
              <FiPause aria-hidden="true" /> Suspend
            </>
          ) : (
            <>
              <FiPlay aria-hidden="true" /> Restore
            </>
          )}
        </button>

        {confirming === "revoke" ? (
          <span className="c-rowconfirm">
            <button type="button" className="c-btn c-btn--tiny" onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="c-btn c-btn--tiny c-btn--danger"
              onClick={() => act(() => revoke(row._id), "Access revoked", true)}
            >
              Revoke access
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="c-btn c-btn--danger"
            onClick={() => setConfirming("revoke")}
          >
            <FiTrash2 aria-hidden="true" /> Revoke
          </button>
        )}
      </div>

      <div className="c-staffdetail__transfer">
        {confirming === "transfer" ? (
          <>
            <p>
              <strong>{row.name}</strong> becomes the owner and takes over access
              management. You keep every operator permission but lose the ability
              to change who has access — only they will be able to give it back.
            </p>
            <span className="c-rowconfirm">
              <button type="button" className="c-btn c-btn--tiny" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="c-btn c-btn--tiny c-btn--danger"
                onClick={() =>
                  act(() => transfer(row._id), "Ownership transferred", true)
                }
              >
                Transfer ownership
              </button>
            </span>
          </>
        ) : (
          <button
            type="button"
            className="c-btn c-btn--ghost c-btn--tiny"
            disabled={row.status !== "active"}
            onClick={() => setConfirming("transfer")}
          >
            <FiShield aria-hidden="true" /> Make {row.name.split(" ")[0]} the owner
          </button>
        )}
      </div>
    </div>
  );
};

const Access = () => {
  const { data, isLoading, isError } = useStaffQuery();
  const { data: catalog } = useAccessCatalogQuery();
  const [granting, setGranting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const operators = data?.staff ?? [];
  const suspended = operators.filter((row) => row.status === "suspended").length;

  return (
    <div className="l-page">
      <PageHeader
        title="Access"
        subtitle={
          data
            ? `${operators.length} account${operators.length === 1 ? "" : "s"} with console access${
                suspended ? `, ${suspended} suspended` : ""
              }`
            : undefined
        }
        actions={
          catalog && (
            <button
              type="button"
              className="c-btn c-btn--primary"
              onClick={() => setGranting((open) => !open)}
            >
              <FiUserPlus aria-hidden="true" /> {granting ? "Close" : "Grant access"}
            </button>
          )
        }
      />

      {granting && catalog && (
        <GrantPanel
          grantable={catalog.grantable}
          catalog={catalog.permissions}
          presets={catalog.presets}
          onDone={() => setGranting(false)}
        />
      )}

      <Card
        title="Operators"
        hint="Suspending takes effect on their next click — there is no session to wait out."
      >
        {isLoading ? (
          <SkeletonRows rows={4} />
        ) : isError || !data ? (
          <EmptyState>Could not load the operator list.</EmptyState>
        ) : (
          <ul className="c-staff">
            {operators.map((row) => (
              <li
                key={row._id}
                className={`c-staff__row${
                  row.status === "suspended" ? " is-suspended" : ""
                }`}
              >
                <div className="c-staff__summary">
                  <Identity row={row} />

                  <span className="c-staff__meta">
                    {row.isRoot ? (
                      <span className="c-pill c-pill--info">Owner</span>
                    ) : row.status === "suspended" ? (
                      <span className="c-pill c-pill--critical">Suspended</span>
                    ) : (
                      <span className="c-pill c-pill--good">Active</span>
                    )}
                    <small>
                      {row.isRoot
                        ? "Full access, including access management"
                        : `${row.permissions.length} permission${
                            row.permissions.length === 1 ? "" : "s"
                          }`}
                    </small>
                  </span>

                  <span className="c-staff__meta">
                    <small>
                      Granted {formatDate(row.grantedAt)}
                      {row.grantedBy ? ` by ${row.grantedBy}` : ""}
                    </small>
                    {/* "Granted six months ago, never used" is exactly the row
                        an access review is looking for. */}
                    <small>
                      {row.lastActiveAt
                        ? `Last action ${formatDateTime(row.lastActiveAt)}`
                        : "No recorded activity"}
                    </small>
                  </span>

                  {row.isRoot ? (
                    <span className="c-muted">
                      Transfer ownership from another operator's row
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="c-btn c-btn--tiny"
                      onClick={() =>
                        setExpanded((open) => (open === row._id ? null : row._id))
                      }
                    >
                      {expanded === row._id ? "Close" : "Manage"}
                    </button>
                  )}
                </div>

                {row.note && <p className="c-staff__note">{row.note}</p>}

                {expanded === row._id && catalog && (
                  <StaffDetail
                    row={row}
                    grantable={catalog.grantable}
                    catalog={catalog.permissions}
                    presets={catalog.presets}
                    onClose={() => setExpanded(null)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="How access works">
        <ul className="c-notes">
          <li>
            Permissions are checked on the server for every request. Hiding a tab
            is a convenience — it is not what stops anyone.
          </li>
          <li>
            There is exactly one owner, enforced by the database. Ownership is
            transferred, never granted, so nobody can widen their own access.
          </li>
          <li>
            Every change on this page is written to the activity log inside the
            same transaction: if the log fails, the change does not happen.
          </li>
          <li>
            Revoking removes console access but keeps the person's customer
            account, their orders and their history in the activity log.
          </li>
          <li>
            Changes on this page ask you to sign in again if you last did so
            more than five minutes ago — a token refreshes itself silently, so
            it cannot tell an unattended tab from a person.
          </li>
        </ul>
      </Card>
    </div>
  );
};

export default Access;
