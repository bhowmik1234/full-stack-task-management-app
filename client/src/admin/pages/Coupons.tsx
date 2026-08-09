import { FormEvent, useState } from "react";
import toast from "react-hot-toast";
import { FiCopy, FiCheck, FiRefreshCw, FiTrash2, FiX } from "react-icons/fi";
import {
  useCouponsQuery,
  useCreateCouponMutation,
  useUpdateCouponMutation,
  useDeleteCouponMutation,
} from "../api";
import { useCan } from "../store";
import { reportToast } from "../mutation";
import { formatDate } from "../hooks";
import { AdminCoupon, CouponInput } from "../types";
import DataTable, { Column } from "../components/DataTable";
import { SkeletonRows } from "../components/Spinner";
import { Card, EmptyState, Money, PageHeader } from "../components/ui";

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O — they read as 1 and 0
const NUMBERS = "23456789"; // likewise no 0 or 1

/**
 * Draws `length` characters from `alphabet` using the platform CSP RNG.
 *
 * Math.random() is seeded from a value an attacker can often recover, and these
 * codes are money: a predictable generator lets someone enumerate discounts
 * that were never issued to them. `crypto.getRandomValues` costs nothing here
 * and removes the question.
 *
 * The modulo is rejection-sampled — taking `byte % alphabet.length` directly
 * biases toward the first few characters whenever 256 is not a multiple of the
 * alphabet size, which it never is for these sets.
 */
const randomChars = (alphabet: string, length: number) => {
  const out: string[] = [];
  const limit = 256 - (256 % alphabet.length);

  while (out.length < length) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      out.push(alphabet[byte % alphabet.length]);
      if (out.length === length) break;
    }
  }

  return out.join("");
};

/**
 * `<input type="date">` speaks YYYY-MM-DD in the operator's own timezone, and
 * the column is an instant. An expiry typed as "the 20th" means *through* the
 * 20th — cutting it off at 00:00 that morning would retire the code a day
 * early, on the day it was most likely to be used.
 */
const endOfDayISO = (value: string) =>
  value ? new Date(`${value}T23:59:59`).toISOString() : null;

/** The inverse, for loading a stored instant back into the date input. */
const dateInputValue = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

/** Empty string is how a cleared number input reads; it must become null, not 0. */
const numberOrNull = (value: string) => (value.trim() === "" ? null : Number(value));

type FormState = {
  code: string;
  amount: string;
  isActive: boolean;
  expiresAt: string;
  minOrderValue: string;
  maxRedemptions: string;
  perUserLimit: string;
};

const BLANK: FormState = {
  code: "",
  amount: "",
  isActive: true,
  expiresAt: "",
  minOrderValue: "",
  maxRedemptions: "",
  perUserLimit: "",
};

const fromCoupon = (coupon: AdminCoupon): FormState => ({
  code: coupon.code,
  amount: String(coupon.amount),
  isActive: coupon.isActive,
  expiresAt: dateInputValue(coupon.expiresAt),
  minOrderValue: coupon.minOrderValue == null ? "" : String(coupon.minOrderValue),
  maxRedemptions: coupon.maxRedemptions == null ? "" : String(coupon.maxRedemptions),
  perUserLimit: coupon.perUserLimit == null ? "" : String(coupon.perUserLimit),
});

/**
 * Why a coupon is not currently usable, or null if it is.
 *
 * Every one of these is a state the row can be in while still looking like a
 * live coupon, which is exactly the confusion this column exists to remove: an
 * operator asking "why is this code being refused" should be able to read the
 * answer off the list rather than reconstruct it from four fields.
 */
const inactiveReason = (coupon: AdminCoupon) => {
  if (!coupon.isActive) return "Paused";
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= Date.now())
    return "Expired";
  if (coupon.maxRedemptions != null && coupon.redeemed >= coupon.maxRedemptions)
    return "Used up";
  return null;
};

const Coupons = () => {
  const canWrite = useCan()("coupons_write");
  const { data, isLoading, isError } = useCouponsQuery();

  const [createCoupon, { isLoading: creating }] = useCreateCouponMutation();
  const [updateCoupon, { isLoading: updating }] = useUpdateCouponMutation();
  const [deleteCoupon, { isLoading: deleting }] = useDeleteCouponMutation();

  const [editing, setEditing] = useState<AdminCoupon | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const startNew = () => {
    setEditing(null);
    setForm(BLANK);
    setCopied(false);
  };

  const startEdit = (coupon: AdminCoupon) => {
    setEditing(coupon);
    setForm(fromCoupon(coupon));
    setConfirmDelete(null);
    setCopied(false);
  };

  const generate = () => {
    set("code", randomChars(LETTERS + NUMBERS, 10));
    setCopied(false);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(form.code);
    setCopied(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    const code = form.code.trim().toUpperCase();
    if (!code) return toast.error("A coupon needs a code.");

    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      return toast.error("Enter a discount amount greater than zero.");

    // Nulls are meaningful here rather than omissions: they are what clears a
    // limit that was previously set. The API distinguishes the two.
    const body: CouponInput = {
      code,
      amount,
      isActive: form.isActive,
      expiresAt: endOfDayISO(form.expiresAt),
      minOrderValue: numberOrNull(form.minOrderValue),
      maxRedemptions: numberOrNull(form.maxRedemptions),
      perUserLimit: numberOrNull(form.perUserLimit),
    };

    const ok = editing
      ? reportToast(await updateCoupon({ couponId: editing._id, body }), "Coupon updated")
      : reportToast(await createCoupon(body), "Coupon created");

    if (ok) startNew();
  };

  const remove = async (couponId: string) => {
    const ok = reportToast(await deleteCoupon(couponId), "Coupon deleted");
    if (ok) {
      setConfirmDelete(null);
      if (editing?._id === couponId) startNew();
    }
  };

  const columns: Column<AdminCoupon>[] = [
    {
      key: "code",
      header: "Code",
      value: (c) => c.code,
      render: (c) =>
        canWrite ? (
          <button type="button" className="c-link" onClick={() => startEdit(c)}>
            <code>{c.code}</code>
          </button>
        ) : (
          <code>{c.code}</code>
        ),
    },
    {
      key: "amount",
      header: "Discount",
      align: "right",
      value: (c) => c.amount,
      render: (c) => <Money value={c.amount} />,
    },
    {
      key: "status",
      header: "Status",
      value: (c) => inactiveReason(c) ?? "Active",
      render: (c) => {
        const reason = inactiveReason(c);
        return (
          <span className={`c-pill c-pill--${reason ? "critical" : "success"}`}>
            {reason ?? "Active"}
          </span>
        );
      },
    },
    {
      key: "redeemed",
      header: "Used",
      align: "right",
      // Sorts on the count, not the "3 / 50" string — a lexical sort would put
      // 10 below 9, which is the bug the storefront's Amount column had.
      value: (c) => c.redeemed,
      render: (c) => (c.maxRedemptions == null ? c.redeemed : `${c.redeemed} / ${c.maxRedemptions}`),
    },
    {
      key: "minOrderValue",
      header: "Min cart",
      align: "right",
      value: (c) => c.minOrderValue ?? 0,
      render: (c) => (c.minOrderValue == null ? "—" : <Money value={c.minOrderValue} />),
    },
    {
      key: "expiresAt",
      header: "Expires",
      value: (c) => c.expiresAt ?? "",
      render: (c) => (c.expiresAt ? formatDate(c.expiresAt) : "Never"),
    },
    ...(canWrite
      ? [
          {
            key: "actions",
            header: "",
            width: "9rem",
            render: (c: AdminCoupon) =>
              confirmDelete === c._id ? (
                <div className="c-confirm">
                  <button
                    type="button"
                    className="c-btn c-btn--ghost"
                    onClick={() => setConfirmDelete(null)}
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    className="c-btn c-btn--danger"
                    disabled={deleting}
                    onClick={() => remove(c._id)}
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="c-btn c-btn--ghost"
                  onClick={() => setConfirmDelete(c._id)}
                  aria-label={`Delete coupon ${c.code}`}
                >
                  <FiTrash2 aria-hidden="true" />
                </button>
              ),
          } as Column<AdminCoupon>,
        ]
      : []),
  ];

  const saving = creating || updating;

  return (
    <div className="l-page">
      <PageHeader
        title="Coupons"
        subtitle={data ? `${data.coupons.length} code${data.coupons.length === 1 ? "" : "s"}` : undefined}
      />

      {canWrite && (
        <Card
          title={editing ? `Edit ${editing.code}` : "New coupon"}
          actions={
            editing && (
              <button type="button" className="c-btn c-btn--ghost" onClick={startNew}>
                <FiX aria-hidden="true" /> Cancel
              </button>
            )
          }
        >
          <form className="c-form" onSubmit={submit}>
            <div className="c-field-row">
              <div className="c-field">
                <label htmlFor="c-code">Code</label>
                <div className="c-codeout">
                  <input
                    id="c-code"
                    type="text"
                    value={form.code}
                    placeholder="DIWALI500"
                    onChange={(e) => set("code", e.target.value.toUpperCase())}
                  />
                  <button type="button" className="c-btn c-btn--ghost" onClick={generate}>
                    <FiRefreshCw aria-hidden="true" /> Generate
                  </button>
                  {form.code && (
                    <button type="button" className="c-btn c-btn--ghost" onClick={copy}>
                      {copied ? <FiCheck aria-hidden="true" /> : <FiCopy aria-hidden="true" />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  )}
                </div>
                <small>
                  Ambiguous characters (I, O, 0, 1) are never generated — codes get read
                  aloud and typed from a photo.
                </small>
              </div>

              <div className="c-field">
                <label htmlFor="c-amount">Discount (₹)</label>
                <input
                  id="c-amount"
                  type="number"
                  min={1}
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => set("amount", e.target.value)}
                />
              </div>
            </div>

            <fieldset className="c-field">
              <legend>Limits</legend>
              <small>
                Every limit is optional, and an empty field means no limit. A code with
                none is redeemable forever, by anyone, on any cart, without end.
              </small>

              <div className="c-field-row">
                <div className="c-field">
                  <label htmlFor="c-expires">Expires after</label>
                  <input
                    id="c-expires"
                    type="date"
                    value={form.expiresAt}
                    onChange={(e) => set("expiresAt", e.target.value)}
                  />
                  <small>Usable through the end of this day.</small>
                </div>

                <div className="c-field">
                  <label htmlFor="c-min">Minimum cart (₹)</label>
                  <input
                    id="c-min"
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.minOrderValue}
                    onChange={(e) => set("minOrderValue", e.target.value)}
                  />
                  <small>Subtotal before tax and shipping.</small>
                </div>
              </div>

              <div className="c-field-row">
                <div className="c-field">
                  <label htmlFor="c-max">Total redemptions</label>
                  <input
                    id="c-max"
                    type="number"
                    min={1}
                    step="1"
                    value={form.maxRedemptions}
                    onChange={(e) => set("maxRedemptions", e.target.value)}
                  />
                  <small>Across all customers.</small>
                </div>

                <div className="c-field">
                  <label htmlFor="c-peruser">Per customer</label>
                  <input
                    id="c-peruser"
                    type="number"
                    min={1}
                    step="1"
                    value={form.perUserLimit}
                    onChange={(e) => set("perUserLimit", e.target.value)}
                  />
                  <small>Counted over paid orders.</small>
                </div>
              </div>

              <label className="c-check">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={() => set("isActive", !form.isActive)}
                />
                Active
              </label>
              <small>
                Pausing a code stops it being redeemed without deleting it, so the orders
                that used it keep pointing at a row that still exists.
              </small>
            </fieldset>

            <button type="submit" className="c-btn c-btn--primary" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create coupon"}
            </button>
          </form>
        </Card>
      )}

      <Card>
        {isLoading ? (
          <SkeletonRows rows={6} />
        ) : isError || !data ? (
          <EmptyState>Could not load coupons.</EmptyState>
        ) : (
          <DataTable
            columns={columns}
            rows={data.coupons}
            rowKey={(c) => c._id}
            search="Search by code"
            empty="No coupons yet."
          />
        )}
      </Card>
    </div>
  );
};

export default Coupons;
