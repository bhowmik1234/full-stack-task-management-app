/**
 * The last few things this visitor searched for, in localStorage.
 *
 * Shown when the search box is focused but empty — the moment when the server
 * has nothing useful to offer (a blank term matches everything) and the visitor
 * most often wants something they already looked for. It costs no request at
 * all, which is why it is the first layer of the suggestion design rather than
 * an extra on top of it.
 *
 * Deliberately per-device and never sent anywhere: a list of what someone
 * shopped for is more revealing than it looks, and syncing it would mean
 * storing it against their account.
 */
const KEY = "recent-searches";
const MAX = 5;

const read = (): string[] => {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    // Anything could be under this key — another tab, an older version of the
    // app, a person with devtools open. Treat it as untrusted.
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === "string").slice(0, MAX)
      : [];
  } catch {
    return [];
  }
};

export const getRecentSearches = read;

export const rememberSearch = (term: string) => {
  const trimmed = term.trim();
  if (trimmed.length < 2) return;

  try {
    // Case-insensitive dedupe, most recent first, so searching the same thing
    // twice moves it to the top instead of listing it twice.
    const next = [
      trimmed,
      ...read().filter((t) => t.toLowerCase() !== trimmed.toLowerCase()),
    ].slice(0, MAX);

    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private browsing, or the quota is full. A missing history is not worth
    // failing a search over.
  }
};

export const clearRecentSearches = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* as above */
  }
};
