import { Component, ReactNode } from "react";

/**
 * The last line between a thrown render and a white page.
 *
 * Neither app had one. Two things reached the user as a blank screen because of
 * it:
 *
 *  - Any throw during render. The pages that read `error.data.message` off a
 *    network failure did exactly that (see utils/errors.ts), and React unmounts
 *    the whole tree when nothing catches it — so a backend being briefly
 *    unreachable took the entire site down rather than one section.
 *
 *  - **A failed lazy chunk**, which is the one that happens without any bug at
 *    all. Every route in both apps is `lazy()`. Deploying replaces the hashed
 *    chunk files, so a visitor who had a tab open before the deploy requests a
 *    filename that no longer exists; the dynamic import rejects. `<Suspense>`
 *    handles *pending*, not *rejected*, so its fallback never resolves and the
 *    outlet stays empty under a perfectly healthy header. That case gets its
 *    own message and its own button below, because retrying in place cannot
 *    fix it — the app in memory is the old one, and only a reload replaces it.
 */

type Props = {
  children: ReactNode;
  /**
   * Changes to this clear the error. The route boundary passes the pathname, so
   * navigating away from a page that threw recovers instead of pinning the
   * error until a reload.
   */
  resetKey?: string;
  /**
   * This is one of the few files both apps import, and they share no CSS — the
   * console never loads a storefront partial, so `.empty-state` and `.btn` mean
   * nothing there. The classes are therefore passed in rather than assumed; the
   * defaults are the storefront's.
   */
  className?: string;
  buttonClassName?: string;
};

type State = { error: Error | null };

/** A chunk that 404'd, as opposed to a bug in our own render. */
const isChunkError = (error: Error) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    `${error.message}`
  );

class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey)
      this.setState({ error: null });
  }

  componentDidCatch(error: Error) {
    // Nothing else records this — there is no client error reporting in the
    // project — so at minimum it must not vanish silently.
    console.error("[boundary]", error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const stale = isChunkError(error);
    const { className = "empty-state", buttonClassName = "btn" } = this.props;

    return (
      <div className={className} role="alert">
        <h2>{stale ? "This page has been updated" : "Something went wrong"}</h2>
        <p>
          {stale
            ? "The site was updated while this tab was open. Reload to get the current version."
            : "This section failed to render. Reloading usually clears it."}
        </p>
        <button
          type="button"
          className={buttonClassName}
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
