import toast from "react-hot-toast";

/**
 * Reads the outcome of an RTK Query mutation.
 *
 * A failure may or may not carry a body: a rejected request has
 * `error.data.message` from the API's error middleware, while a network failure
 * has no `data` at all. Reading `.message` off the latter throws a TypeError,
 * which is how a dead backend used to surface as a blank screen instead of a
 * message.
 */
export const report = (result: unknown, fallback: string) => {
  const res = result as {
    data?: { message?: string };
    error?: { status?: number | string; data?: { message?: string } };
  };

  if (res.data) return { ok: true, message: res.data.message ?? fallback };

  const message =
    res.error?.data?.message ??
    (res.error?.status === "FETCH_ERROR"
      ? "Could not reach the server."
      : "Something went wrong.");

  return { ok: false, message };
};

/** `report`, announced. Returns whether it succeeded so callers can navigate. */
export const reportToast = (result: unknown, fallback: string) => {
  const { ok, message } = report(result, fallback);
  (ok ? toast.success : toast.error)(message);
  return ok;
};
