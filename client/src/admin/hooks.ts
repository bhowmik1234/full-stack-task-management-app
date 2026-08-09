import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { AnalyticsRange } from "./types";

const RANGES: AnalyticsRange[] = ["7d", "30d", "90d", "12m"];

/**
 * The selected time window, kept in the URL rather than in component state, so
 * a link to "last 90 days" is a link to what the sender was looking at and a
 * reload does not silently snap back to the default.
 */
export const useRange = (): [AnalyticsRange, (range: AnalyticsRange) => void] => {
  const [params, setParams] = useSearchParams();
  const raw = params.get("range");
  const range = RANGES.includes(raw as AnalyticsRange)
    ? (raw as AnalyticsRange)
    : "30d";

  const setRange = useCallback(
    (next: AnalyticsRange) => {
      const updated = new URLSearchParams(params);
      updated.set("range", next);
      // replace: flipping between ranges is refining one view, not navigating,
      // and shouldn't take four Back presses to escape.
      setParams(updated, { replace: true });
    },
    [params, setParams]
  );

  return [range, setRange];
};

const DAY = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
const MONTH = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" });

/** Axis label for one bucket, at the granularity the API bucketed at. */
export const formatBucket = (iso: string, granularity: "day" | "month") =>
  (granularity === "day" ? DAY : MONTH).format(new Date(iso));

const DATE_TIME = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export const formatDateTime = (iso?: string | null) =>
  iso ? DATE_TIME.format(new Date(iso)) : "—";

export const formatDate = (iso?: string | null) =>
  iso ? DAY.format(new Date(iso)) : "—";
