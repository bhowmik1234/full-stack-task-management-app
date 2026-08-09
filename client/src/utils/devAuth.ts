/**
 * Development-only sign-in bypass.
 *
 * Firebase phone auth needs the provider enabled and a real SMS, and Google
 * sign-in needs a popup — both are in the way when the thing being tested is
 * checkout or the admin tables. This skips the provider entirely: it seeds a
 * known uid into localStorage and lets the normal `?id=<uid>` backend auth do
 * the rest, so nothing downstream behaves differently from a real session.
 *
 * Two locks keep it out of production:
 *   - `import.meta.env.DEV` is the literal `false` in a `vite build`, so every
 *     call below folds to a constant and the dev UI is dropped from the bundle.
 *   - it still has to be switched on with VITE_DEV_AUTH_BYPASS=true.
 *
 * The uids match the rows created by `npm run seed:dev` in backend/.
 */

const STORAGE_KEY = "dev-auth-uid";

export const isDevAuthEnabled =
  import.meta.env.DEV && import.meta.env.VITE_DEV_AUTH_BYPASS === "true";

export type DevAccount = {
  uid: string;
  label: string;
  name: string;
  email: string;
  gender: string;
  dob: string;
};

export const DEV_ACCOUNTS: DevAccount[] = [
  {
    uid: "dev-customer",
    label: "Customer",
    name: "Dev Customer",
    email: "dev.customer@example.com",
    gender: "Female",
    dob: "1995-06-15",
  },
  {
    uid: "dev-admin",
    label: "Admin",
    name: "Dev Admin",
    email: "dev.admin@example.com",
    gender: "Male",
    dob: "1990-01-01",
  },
];

export const getDevSession = (): string | null =>
  isDevAuthEnabled ? localStorage.getItem(STORAGE_KEY) : null;

export const setDevSession = (uid: string) => {
  if (isDevAuthEnabled) localStorage.setItem(STORAGE_KEY, uid);
};

export const clearDevSession = () => localStorage.removeItem(STORAGE_KEY);
