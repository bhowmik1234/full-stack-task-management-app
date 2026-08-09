import { useLayoutEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * React Router keeps the window scroll position across navigations, so leaving
 * a long page (a product, a search result list) drops you into the middle of
 * the next one. Renders nothing; it only resets scroll.
 *
 * Three deliberate exceptions:
 *  - POP (back/forward) keeps its position, which is what a browser is expected
 *    to do — jumping to the top when someone goes *back* to a list they had
 *    scrolled through is worse than the original bug.
 *  - A `#hash` target wins, so anchor links still land on their section.
 *  - The effect keys on pathname only, not search. `/search` drives its filters
 *    through `?q=`/`?category=`, and yanking the page to the top on every
 *    keystroke or filter change would be its own bug.
 */
const ScrollToTop = () => {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();

  useLayoutEffect(() => {
    if (navigationType === "POP") return;

    if (hash) {
      const target = document.querySelector(hash);
      if (target) {
        target.scrollIntoView();
        return;
      }
    }

    // "instant" rather than smooth: this is a page change, not a jump within a
    // page, so animating it just delays the new content.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, hash, navigationType]);

  return null;
};

export default ScrollToTop;
