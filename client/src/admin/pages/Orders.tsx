import { useNavigate } from "react-router-dom";
import { useOrdersQuery } from "../api";
import { formatDate } from "../hooks";
import { Order } from "../../types/types";
import DataTable, { Column } from "../components/DataTable";
import { SkeletonRows } from "../components/Spinner";
import {
  Card,
  EmptyState,
  Money,
  PageHeader,
  PaymentPill,
  StatusPill,
} from "../components/ui";

const Orders = () => {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useOrdersQuery();

  const columns: Column<Order>[] = [
    {
      key: "customer",
      header: "Customer",
      value: (order) => order.user?.name ?? "",
    },
    {
      key: "placed",
      header: "Placed",
      // Sorts on the timestamp, displays the short form — the reason a column
      // separates its value from what it renders.
      value: (order) => order.createdAt ?? "",
      render: (order) => formatDate(order.createdAt),
    },
    {
      key: "items",
      header: "Items",
      align: "right",
      value: (order) => order.orderItems.length,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      value: (order) => order.total,
      render: (order) => <Money value={order.total} />,
    },
    {
      key: "payment",
      header: "Payment",
      value: (order) => order.paymentStatus ?? "Pending",
      render: (order) => <PaymentPill status={order.paymentStatus} />,
    },
    {
      key: "status",
      header: "Status",
      value: (order) => order.status,
      render: (order) => <StatusPill status={order.status} />,
    },
  ];

  return (
    <div className="l-page">
      <PageHeader
        title="Orders"
        subtitle={data ? `${data.orders.length} orders` : undefined}
      />

      <Card>
        {isLoading ? (
          <SkeletonRows rows={8} />
        ) : isError || !data ? (
          <EmptyState>Could not load orders.</EmptyState>
        ) : (
          <DataTable
            columns={columns}
            rows={data.orders}
            rowKey={(order) => order._id}
            search="Search by customer or status"
            empty="No orders yet."
            onRowClick={(order) => navigate(`/orders/${order._id}`)}
          />
        )}
      </Card>
    </div>
  );
};

export default Orders;
