/**
 * Reading the message out of a failed RTK Query *query*.
 *
 * The console has had `admin/mutation.ts:report` for mutations for a while, and
 * `ResponseToast` in features.ts covers the storefront's. Queries had nothing,
 * so four pages hand-rolled `(error as CustomError).data.message` — which is a
 * TypeError the moment the failure has no body.
 *
 * That is not the rare case. RTK Query reports an unreachable server as
 * `{ status: "FETCH_ERROR" }` and a non-JSON response (an HTML 404, an nginx
 * 502) as `{ status: "PARSING_ERROR" }`, and **neither carries `data`**. Two of
 * the four call sites read it during render, so a backend that was merely down
 * blanked the page instead of saying so.
 */

/** What the API's errorMiddleware sends, and what a transport failure sends. */
type QueryError = {
  status?: number | string;
  data?: { message?: string } | string;
  error?: string;
};

export const DEFAULT_ERROR = "Something went wrong. Please try again.";

/**
 * A sentence to show for a failed query. Never throws, whatever it is handed —
 * that is the whole point of it.
 */
export const queryErrorMessage = (error: unknown, fallback = DEFAULT_ERROR) => {
  if (!error || typeof error !== "object") return fallback;

  const err = error as QueryError;

  // The API's own message, when there is one. It is the useful sentence:
  // "this coupon has expired" beats "request failed".
  if (err.data && typeof err.data === "object" && err.data.message)
    return err.data.message;

  // No body. The transport tells us why, and the two cases have different
  // remedies — one is the visitor's connection, the other is ours.
  if (err.status === "FETCH_ERROR")
    return "Could not reach the server. Check your connection and try again.";

  if (err.status === "PARSING_ERROR" || err.status === "CUSTOM_ERROR")
    return "The server sent an unexpected response. Please try again.";

  if (typeof err.status === "number" && err.status >= 500)
    return "The server had a problem. Please try again in a moment.";

  return fallback;
};
