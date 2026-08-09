import { FormEvent, useState } from "react";
import { Address, AddressInput } from "../../types/types";

const blank: AddressInput = {
  label: "Home",
  fullName: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  country: "India",
  pinCode: "",
};

/**
 * Add/edit form for one saved address, shared by the address book and the
 * checkout page so the two can never drift into asking for different fields.
 *
 * `phone` is validated server-side as E.164 (`requirePhone`), which is a rule
 * the customer has no way to guess from an empty box — hence the hint and the
 * `+91` placeholder rather than a bare "Phone".
 */
const AddressForm = ({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial?: Address;
  submitLabel: string;
  busy?: boolean;
  onSubmit: (values: AddressInput) => void;
  onCancel?: () => void;
}) => {
  const [values, setValues] = useState<AddressInput>(
    initial
      ? {
          label: initial.label,
          fullName: initial.fullName,
          phone: initial.phone,
          address: initial.address,
          city: initial.city,
          state: initial.state,
          country: initial.country,
          pinCode: initial.pinCode,
          isDefault: initial.isDefault,
        }
      : blank
  );

  const set = (key: keyof AddressInput) => (value: string | boolean) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    onSubmit(values);
  };

  return (
    <form className="address-form" onSubmit={submit}>
      <div className="address-form__row">
        <div className="field">
          <label htmlFor="af-label">Label</label>
          <input
            id="af-label"
            className="input"
            value={values.label}
            onChange={(e) => set("label")(e.target.value)}
            placeholder="Home, Office…"
            maxLength={40}
          />
        </div>
        <div className="field">
          <label htmlFor="af-name">Full name</label>
          <input
            id="af-name"
            className="input"
            required
            value={values.fullName}
            onChange={(e) => set("fullName")(e.target.value)}
            placeholder="Who should receive it"
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="af-phone">Phone</label>
        <input
          id="af-phone"
          className="input"
          required
          value={values.phone}
          onChange={(e) => set("phone")(e.target.value)}
          placeholder="+919876543210"
        />
        <small>Include the country code — the courier calls this number.</small>
      </div>

      <div className="field">
        <label htmlFor="af-address">Address</label>
        <textarea
          id="af-address"
          className="input"
          required
          rows={2}
          value={values.address}
          onChange={(e) => set("address")(e.target.value)}
          placeholder="Flat, building, street, area"
          maxLength={200}
        />
      </div>

      <div className="address-form__row">
        <div className="field">
          <label htmlFor="af-city">City</label>
          <input
            id="af-city"
            className="input"
            required
            value={values.city}
            onChange={(e) => set("city")(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="af-state">State</label>
          <input
            id="af-state"
            className="input"
            required
            value={values.state}
            onChange={(e) => set("state")(e.target.value)}
          />
        </div>
      </div>

      <div className="address-form__row">
        <div className="field">
          <label htmlFor="af-country">Country</label>
          <input
            id="af-country"
            className="input"
            required
            value={values.country}
            onChange={(e) => set("country")(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="af-pin">PIN code</label>
          <input
            id="af-pin"
            className="input"
            required
            inputMode="numeric"
            value={values.pinCode}
            onChange={(e) => set("pinCode")(e.target.value)}
            maxLength={12}
          />
        </div>
      </div>

      <label className="address-form__default">
        <input
          type="checkbox"
          checked={Boolean(values.isDefault)}
          onChange={(e) => set("isDefault")(e.target.checked)}
        />
        <span>Use this address by default at checkout</span>
      </label>

      <div className="address-form__actions">
        <button type="submit" className="btn" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
};

export default AddressForm;
