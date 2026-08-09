import { FormEvent, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  linkWithPhoneNumber,
  linkWithPopup,
  signOut,
  type ConfirmationResult,
} from "firebase/auth";
import { FcGoogle } from "react-icons/fc";
import { FaPhone } from "react-icons/fa";
import { auth } from "../../firebase";
import { RootState } from "../../redux/store";
import { userExits, userNotExits } from "../../redux/reducer/userReducer";
import {
  useCloseAccountMutation,
  useUpdateEmailPreferencesMutation,
  useSyncIdentityMutation,
  useUpdateProfileMutation,
} from "../../redux/api/userAPI";
import { CustomError } from "../../types/api-types";
import { clearDevSession, getDevSession } from "../../utils/devAuth";

/** yyyy-mm-dd, which is what <input type="date"> wants. */
const asDateInput = (value?: string) =>
  value ? new Date(value).toISOString().slice(0, 10) : "";

const errorOf = (res: unknown) => (res as { error?: CustomError }).error;

/**
 * Profile, sign-in methods, and closing the account.
 *
 * Three things that all mean "change the account itself", kept on one page and
 * separated by weight: an ordinary form, then something that changes how you
 * get in, then something irreversible.
 */
const Settings = () => {
  const { user } = useSelector((state: RootState) => state.userReducer);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [updateProfile, { isLoading: saving }] = useUpdateProfileMutation();
  const [syncIdentity] = useSyncIdentityMutation();
  const [closeAccount, { isLoading: closing }] = useCloseAccountMutation();
  const [updateEmailPreferences, { isLoading: savingPrefs }] =
    useUpdateEmailPreferencesMutation();

  // Mirrored locally so the checkbox responds immediately; the store's copy of
  // the user is refreshed from the server on the next load.
  const [emailOptOut, setEmailOptOut] = useState(Boolean(user?.emailOptOut));

  const saveEmailPrefs = async (optOut: boolean) => {
    if (!user?._id) return;

    const previous = emailOptOut;
    setEmailOptOut(optOut);

    try {
      await updateEmailPreferences({ userId: user._id, emailOptOut: optOut }).unwrap();
      toast.success(optOut ? "You will no longer receive these." : "Preferences saved.");
    } catch {
      // Put the box back rather than leaving it showing a preference the
      // server never accepted.
      setEmailOptOut(previous);
      toast.error("Could not save your preferences.");
    }
  };

  const [name, setName] = useState(user?.name ?? "");
  const [gender, setGender] = useState(user?.gender ?? "");
  const [dob, setDob] = useState(asDateInput(user?.dob));

  // Phone linking is two steps, exactly like sign-in: send an SMS, then confirm
  // the code. Firebase ties one reCAPTCHA verifier to one send.
  const [linking, setLinking] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);

  const [confirmClose, setConfirmClose] = useState("");

  if (!user) return null;

  // The dev bypass has no Firebase session at all, so nothing on this page that
  // talks to a provider can work for it. Saying so beats a Firebase error.
  const isDev = Boolean(getDevSession());

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();

    const res = await updateProfile({
      userId: user._id,
      body: { name, gender, dob },
    });

    const err = errorOf(res);
    if (err) return toast.error(err.data?.message ?? "Could not save your profile");

    // The store is the app's copy of the user row and every page reads it, so
    // it has to be updated here — an RTK Query tag cannot invalidate a plain
    // slice populated by the auth bootstrap.
    if ("data" in res && res.data) dispatch(userExits(res.data.user));
    toast.success("Profile updated");
  };

  /**
   * Both link flows end here. The server is told nothing about what was linked
   * — it asks Firebase what this uid now holds, because a bearer-uid API that
   * believed a posted email would let anyone who learned a uid write an
   * address onto that account.
   */
  const finishLink = async () => {
    const res = await syncIdentity(user._id);
    const err = errorOf(res);

    if (err) return toast.error(err.data?.message ?? "Could not link that method");
    if ("data" in res && res.data) dispatch(userExits(res.data.user));
    toast.success("Sign-in method linked");
  };

  const linkGoogle = async () => {
    if (!auth.currentUser) return;
    setLinking(true);
    try {
      await linkWithPopup(auth.currentUser, new GoogleAuthProvider());
      await finishLink();
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request")
        return;
      toast.error(
        code === "auth/credential-already-in-use"
          ? "That Google account is already linked to another account here."
          : code === "auth/popup-blocked"
          ? "Your browser blocked the popup. Allow popups for this site."
          : "Could not link your Google account."
      );
    } finally {
      setLinking(false);
    }
  };

  const getVerifier = () => {
    if (!verifierRef.current)
      verifierRef.current = new RecaptchaVerifier(auth, "link-recaptcha", {
        size: "invisible",
      });
    return verifierRef.current;
  };

  const resetVerifier = () => {
    verifierRef.current?.clear();
    verifierRef.current = null;
  };

  const sendLinkCode = async () => {
    if (!auth.currentUser) return;
    if (!/^\+[1-9]\d{7,14}$/.test(phone.replace(/[\s-]/g, "")))
      return toast.error("Enter the number in international format, e.g. +919876543210.");

    setLinking(true);
    try {
      const result = await linkWithPhoneNumber(
        auth.currentUser,
        phone.replace(/[\s-]/g, ""),
        getVerifier()
      );
      setConfirmation(result);
      toast.success("Code sent. Check your messages.");
    } catch (error) {
      resetVerifier();
      const code = (error as { code?: string })?.code;
      toast.error(
        code === "auth/credential-already-in-use"
          ? "That number is already on another account here."
          : "Could not send the code. Check the number and try again."
      );
    } finally {
      setLinking(false);
    }
  };

  const confirmLinkCode = async () => {
    if (!confirmation) return;
    setLinking(true);
    try {
      await confirmation.confirm(code.trim());
      await finishLink();
      setConfirmation(null);
      setCode("");
      setPhone("");
      resetVerifier();
    } catch {
      toast.error("That code was not correct.");
    } finally {
      setLinking(false);
    }
  };

  const close = async () => {
    const res = await closeAccount(user._id);
    const err = errorOf(res);

    if (err) return toast.error(err.data?.message ?? "Could not close your account");

    // The uid stops being accepted the moment the server stamps deletedAt, so
    // the local session has to go with it or every subsequent request 401s
    // against a UI that still believes it is signed in.
    clearDevSession();
    await signOut(auth).catch(() => {});
    dispatch(userNotExits());
    toast.success("Your account has been closed.");
    navigate("/", { replace: true });
  };

  const hasGoogle = Boolean(user.email);
  const hasPhone = Boolean(user.phone);

  return (
    <div className="settings">
      <section className="card">
        <h2>Profile</h2>
        <p className="settings__hint">
          Your email and phone number are not editable here — they identify the
          account and come from however you signed in. Add a second method below.
        </p>

        <form className="settings__form" onSubmit={saveProfile}>
          <div className="field">
            <label htmlFor="set-name">Name</label>
            <input
              id="set-name"
              className="input"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="settings__row">
            <div className="field">
              <label htmlFor="set-gender">Gender</label>
              <select
                id="set-gender"
                className="select"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
              >
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="set-dob">Date of birth</label>
              <input
                id="set-dob"
                className="input"
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={dob}
                onChange={(e) => setDob(e.target.value)}
              />
            </div>
          </div>

          <button className="btn" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Sign-in methods</h2>
        <p className="settings__hint">
          Adding a second method means you can still get in if you lose access to
          the first — a phone-only account whose number changes is otherwise gone
          for good.
        </p>

        <ul className="settings__methods">
          <li>
            <FcGoogle />
            <div>
              <strong>Google</strong>
              <span>{hasGoogle ? user.email : "Not linked"}</span>
            </div>
            {hasGoogle ? (
              <span className="badge badge--success">Linked</span>
            ) : (
              <button
                className="btn btn--ghost"
                onClick={linkGoogle}
                disabled={linking || isDev}
              >
                Link
              </button>
            )}
          </li>

          <li>
            <FaPhone />
            <div>
              <strong>Phone</strong>
              <span>{hasPhone ? user.phone : "Not linked"}</span>
            </div>
            {hasPhone && <span className="badge badge--success">Linked</span>}
          </li>
        </ul>

        {!hasPhone && !isDev && (
          <div className="settings__link-phone">
            {confirmation ? (
              <>
                <div className="field">
                  <label htmlFor="link-otp">Verification code</label>
                  <input
                    id="link-otp"
                    className="input"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
                <button className="btn" onClick={confirmLinkCode} disabled={linking}>
                  {linking ? "Verifying…" : "Confirm and link"}
                </button>
              </>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="link-phone">Phone number</label>
                  <input
                    id="link-phone"
                    className="input"
                    type="tel"
                    placeholder="+919876543210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <button className="btn btn--ghost" onClick={sendLinkCode} disabled={linking}>
                  {linking ? "Sending…" : "Send code"}
                </button>
              </>
            )}
          </div>
        )}

        {isDev && (
          <p className="settings__hint">
            The dev sign-in bypass has no Firebase session, so linking is
            unavailable here.
          </p>
        )}

        {/* Invisible reCAPTCHA mounts here; Firebase requires a real element. */}
        <div id="link-recaptcha" />
      </section>

      <section className="card">
        <h2>Email preferences</h2>
        <p className="settings__hint">
          Order confirmations, delivery updates and cancellations are always
          sent — they are the record of what you bought, not marketing, and are
          not affected by this setting.
        </p>

        <label className="settings__check">
          <input
            type="checkbox"
            checked={!emailOptOut}
            disabled={savingPrefs}
            onChange={(e) => saveEmailPrefs(!e.target.checked)}
          />
          <span>
            Email me about back-in-stock items I asked about, review requests
            after delivery, and checkouts I did not finish.
          </span>
        </label>
      </section>

      <section className="card settings__danger">
        <h2>Close your account</h2>
        <p className="settings__hint">
          Your name, email, phone and photo are erased, and your wishlist,
          addresses and reviews are deleted. Your past orders are kept as
          financial records but stop being linked to you, and you will not be
          able to sign in again.
        </p>

        <div className="field">
          <label htmlFor="close-confirm">Type CLOSE to confirm</label>
          <input
            id="close-confirm"
            className="input"
            value={confirmClose}
            onChange={(e) => setConfirmClose(e.target.value)}
            placeholder="CLOSE"
          />
        </div>

        <button
          className="btn btn--danger"
          onClick={close}
          disabled={confirmClose !== "CLOSE" || closing}
        >
          {closing ? "Closing…" : "Close my account permanently"}
        </button>
      </section>
    </div>
  );
};

export default Settings;
