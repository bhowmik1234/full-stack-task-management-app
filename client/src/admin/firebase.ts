import { initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  browserSessionPersistence,
  initializeAuth,
} from "firebase/auth";

/**
 * The console's Firebase app — auth only.
 *
 * Separate from src/firebase.ts because that module calls `getAnalytics()` at
 * import time. Sharing it would have the console reporting page views to Google
 * Analytics: an operator's clicks through customer records are not product
 * analytics, it widens the console's CSP for no benefit, and it drags the
 * analytics SDK into a bundle that has no use for it. The same project and the
 * same credentials, minus that.
 */
const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APPID,
});

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
