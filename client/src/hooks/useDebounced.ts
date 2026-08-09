import { useEffect, useState } from "react";

/**
 * Trails `value` by `delay` milliseconds, resetting the timer on every change.
 *
 * The search box uses it so a request is issued per *pause*, not per keystroke.
 * Typing "laptop" would otherwise be six round trips of which only the last
 * matters — and because the earlier five can land out of order, the dropdown
 * could settle on the results for "lapt" while the box reads "laptop".
 *
 * Debouncing is only the second line of defence. Ahead of it, the caller skips
 * terms shorter than two characters; behind it, RTK Query caches per argument,
 * so backspacing through a word re-reads the cache instead of the network.
 */
export const useDebounced = <T,>(value: T, delay = 200): T => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    // Clearing on change is what makes this a debounce rather than a delay:
    // a keystroke inside the window cancels the pending update.
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
};
