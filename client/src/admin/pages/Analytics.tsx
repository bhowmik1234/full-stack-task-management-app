import { useState } from "react";
import { useAnalyticsQuery } from "../api";
import { formatBucket, formatDate, useRange } from "../hooks";
import { formatINR } from "../../utils/features";
import RangePicker from "../components/RangePicker";
import StatCard from "../components/StatCard";
import TrendChart from "../components/TrendChart";
import BarList from "../components/BarList";
import Spinner from "../components/Spinner";
import { Card, EmptyState, Money, PageHeader, compactINR } from "../components/ui";

type Measure = "revenue" | "orders";

// Statuses in an order that keeps green and red apart: adjacent hues are what
// colour-vision deficiency confuses, and delivered-vs-cancelled side by side is
// the classic failing pair. Every row also carries its name and its count as
// text, so the colour is reinforcement rather than the message.
const FULFILMENT = [
  { key: "processing", label: "Processing", color: "#3987e5" },
  { key: "delivered", label: "Delivered", color: "#0ca30c" },
  { key: "shipped", label: "Shipped", color: "#fab219" },
  { key: "cancelled", label: "Cancelled", color: "#d03b3b" },
] as const;

const Analytics = () => {
  const [range, setRange] = useRange();
  const [measure, setMeasure] = useState<Measure>("revenue");
  const { data, isLoading, isFetching, isError } = useAnalyticsQuery(range);

  if (isLoading) return <Spinner full />;

  if (isError || !data)
    return (
      <div className="l-page">
        <PageHeader title="Analytics" />
        <EmptyState>Could not load analytics. Try reloading the page.</EmptyState>
      </div>
    );

  const {
    kpis,
    series,
    granularity,
    topProducts,
    topCategories,
    fulfilment,
    checkouts,
    customers,
    inventory,
  } = data;

  const labels = series.map((point) => formatBucket(point.bucket, granularity));

  return (
    <div className="l-page">
      <PageHeader
        title="Analytics"
        subtitle={`${formatDate(data.window.start)} — today, compared with the preceding ${
          range === "12m" ? "12 months" : range.replace("d", " days")
        }`}
        actions={<RangePicker value={range} onChange={setRange} />}
      />

      <div className={isFetching ? "l-stack is-stale" : "l-stack"}>
        <div className="l-statgrid">
          <StatCard
            label="Revenue"
            value={formatINR(kpis.revenue.value)}
            change={kpis.revenue.change}
          />
          <StatCard label="Orders" value={kpis.orders.value} change={kpis.orders.change} />
          <StatCard label="Units sold" value={kpis.units.value} change={kpis.units.change} />
          <StatCard
            label="Average order"
            value={formatINR(kpis.aov.value)}
            change={kpis.aov.change}
          />
          <StatCard
            label="New customers"
            value={kpis.customers.value}
            change={kpis.customers.change}
          />
          <StatCard
            label="Checkout conversion"
            value={`${kpis.conversion.value}%`}
            change={kpis.conversion.change}
          />
        </div>

        <Card
          className="c-card--chart"
          title={measure === "revenue" ? "Revenue over time" : "Orders over time"}
          hint={granularity === "day" ? "by day" : "by month"}
          actions={
            // Two measures, one axis, one at a time. Revenue is in rupees and
            // orders are in single digits; on a shared scale the order line
            // would sit flat on the baseline, and giving it its own axis would
            // let the two curves be slid into any apparent relationship at all.
            <div className="c-range" role="group" aria-label="Measure">
              <button
                type="button"
                aria-pressed={measure === "revenue"}
                className={measure === "revenue" ? "is-active" : undefined}
                onClick={() => setMeasure("revenue")}
              >
                Revenue
              </button>
              <button
                type="button"
                aria-pressed={measure === "orders"}
                className={measure === "orders" ? "is-active" : undefined}
                onClick={() => setMeasure("orders")}
              >
                Orders
              </button>
            </div>
          }
        >
          <TrendChart
            labels={labels}
            data={series.map((point) => (measure === "revenue" ? point.revenue : point.orders))}
            format={measure === "revenue" ? compactINR : (value) => String(Math.round(value))}
            label={measure === "revenue" ? "Revenue" : "Orders"}
          />
        </Card>

        <div className="l-split">
          <Card title="Top products" hint="by revenue">
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

          <Card title="Top categories" hint="by revenue">
            {topCategories.length === 0 ? (
              <EmptyState>No paid orders in this period.</EmptyState>
            ) : (
              <BarList
                format={(value) => <Money value={value} />}
                items={topCategories.map((category) => ({
                  id: category.category,
                  label: category.category,
                  value: category.revenue,
                  meta: `${category.units} sold`,
                }))}
              />
            )}
          </Card>
        </div>

        <div className="l-split">
          <Card title="Fulfilment" hint="orders placed in this period">
            <BarList
              format={(value) => value}
              items={FULFILMENT.map((status) => ({
                id: status.key,
                label: status.label,
                value: fulfilment[status.key],
                color: status.color,
              }))}
            />
          </Card>

          <Card title="Checkout funnel">
            <dl className="c-facts">
              <div>
                <dt>Checkouts started</dt>
                <dd>{checkouts.started}</dd>
              </div>
              <div>
                <dt>Paid</dt>
                <dd>{checkouts.paid}</dd>
              </div>
              <div>
                <dt>Abandoned</dt>
                <dd>
                  {checkouts.abandoned}
                  <small>{checkouts.abandonRate}% of checkouts</small>
                </dd>
              </div>
              <div>
                <dt>Repeat buyers</dt>
                <dd>
                  {customers.repeatBuyers}
                  <small>{customers.repeatRate}% of {customers.buyers} buyers</small>
                </dd>
              </div>
            </dl>
            <p className="c-note">
              An abandoned checkout is an order row that was created and never
              paid for. It holds stock until it expires, which is what the
              30-minute sweep releases.
            </p>
          </Card>
        </div>

        <Card title="Inventory">
          <dl className="c-facts">
            <div>
              <dt>Products</dt>
              <dd>{inventory.products}</dd>
            </div>
            <div>
              <dt>Units in stock</dt>
              <dd>{inventory.units}</dd>
            </div>
            {/* These were counted off the `lowStock` list, which the server
                caps at eight rows for the overview panel — so both numbers
                silently stopped at 8 and read as "only 8 products need
                attention" on a catalogue where hundreds might. They are real
                counts now, taken over the whole table. */}
            <div>
              <dt>Low stock (≤ {inventory.lowStockThreshold})</dt>
              <dd>{inventory.lowStockCount}</dd>
            </div>
            <div>
              <dt>Out of stock</dt>
              <dd>{inventory.outOfStockCount}</dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
};

export default Analytics;
