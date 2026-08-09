import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Order } from "../types/types";
import { formatINR } from "../utils/features";
import {
  useRequestReturnMutation,
  useReturnReasonsQuery,
} from "../redux/api/returnsAPI";
import { CustomError } from "../types/api-types";

/**
 * "Return items" — the customer's side of a return.
 *
 * Per-item with quantities rather than all-or-nothing, because "one of the three
 * shirts didn't fit" is the ordinary case; an all-or-nothing return forces
 * support to unpick it by hand, which is exactly the work this is meant to
 * remove.
 *
 * Quantities already committed to an earlier return are subtracted here so the
 * form cannot offer what the server will refuse. That check is duplicated
 * server-side and the server's is the one that counts — this copy exists to give
 * the answer before the customer has filled the form in, not to be trusted.
 */

type ReturnDialogProps = {
  order: Order;
  userId: string;
  onClose: () => void;
};

const ReturnDialog = ({ order, userId, onClose }: ReturnDialogProps) => {
  const { data: reasonData } = useReturnReasonsQuery(userId);
  const [requestReturn, { isLoading }] = useRequestReturnMutation();

  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const reasons = reasonData?.reasons ?? [];

  // Units already spoken for by a return that was not rejected or withdrawn.
  // A rejected request consumed nothing, so counting it would permanently
  // reduce what someone may return because they once asked and were told no.
  const alreadyReturned = new Map<string, number>();
  for (const request of order.returns ?? []) {
    if (request.status === "Rejected" || request.status === "Cancelled") continue;
    for (const item of request.items)
      alreadyReturned.set(
        item.orderItemId,
        (alreadyReturned.get(item.orderItemId) ?? 0) + item.quantity
      );
  }

  const lines = order.orderItems.map((item) => ({
    item,
    remaining: item.quantity - (alreadyReturned.get(item._id) ?? 0),
  }));

  const returnable = lines.filter((l) => l.remaining > 0);

  const selectedValue = returnable.reduce(
    (sum, { item }) => sum + (quantities[item._id] ?? 0) * item.price,
    0
  );
  const selectedCount = Object.values(quantities).reduce((a, b) => a + b, 0);

  const setQuantity = (orderItemId: string, value: number, max: number) => {
    const next = Math.max(0, Math.min(value, max));
    setQuantities((prev) => ({ ...prev, [orderItemId]: next }));
  };

  const submit = async () => {
    if (!reason) return toast.error("Choose a reason for the return.");
    if (selectedCount === 0) return toast.error("Choose at least one item to return.");

    const res = await requestReturn({
      userId,
      orderId: order._id,
      reason,
      note: note.trim() || undefined,
      items: Object.entries(quantities)
        .filter(([, quantity]) => quantity > 0)
        .map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
    });

    if ("data" in res && res.data) {
      toast.success("Return requested. We will email you once it is reviewed.");
      onClose();
      return;
    }

    // The server explains why — the window closed, an open return already
    // exists, that item is already back. Every one of those is actionable and
    // "something went wrong" throws it away.
    toast.error(
      (res.error as CustomError)?.data?.message ?? "Could not open this return."
    );
  };

  return (
    <div className="return-dialog" role="dialog" aria-modal="true" aria-label="Return items">
      <div className="return-dialog__panel">
        <header>
          <h2>Return items</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {returnable.length === 0 ? (
          <p className="return-dialog__empty">
            Every item on this order has already been returned or requested.
          </p>
        ) : (
          <>
            <div className="return-dialog__items">
              {returnable.map(({ item, remaining }) => (
                <div className="return-dialog__item" key={item._id}>
                  <img
                    src={`${import.meta.env.VITE_SERVER}/${item.photo}`}
                    alt={item.name}
                  />
                  <div>
                    <strong>{item.name}</strong>
                    {item.variantLabel && <span>{item.variantLabel}</span>}
                    <span>
                      {formatINR(item.price)} · {remaining} returnable
                    </span>
                  </div>
                  <div className="return-dialog__qty">
                    <button
                      type="button"
                      onClick={() =>
                        setQuantity(item._id, (quantities[item._id] ?? 0) - 1, remaining)
                      }
                      disabled={(quantities[item._id] ?? 0) <= 0}
                      aria-label={`Return one fewer ${item.name}`}
                    >
                      −
                    </button>
                    <span>{quantities[item._id] ?? 0}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setQuantity(item._id, (quantities[item._id] ?? 0) + 1, remaining)
                      }
                      disabled={(quantities[item._id] ?? 0) >= remaining}
                      aria-label={`Return one more ${item.name}`}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <label className="return-dialog__field">
              <span>Why are you returning this?</span>
              <select value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">Choose a reason</option>
                {reasons.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>

            <label className="return-dialog__field">
              <span>Anything else we should know? (optional)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="e.g. the box arrived crushed"
              />
            </label>

            {/* An estimate, and labelled as one. The refund is worked out
                server-side from the order's own rows — proportional tax,
                delivery only on a full return — and quoting a figure here as
                though it were final is how a returns process starts a
                complaint. */}
            {selectedCount > 0 && (
              <p className="return-dialog__estimate">
                Items selected: {formatINR(selectedValue)} before tax and
                delivery. The exact refund is confirmed once we have the items
                back — see the{" "}
                {/* A raw <a> here reloaded the whole SPA and took the
                    half-filled return form with it. */}
                <Link to="/returns-policy" target="_blank" rel="noreferrer">
                  returns policy
                </Link>
                .
              </p>
            )}

            <footer>
              <button type="button" className="btn btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                onClick={submit}
                disabled={isLoading || selectedCount === 0 || !reason}
              >
                {isLoading ? "Sending.." : "Request return"}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
};

export default ReturnDialog;
