import { Link } from "react-router-dom";
import { useAnalyticsQuery } from "../api";
import { useCan } from "../store";
import { formatBucket, formatDate, useRange } from "../hooks";
import { formatINR } from "../../utils/features";
import { uploadUrl } from "../config";
import RangePicker from "../components/RangePicker";
import StatCard from "../components/StatCard";
import TrendChart from "../components/TrendChart";
import BarList from "../components/BarList";
import Spinner, { SkeletonRows } from "../components/Spinner";
import {
  Card,
  EmptyState,
  Money,
  PageHeader,
  StatusPill,
  compactINR,
} from "../components/ui";

/**
 * The landing page: what happened in the window, and what needs attention now.
 *
 * Everything here comes from the one /dashboard/analytics call, so no two tiles
 * can be measuring different periods.
 */
const Overview = () => {
  // The overview summarises sections the reader may not be able to open. A
  // link into one of those is a promise the console then breaks, so the panel
  // stays and the link goes.
  const can = useCan();
  const canProducts = can("products_read");
  const canOrders = can("orders_read");
  const [range, setRange] = useRange();
  const { data, isLoading, isFetching, isError } = useAnalyticsQuery(range);

  if (isLoading) return <Spinner full />;

  if (isError || !data)
    return (
      <div className="l-page">
        <PageHeader title="Overview" />
        <EmptyState>Could not load analytics. Try reloading the page.</EmptyState>
      </div>
    );

  const { kpis, series, granularity, topProducts, inventory, recentOrders, checkouts } = data;

  return (
    <div className="l-page">
      <PageHeader
        title="Overview"
        subtitle={`${formatDate(data.window.start)} — today`}
        actions={<RangePicker value={range} onChange={setRange} />}
      />

      <div className={isFetching ? "l-stack is-stale" : "l-stack"}>
        <div className="l-statgrid">
          <StatCard
            label="Revenue"
            value={formatINR(kpis.revenue.value)}
            change={kpis.revenue.change}
            hint="paid orders only"
          />
          <StatCard label="Orders" value={kpis.orders.value} change={kpis.orders.change} />
          <StatCard
            label="Average order"
            value={formatINR(kpis.aov.value)}
            change={kpis.aov.change}
          />
          <StatCard
            label="Checkout conversion"
            value={`${kpis.conversion.value}%`}
            change={kpis.conversion.change}
            hint={`${checkouts.paid} of ${checkouts.started} paid`}
          />
        </div>

        <Card
          title="Revenue"
          hint={granularity === "day" ? "by day" : "by month"}
          className="c-card--chart"
        >
          <TrendChart
            labels={series.map((point) => formatBucket(point.bucket, granularity))}
            data={series.map((point) => point.revenue)}
            format={compactINR}
            label="Revenue"
          />
        </Card>

        <div className="l-split">
          <Card
            title="Top products"
            hint="by revenue in this period"
            actions={canProducts && <Link to="/products" className="c-link">All products</Link>}
          >
            {topProducts.length === 0 ? (
              <EmptyState>No paid orders in this period.</EmptyState>
            ) : (
              <BarList
                format={(value) => <Money value={value} />}
                items={topProducts.map((product) => ({
                  id: product._id,
                  label: product.name,
                  value: product.revenue,
                  meta: `${product.units} sold`,
                }))}
              />
            )}
          </Card>

          <Card
            title="Running low"
            hint={`${inventory.lowStockThreshold} or fewer in stock`}
            actions={canProducts && <Link to="/products" className="c-link">Restock</Link>}
          >
            {/* The two totals, above the capped list. The list is the eight
                most urgent rows; without these counts the panel could only say
                "eight products are low" whether the real figure was eight or
                eight hundred, and the operator had no way to tell which. */}
            <div className="c-stock-summary">
              <div>
                <span className="c-stock-summary__label">Running low</span>
                <strong>{inventory.lowStockCount}</strong>
              </div>
              <div>
                <span className="c-stock-summary__label">Out of stock</span>
                <strong className={inventory.outOfStockCount > 0 ? "is-critical" : undefined}>
                  {inventory.outOfStockCount}
                </strong>
              </div>
            </div>

            {inventory.lowStock.length === 0 ? (
              <EmptyState>
                Every product has more than {inventory.lowStockThreshold} in stock.
              </EmptyState>
            ) : (
              <ul className="c-lowstock">
                {inventory.lowStock.map((product) => (
                  <li key={product._id}>
                    <img src={uploadUrl(product.photo)} alt="" loading="lazy" />
                    {/* This ternary was written without braces, so the string
                        "canProducts ? " rendered as literal text next to every
                        product name and neither branch was ever evaluated. */}
                    {canProducts ? (
                      <Link to={`/products/${product._id}`}>{product.name}</Link>
                    ) : (
                      <span>{product.name}</span>
                    )}
                    <span className={product.stock === 0 ? "c-pill c-pill--critical" : "c-pill c-pill--warning"}>
                      {product.stock === 0 ? "Out of stock" : `${product.stock} left`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <Card
          title="Latest orders"
          actions={canOrders && <Link to="/orders" className="c-link">All orders</Link>}
        >
          {recentOrders.length === 0 ? (
            <SkeletonRows rows={3} />
          ) : (
            <ul className="c-orderlist">
              {recentOrders.map((order) => (
                <li key={order._id}>
                  {/* Same missing-braces bug as the low-stock list above: the
                      condition rendered as text and the link never appeared. */}
                  {canOrders ? (
                    <Link to={`/orders/${order._id}`}>{order.customer}</Link>
                  ) : (
                    <span>{order.customer}</span>
                  )}
                  <span className="c-orderlist__meta">
                    {order.items} item{order.items === 1 ? "" : "s"} · {formatDate(order.createdAt)}
                  </span>
                  <StatusPill status={order.status} />
                  <strong>
                    <Money value={order.total} />
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
};

export default Overview;
