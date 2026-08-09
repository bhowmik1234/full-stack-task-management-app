import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { userExits, userNotExits } from "../redux/reducer/userReducer";
import { getUser } from "../redux/api/userAPI";
import { clearDevSession, getDevSession } from "../utils/devAuth";

/**
 * Restores the signed-in user, without any of it blocking the first paint.
 *
 * Two things used to sit in front of every pixel. `App` rendered
 * `loading ? <Loader/> : <Router/>`, so nothing at all appeared until Firebase
 * had initialised, fired `onAuthStateChanged`, and — for a signed-in visitor —
 * a `getUser` round trip had completed. And `App` imported `auth` statically,
 * which put the Firebase auth SDK (~21 kB gzipped, plus ~9 kB for firebase/app)
 * in the critical path of a shopper who may never sign in at all.
 *
 * Both are gone: the app renders immediately and this resolves alongside it.
 * The only thing that legitimately has to wait is a guarded route, and
 * `ProtectedRoute` waits on `loading` itself rather than making the catalogue,
 * the cart and the product pages wait too.
 *
 * Firebase is still *always* loaded, just never synchronously. The stored-token
 * peek below only decides how urgently — it never decides whether — because
 * getting that wrong would report a signed-in customer as signed out.
 */

/**
 * Does this browser look like it has a Firebase session?
 *
 * `initializeAuth` with `browserLocalPersistence` writes the user under
 * `firebase:authUser:<apiKey>:[DEFAULT]`. This is a *hint* for scheduling only.
 * A false negative costs a few hundred milliseconds before the avatar appears;
 * it never signs anybody out, because the SDK loads and answers either way.
 */
const looksSignedIn = (): boolean => {
  try {
    const prefix = "firebase:authUser:";
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(prefix)) return true;
    }
    // sessionStorage is the fallback persistence when localStorage is blocked.
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(prefix)) return true;
    }
  } catch {
    // Storage can throw outright in a locked-down context. Assume a session
    // and load eagerly — the safe direction.
    return true;
  }
  return false;
};

/** Run `fn` when the browser is idle, with a timeout so it always runs. */
const whenIdle = (fn: () => void) => {
  if (typeof window === "undefined") return;
  if ("requestIdleCallback" in window)
    window.requestIdleCallback(fn, { timeout: 2000 });
  else setTimeout(fn, 200);
};

export const useAuthBootstrap = () => {
  const dispatch = useDispatch();

  useEffect(() => {
    // Dev bypass wins over Firebase and never subscribes to it, so a stored
    // dev uid survives a reload the way a real session would. Folds away in
    // production builds (see utils/devAuth.ts).
    const devUid = getDevSession();
    if (devUid) {
      getUser(devUid)
        .then((data) => dispatch(userExits(data.user)))
        .catch(() => {
          // The seed rows are missing — fall back to signed out rather than
          // leaving the guarded routes waiting for ever.
          clearDevSession();
          dispatch(userNotExits());
        });
      return;
    }

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    const start = async () => {
      try {
        // Dynamic, so these two chunks are not in the entry graph. They are
        // fetched in parallel with the page rendering rather than before it.
        const [{ auth }, { onAuthStateChanged }] = await Promise.all([
          import("../firebase"),
          import("firebase/auth"),
        ]);
        if (cancelled) return;

        unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
          if (!fbUser) return dispatch(userNotExits());

          try {
            const data = await getUser(fbUser.uid);
            dispatch(userExits(data.user));
          } catch {
            // This rejects for ordinary reasons: the API restarting, a network
            // blip, or getUser answering 400 for a Firebase account with no row
            // yet. Signed-out is the wrong answer but a recoverable one — the
            // shop is browsable and /login is one click away. Before the app
            // stopped blocking on this, an uncaught rejection here pinned the
            // visitor on the spinner with no way out but a reload.
            dispatch(userNotExits());
          }
        });
      } catch {
        // The chunk itself failed — offline, or blocked by an extension. Say
        // signed out rather than leaving guarded routes spinning for ever.
        if (!cancelled) dispatch(userNotExits());
      }
    };

    if (looksSignedIn()) start();
    else whenIdle(() => void start());

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [dispatch]);
};
