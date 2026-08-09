import { useState } from "react";
import { useSelector } from "react-redux";
import toast from "react-hot-toast";
import { FiMapPin } from "react-icons/fi";
import { RootState } from "../../redux/store";
import {
  useDeleteAddressMutation,
  useMyAddressesQuery,
  useNewAddressMutation,
  useSetDefaultAddressMutation,
  useUpdateAddressMutation,
} from "../../redux/api/addressAPI";
import { Address, AddressInput } from "../../types/types";
import { CustomError } from "../../types/api-types";
import { Skeleton } from "../../components/Loader";
import ErrorState from "../../components/ErrorState";
import { queryErrorMessage } from "../../utils/errors";
import AddressForm from "./AddressForm";

/**
 * The address book. Exists so checkout stops asking for five fields the
 * customer has already typed — see Shipping.tsx, which prefills from the
 * default one.
 *
 * Only one editor is open at a time (`editing` holds an id, or "new"): two open
 * forms on this page means two ways to submit the same address, and the second
 * one is always the stale one.
 */
const Addresses = () => {
  const { user } = useSelector((state: RootState) => state.userReducer);
  const id = user?._id ?? "";

  const { data, isLoading, isError, error, refetch } = useMyAddressesQuery(id, { skip: !id });

  const [create, { isLoading: creating }] = useNewAddressMutation();
  const [update, { isLoading: updating }] = useUpdateAddressMutation();
  const [setDefault] = useSetDefaultAddressMutation();
  const [remove] = useDeleteAddressMutation();

  const [editing, setEditing] = useState<string | null>(null);

  const addresses = data?.addresses ?? [];

  // Every mutation reports the server's own message on failure — it explains
  // the cap, the phone format and the missing row far better than a generic
  // "something went wrong" would.
  const report = (res: unknown, fallback: string) => {
    const err = (res as { error?: CustomError }).error;
    if (err) {
      toast.error(err.data?.message ?? fallback);
      return false;
    }
    return true;
  };

  const save = async (values: AddressInput) => {
    const res =
      editing === "new"
        ? await create({ userId: id, body: values })
        : await update({ userId: id, addressId: editing!, body: values });

    if (!report(res, "Could not save the address")) return;
    toast.success(editing === "new" ? "Address saved" : "Address updated");
    setEditing(null);
  };

  const makeDefault = async (addressId: string) => {
    const res = await setDefault({ userId: id, addressId });
    if (report(res, "Could not change the default")) toast.success("Default updated");
  };

  const destroy = async (address: Address) => {
    if (!window.confirm(`Delete the "${address.label}" address?`)) return;
    const res = await remove({ userId: id, addressId: address._id });
    if (report(res, "Could not delete the address")) toast.success("Address deleted");
  };

  if (isLoading) return <Skeleton length={5} />;
  if (isError)
    return (
      <ErrorState
        title="Couldn't load your addresses"
        message={queryErrorMessage(error)}
        onRetry={refetch}
      />
    );

  return (
    <div className="addresses">
      <div className="section-head">
        <div>
          <h2>Addresses</h2>
          <p>Saved addresses are offered at checkout so you only type them once.</p>
        </div>
        {editing === null && (
          <button className="btn" onClick={() => setEditing("new")}>
            Add address
          </button>
        )}
      </div>

      {editing === "new" && (
        <div className="card addresses__editor">
          <h3>New address</h3>
          <AddressForm
            submitLabel="Save address"
            busy={creating}
            onSubmit={save}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {addresses.length === 0 && editing === null ? (
        <div className="empty-state">
          <FiMapPin />
          <h2>No saved addresses</h2>
          <p>
            Add one and it will be filled in for you the next time you check out.
          </p>
          <button className="btn" onClick={() => setEditing("new")}>
            Add your first address
          </button>
        </div>
      ) : (
        <ul className="addresses__list">
          {addresses.map((address) =>
            editing === address._id ? (
              <li key={address._id} className="card addresses__editor">
                <h3>Edit address</h3>
                <AddressForm
                  initial={address}
                  submitLabel="Save changes"
                  busy={updating}
                  onSubmit={save}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={address._id} className="card addresses__item">
                <div className="addresses__item-head">
                  <strong>{address.label}</strong>
                  {address.isDefault && (
                    <span className="badge badge--accent">Default</span>
                  )}
                </div>

                <p className="addresses__name">{address.fullName}</p>
                <p className="addresses__lines">
                  {address.address}
                  <br />
                  {address.city}, {address.state} {address.pinCode}
                  <br />
                  {address.country}
                </p>
                <p className="addresses__phone">{address.phone}</p>

                <div className="addresses__actions">
                  <button
                    className="btn btn--ghost"
                    onClick={() => setEditing(address._id)}
                  >
                    Edit
                  </button>
                  {/* Nothing to do if it is already the default, and a button
                      that always no-ops is worse than no button. */}
                  {!address.isDefault && (
                    <button
                      className="btn btn--ghost"
                      onClick={() => makeDefault(address._id)}
                    >
                      Make default
                    </button>
                  )}
                  <button
                    className="btn btn--danger"
                    onClick={() => destroy(address)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
};

export default Addresses;
