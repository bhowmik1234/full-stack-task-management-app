import { useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import { useDeleteUserMutation, useUsersQuery } from "../api";
import { useAdminSelector, useCan } from "../store";
import { reportToast } from "../mutation";
import { formatDate } from "../hooks";
import { AdminUser } from "../types";
import DataTable, { Column } from "../components/DataTable";
import { SkeletonRows } from "../components/Spinner";
import { Card, EmptyState, Money, PageHeader } from "../components/ui";

const Customers = () => {
  const canWrite = useCan()("customers_write");
  const signedInAs = useAdminSelector((state) => state.session.user?._id);
  const { data, isLoading, isError } = useUsersQuery();
  const [deleteUser] = useDeleteUserMutation();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const remove = async (user: AdminUser) => {
    reportToast(await deleteUser(user._id), "Customer deleted");
    setPendingDelete(null);
  };

  const columns: Column<AdminUser>[] = [
    {
      key: "avatar",
      header: "",
      width: "3rem",
      render: (user) =>
        // A phone sign-up arrives with no provider photo, and Google accounts
        // that never set one have a null here too.
        user.photo ? (
          <img className="c-thumb c-thumb--round" src={user.photo} alt="" loading="lazy" />
        ) : (
          <span className="c-initial">{user.name.charAt(0).toUpperCase()}</span>
        ),
    },
    { key: "name", header: "Name", value: (user) => user.name },
    {
      key: "contact",
      header: "Contact",
      // Exactly one of these is set, decided by the sign-in provider.
      value: (user) => user.email ?? user.phone ?? "",
      render: (user) => user.email ?? user.phone ?? "—",
    },
    {
      key: "role",
      header: "Role",
      value: (user) => user.role,
      render: (user) =>
        user.role === "admin" ? (
          <span className="c-pill c-pill--info">Admin</span>
        ) : (
          <span className="c-pill c-pill--muted">Customer</span>
        ),
    },
    {
      key: "orders",
      header: "Orders",
      align: "right",
      value: (user) => user.orders,
    },
    {
      key: "spent",
      header: "Spent",
      align: "right",
      value: (user) => user.spent,
      render: (user) => <Money value={user.spent} />,
    },
    {
      key: "joined",
      header: "Joined",
      value: (user) => user.createdAt ?? "",
      render: (user) => formatDate(user.createdAt),
    },
    {
      key: "action",
      header: "",
      align: "right",
      width: "8rem",
      render: (user) => {
        // No delete permission, no delete control — the endpoint refuses it
        // either way, and a button that always fails is worse than none.
        if (!canWrite) return null;
        // Deleting yourself would lock the console's only operator out of it,
        // and a customer with orders is refused by the API anyway (the FK from
        // Order would be orphaned) — so neither is offered.
        if (user._id === signedInAs)
          return <span className="c-muted">You</span>;
        if (user.orders > 0)
          return <span className="c-muted">Has orders</span>;

        return pendingDelete === user._id ? (
          <span className="c-rowconfirm">
            <button type="button" className="c-btn c-btn--tiny" onClick={() => setPendingDelete(null)}>
              Cancel
            </button>
            <button type="button" className="c-btn c-btn--tiny c-btn--danger" onClick={() => remove(user)}>
              Delete
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="c-iconbtn"
            aria-label={`Delete ${user.name}`}
            onClick={() => setPendingDelete(user._id)}
          >
            <FiTrash2 />
          </button>
        );
      },
    },
  ];

  return (
    <div className="l-page">
      <PageHeader
        title="Customers"
        subtitle={data ? `${data.users.length} accounts` : undefined}
      />

      <Card>
        {isLoading ? (
          <SkeletonRows rows={8} />
        ) : isError || !data ? (
          <EmptyState>Could not load customers.</EmptyState>
        ) : (
          <DataTable
            columns={columns}
            rows={data.users}
            rowKey={(user) => user._id}
            search="Search by name or contact"
            empty="No accounts yet."
          />
        )}
      </Card>
    </div>
  );
};

export default Customers;
