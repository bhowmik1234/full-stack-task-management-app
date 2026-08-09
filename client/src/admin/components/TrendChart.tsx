import {
  CategoryScale,
  Chart as ChartJS,
  ChartData,
  ChartOptions,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";

// Only what this one chart draws. The old admin registered bar, pie and
// doughnut controllers app-wide whether a page used them or not.
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

const INK_MUTED = "#8b93a3";
const GRID = "#232833";
const SERIES = "#3987e5";
const SURFACE = "#171b23";
const BORDER = "#2e3442";
const TEXT = "#e8eaef";

type Props = {
  labels: string[];
  data: number[];
  /** Axis ticks and the tooltip both go through this, so they can't disagree. */
  format: (value: number) => string;
  /** Names the measure in the tooltip. One series, so there is no legend. */
  label: string;
};

/**
 * The console's one time-series chart.
 *
 * Single series by design: revenue and order count live on scales three orders
 * of magnitude apart, and drawing them together needs a second y-axis — the
 * chart that most reliably invents correlations that aren't there. The pages
 * that want both give the reader a toggle and redraw one series at a time.
 */
const TrendChart = ({ labels, data, format, label }: Props) => {
  const chartData: ChartData<"line", number[], string> = {
    labels,
    datasets: [
      {
        label,
        data,
        borderColor: SERIES,
        borderWidth: 2,
        // A wash under the line, not a solid block: it reads as the same
        // measure as the line rather than as a second, filled series.
        backgroundColor: "rgba(57, 135, 229, 0.12)",
        fill: true,
        tension: 0.25,
        // The marks are the line; points appear only under the cursor, where
        // they need to be big enough to aim at.
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: SERIES,
        pointHoverBorderColor: SURFACE,
        pointHoverBorderWidth: 2,
      },
    ],
  };

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    // Anywhere on the column finds the nearest point, so a thin line is still
    // easy to interrogate.
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: SURFACE,
        borderColor: BORDER,
        borderWidth: 1,
        titleColor: TEXT,
        bodyColor: TEXT,
        padding: 10,
        displayColors: false,
        callbacks: {
          // parsed.y is nullable in chart.js's types because a dataset may
          // carry gaps; this series never does — the API emits a zero bucket.
          label: (item) => `${label}: ${format(item.parsed.y ?? 0)}`,
        },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        border: { display: false },
        grid: { color: GRID },
        ticks: {
          color: INK_MUTED,
          font: { size: 11 },
          maxTicksLimit: 5,
          callback: (value) => format(Number(value)),
        },
      },
      x: {
        border: { display: false },
        grid: { display: false },
        ticks: {
          color: INK_MUTED,
          font: { size: 11 },
          // 90 daily buckets cannot all carry a label; chart.js drops the
          // in-between ones rather than overlapping them.
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 8,
        },
      },
    },
  };

  return (
    <div className="c-chart">
      <Line data={chartData} options={options} />
    </div>
  );
};

export default TrendChart;
