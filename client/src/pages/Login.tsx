
import {
  ConfirmationResult,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithPopup,
} from "firebase/auth";
import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { FcGoogle } from "react-icons/fc";
import { FaPhone } from "react-icons/fa";
import { auth } from "../firebase";
import { getUser, useLoginMutation } from "../redux/api/userAPI";
import { FetchBaseQueryError } from "@reduxjs/toolkit/query/react";
import { MessageResponse } from "../types/api-types";
import { User } from "../types/types";
import { useDispatch, useSelector } from "react-redux";
import { userExits, userNotExits } from "../redux/reducer/userReducer";
import { Navigate, useLocation } from "react-router-dom";
import { RootState } from "../redux/store";
import { readLoginState } from "../utils/loginRedirect";
import {
  DEV_ACCOUNTS,
  DevAccount,
  isDevAuthEnabled,
  setDevSession,
} from "../utils/devAuth";

type Method = "google" | "phone";

const Login = () => {
  const [method, setMethod] = useState<Method>("google");
  const [gender, setGender] = useState("");
  const [date, setDate] = useState("");

  // Phone flow. Firebase hands back a ConfirmationResult when the SMS goes
  // out; holding it is what lets the second step confirm the code.
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);

  const dispatch = useDispatch();
  const [login] = useLoginMutation();

  // Everything that sends someone here records the page they were trying to
  // reach, so signing in returns them to it instead of dropping them on the
  // home page. Sanitised on the way in as well as on the way out: this value
  // goes straight into <Navigate to>, and history entries outlive a build.
  const location = useLocation();
  const { from } = readLoginState(location.state);
  const { user } = useSelector((state: RootState) => state.userReducer);

  // Both providers end here: create the app user if this uid is new (the
  // endpoint is idempotent — a known uid just gets a welcome back), then pull
  // the row into the store the same way App.tsx's auth bootstrap does.
  const finishLogin = async (uid: string, profile: Omit<User, "_id" | "role">) => {
    const res = await login({ ...profile, role: "user", _id: uid });

    if ("data" in res && res.data) {
      toast.success(res.data.message);
      const data = await getUser(uid);
      dispatch(userExits(data?.user!));
      return;
    }

    // A FETCH_ERROR carries no body — that is the server being unreachable
    // (wrong VITE_SERVER, backend down), not a rejected signup, so say so
    // rather than falling through to a generic failure.
    const error = res.error as FetchBaseQueryError;
    const message = error?.data as MessageResponse | undefined;
    toast.error(
      message?.message ??
        (error && "status" in error && error.status === "FETCH_ERROR"
          ? "Could not reach the server. Is the backend running?"
          : "Sign in fail.")
    );
    dispatch(userNotExits());
  };

  const loginHandler = async () => {
    try {
      const provider = new GoogleAuthProvider();
      const { user } = await signInWithPopup(auth, provider);

      await finishLogin(user.uid, {
        name: user.displayName!,
        email: user.email!,
        photo: user.photoURL!,
        gender,
        dob: date,
      });
    } catch (error) {
      console.log(error);
      // A bare "Sign in fail." hides which half broke. The popup failures are
      // configuration, not user error, and each needs a different fix.
      const code = (error as { code?: string })?.code;
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request")
        return;
      toast.error(
        code === "auth/popup-blocked"
          ? "Your browser blocked the sign-in popup. Allow popups for this site."
          : code === "auth/unauthorized-domain"
          ? "This domain is not authorized in the Firebase console."
          : code
          ? `Sign in failed (${code}).`
          : "Sign in fail."
      );
    }
  };

  // reCAPTCHA is mandatory for phone auth and Firebase ties one verifier to one
  // send. Reused across resends, and torn down on failure so the next attempt
  // gets a fresh widget instead of an already-consumed one.
  const getVerifier = () => {
    if (!verifierRef.current)
      verifierRef.current = new RecaptchaVerifier(auth, "recaptcha-container", {
        size: "invisible",
      });
    return verifierRef.current;
  };

  const resetVerifier = () => {
    verifierRef.current?.clear();
    verifierRef.current = null;
  };

  const sendCodeHandler = async () => {
    // A phone account has no provider profile, so these are the only chance to
    // collect them — the backend rejects a new user without them.
    if (!name.trim()) return toast.error("Please enter your name.");
    if (!gender) return toast.error("Please select your gender.");
    if (!date) return toast.error("Please enter your date of birth.");
    if (!/^\+[1-9]\d{7,14}$/.test(phone.replace(/[\s-]/g, "")))
      return toast.error("Enter the number in international format, e.g. +919876543210.");

    setBusy(true);
    try {
      const result = await signInWithPhoneNumber(
        auth,
        phone.replace(/[\s-]/g, ""),
        getVerifier()
      );
      setConfirmation(result);
      toast.success("Code sent. Check your messages.");
    } catch (error) {
      console.log(error);
      resetVerifier();
      toast.error("Could not send the code. Check the number and try again.");
    } finally {
      setBusy(false);
    }
  };

  const verifyCodeHandler = async () => {
    if (!confirmation) return;
    if (code.trim().length < 6) return toast.error("Enter the 6-digit code.");

    setBusy(true);
    try {
      const { user } = await confirmation.confirm(code.trim());

      await finishLogin(user.uid, {
        name: name.trim(),
        phone: user.phoneNumber ?? phone.replace(/[\s-]/g, ""),
        gender,
        dob: date,
      });
      resetVerifier();
    } catch (error) {
      console.log(error);
      toast.error("That code was not correct.");
    } finally {
      setBusy(false);
    }
  };

  // Dev only. Stores the uid so a reload stays signed in, then walks the same
  // finishLogin path a real provider would — the account row is created if the
  // seed script has not been run, just without the admin role.
  const devLoginHandler = async (account: DevAccount) => {
    setDevSession(account.uid);
    await finishLogin(account.uid, {
      name: account.name,
      email: account.email,
      gender: account.gender,
      dob: account.dob,
    });
  };

  const changeNumberHandler = () => {
    setConfirmation(null);
    setCode("");
    resetVerifier();
  };

  if (user?._id) return <Navigate to={from} replace />;

  return (
    <div className="login page">
      <main>
        <h1>Welcome back</h1>
        <p className="login__hint">
          {from === "/"
            ? "Sign in with Google or your phone number. The details below are only used the first time you create an account."
            : "Sign in to continue. We'll take you straight back to where you were."}
        </p>

        <div className="login__methods">
          <button
            className={method === "google" ? "is-active" : ""}
            onClick={() => setMethod("google")}
          >
            <FcGoogle /> <span>Google</span>
          </button>
          <button
            className={method === "phone" ? "is-active" : ""}
            onClick={() => setMethod("phone")}
          >
            <FaPhone /> <span>Phone</span>
          </button>
        </div>

        {/* Name only exists in the phone flow — Google supplies its own. */}
        {method === "phone" && !confirmation && (
          <div>
            <label htmlFor="login-name">Name</label>
            <input
              id="login-name"
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}

        {!confirmation && (
          <>
            <div>
              <label htmlFor="login-gender">Gender</label>
              <select
                id="login-gender"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
              >
                <option value="">Select Gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>

            <div>
              <label htmlFor="login-dob">Date of birth</label>
              <input
                id="login-dob"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </>
        )}

        {method === "google" ? (
          <div>
            <p>Already have an account? Signing in works the same way.</p>
            <button onClick={loginHandler}>
              <FcGoogle /> <span>Sign in with Google</span>
            </button>
          </div>
        ) : confirmation ? (
          <div>
            <label htmlFor="login-otp">Verification code</label>
            <input
              id="login-otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
            <p>Sent to {phone}.</p>
            <button onClick={verifyCodeHandler} disabled={busy}>
              <span>{busy ? "Verifying…" : "Verify and sign in"}</span>
            </button>
            <button className="login__link" onClick={changeNumberHandler} disabled={busy}>
              <span>Use a different number</span>
            </button>
          </div>
        ) : (
          <div>
            <label htmlFor="login-phone">Phone number</label>
            <input
              id="login-phone"
              type="tel"
              autoComplete="tel"
              placeholder="+91 98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <p>We'll text you a one-time code. Standard rates apply.</p>
            <button onClick={sendCodeHandler} disabled={busy}>
              <FaPhone /> <span>{busy ? "Sending…" : "Send code"}</span>
            </button>
          </div>
        )}

        {/* Invisible reCAPTCHA mounts here; Firebase requires a real element. */}
        <div id="recaptcha-container" />

        {isDevAuthEnabled && (
          <div className="login__dev">
            <p>Dev bypass — skips Firebase entirely. Run `npm run seed:dev` in backend/ first.</p>
            {DEV_ACCOUNTS.map((account) => (
              <button
                key={account.uid}
                className="login__link"
                onClick={() => devLoginHandler(account)}
              >
                <span>Sign in as {account.label}</span>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Login
