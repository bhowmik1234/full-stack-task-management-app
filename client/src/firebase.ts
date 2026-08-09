// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  initializeAuth,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APPID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

export const app = initializeApp(firebaseConfig);

/**
 * Analytics, loaded after the page is interactive rather than with it.
 *
 * It used to be a static `getAnalytics(app)` at module scope, which put the
 * whole analytics SDK in the critical path: this module is imported by App.tsx
 * for `auth`, so nothing rendered until the measurement library had been
 * downloaded and parsed. Nothing in the app reads the returned instance — it is
 * initialised purely for its side effect — so there is no reason for a single
 * pixel to wait on it.
 *
 * `isSupported()` is not optional. `getAnalytics` throws outright where cookies
 * or IndexedDB are unavailable (private windows, embedded webviews, some
 * tracking-protection settings), and at module scope that throw took the entire
 * app down with it — a blank page, for a measurement library.
 */
const startAnalytics = () => {
  // No measurement id means the project has no analytics property configured,
  // so loading the SDK would download it to do nothing.
  if (!firebaseConfig.measurementId) return;

  import("firebase/analytics")
    .then(({ getAnalytics, isSupported }) =>
      isSupported().then((ok) => {
        if (ok) getAnalytics(app);
      })
    )
    .catch(() => {
      // Offline, blocked by an extension, or unsupported. Analytics failing is
      // never a reason for the shop to fail.
    });
};

if (typeof window !== "undefined") {
  // Idle time, so it competes with nothing. requestIdleCallback is absent on
  // Safari before 16.4, hence the timeout fallback.
  if ("requestIdleCallback" in window)
    window.requestIdleCallback(startAnalytics, { timeout: 5000 });
  else setTimeout(startAnalytics, 3000);
}

/**
 * `initializeAuth` rather than `getAuth`, to pin persistence to localStorage.
 *
 * The default is IndexedDB, whose persistence layer closes its connection on
 * `visibilitychange → hidden` and refuses to reopen until `pageshow` clears the
 * flag. A sign-in popup takes focus, which hides the opener — so the write that
 * follows a *successful* popup can land in that window and throw
 * "Database is closing/hidden". The credential is valid; only storing it fails,
 * and the user is told "Sign in fail." It is a race, so it is intermittent, and
 * it gets much likelier when there are several tabs being switched between.
 *
 * Auth state is one small token, so localStorage is an ample store for it and
 * has no equivalent state machine. Session storage is the fallback for browsers
 * that block localStorage in third-party or private contexts.
 *
 * `browserPopupRedirectResolver` is not optional here: `getAuth` bundles it
 * implicitly, `initializeAuth` does not, and without it signInWithPopup throws
 * auth/argument-error.
 */
export const auth = initializeAuth(app, {
  persistence: [browserLocalPersistence, browserSessionPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});
