import { AnalyticsRange } from "../types";

const OPTIONS: { value: AnalyticsRange; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "12m", label: "12 months" },
];

/**
 * The time window every number on the page is measured over. One control, sat
 * above the content it governs — not one per chart, which is how two cards end
 * up quoting different periods for the same measure.
 */
const RangePicker = ({
  value,
  onChange,
}: {
  value: AnalyticsRange;
  onChange: (range: AnalyticsRange) => void;
}) => (
  <div className="c-range" role="group" aria-label="Time range">
    {OPTIONS.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={option.value === value}
        className={option.value === value ? "is-active" : undefined}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
);

export default RangePicker;
