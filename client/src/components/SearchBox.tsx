import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaSearch } from "react-icons/fa";
import { FiClock, FiTag } from "react-icons/fi";
import { useSuggestQuery } from "../redux/api/productAPI";
import { useDebounced } from "../hooks/useDebounced";
import { Suggestion } from "../types/api-types";
import {
  clearRecentSearches,
  getRecentSearches,
  rememberSearch,
} from "../utils/recentSearches";
import ProductImage from "./ProductImage";

/** Below this the term matches almost everything, so it is not worth asking. */
const MIN_TERM = 2;

/**
 * One row of the dropdown. Recent searches, products and categories share a
 * single flat list so that "the highlighted item" is one index rather than a
 * (section, index) pair — which is what keyboard navigation across three
 * groups otherwise degenerates into.
 */
type Item =
  | { kind: "recent"; term: string }
  | { kind: "product"; product: Suggestion }
  | { kind: "category"; category: string };

/**
 * The header search box, as a WAI-ARIA combobox.
 *
 * The ARIA plumbing is not decoration: without `aria-activedescendant` a screen
 * reader announces nothing as the arrow keys move through the list, and without
 * `role="option"` the rows are read as plain text. Search is the most-used
 * control on the site and a dropdown that only works with a mouse is worse than
 * no dropdown at all.
 */
const SearchBox = ({ className = "" }: { className?: string }) => {
  const navigate = useNavigate();

  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [recent, setRecent] = useState<string[]>([]);

  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const term = input.trim();
  const debounced = useDebounced(term, 200);

  // Three gates before a request happens: too short, unchanged (RTK Query
  // dedupes by argument), or the dropdown is closed. The `skip` is what makes
  // a closed box cost nothing at all.
  const shouldQuery = open && debounced.length >= MIN_TERM;
  const { data, isFetching } = useSuggestQuery(debounced, { skip: !shouldQuery });

  // Opening the panel is the only thing that reads localStorage. Doing it here
  // rather than in an effect keyed on `open` is deliberate: it is a response to
  // an event, not a synchronisation with external state, and the list cannot
  // change while the panel is shut.
  const openPanel = () => {
    setOpen(true);
    setRecent(getRecentSearches());
  };

  const items = useMemo<Item[]>(() => {
    // An empty box has nothing to match on, so it offers history instead of
    // firing a request that would match the whole catalogue.
    if (term.length < MIN_TERM)
      return recent.map((t) => ({ kind: "recent" as const, term: t }));

    return [
      ...(data?.products ?? []).map((product) => ({
        kind: "product" as const,
        product,
      })),
      ...(data?.categories ?? []).map((category) => ({
        kind: "category" as const,
        category,
      })),
    ];
  }, [term, recent, data]);

  // A stale highlight would point at a different row once the results change
  // underneath it, so it resets whenever the list does. Adjusted during render
  // rather than in an effect: an effect would let one frame paint with the old
  // index, which is a frame where Enter selects the wrong product.
  const listKey = `${debounced}|${items.length}`;
  const [highlightedList, setHighlightedList] = useState(listKey);
  if (highlightedList !== listKey) {
    setHighlightedList(listKey);
    setHighlight(-1);
  }

  // Pointer-down rather than click: click fires after blur, by which time a
  // blur-to-close would already have removed the row being clicked.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const goToSearch = (value: string) => {
    const trimmed = value.trim();
    if (trimmed) rememberSearch(trimmed);
    setOpen(false);
    setInput(trimmed);
    // An empty box browses everything rather than searching for nothing.
    navigate(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search");
  };

  const activate = (item: Item) => {
    setOpen(false);

    switch (item.kind) {
      case "product":
        // Straight to the product, not to a results page listing one thing.
        // Skipping that page is the entire point of a type-ahead.
        rememberSearch(term);
        setInput("");
        navigate(`/product/${item.product._id}`);
        return;
      case "category":
        setInput("");
        navigate(`/search?category=${encodeURIComponent(item.category)}`);
        return;
      case "recent":
        goToSearch(item.term);
    }
  };

  const submitHandler = (e: FormEvent) => {
    e.preventDefault();
    // Enter with a row highlighted takes that row; Enter with nothing
    // highlighted does what the box has always done.
    if (highlight >= 0 && items[highlight]) activate(items[highlight]);
    else goToSearch(input);
  };

  const keyHandler = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (!open) return;
      // Only the dropdown closes. Header also listens for Escape to shut the
      // mobile search overlay, and one key press should not do both.
      e.stopPropagation();
      setOpen(false);
      setHighlight(-1);
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open) {
        openPanel();
        return;
      }
      if (items.length === 0) return;

      e.preventDefault(); // or the caret jumps to the end of the input
      const step = e.key === "ArrowDown" ? 1 : -1;
      // Wraps, and -1 (nothing highlighted) is a real position: arrowing up
      // from the first row returns to the typed text, which is what the
      // shopper actually wants to edit.
      setHighlight((prev) => {
        const next = prev + step;
        if (next < -1) return items.length - 1;
        if (next >= items.length) return -1;
        return next;
      });
      return;
    }

    if (e.key === "Tab") setOpen(false);
  };

  const listboxId = "search-suggestions";
  const optionId = (index: number) => `search-option-${index}`;
  const expanded = open && items.length > 0;

  return (
    <div className={`searchbox ${className}`.trim()} ref={boxRef}>
      <form onSubmit={submitHandler} role="search">
        <FaSearch aria-hidden />
        <input
          ref={inputRef}
          // `search` renders a browser clear button that sets the value without
          // a keystroke; `text` keeps this component the only thing driving it.
          type="text"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            openPanel();
          }}
          onFocus={openPanel}
          onKeyDown={keyHandler}
          placeholder="Search for products, brands and more"
          aria-label="Search products"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            highlight >= 0 ? optionId(highlight) : undefined
          }
          autoComplete="off"
        />
        <button type="submit">Search</button>
      </form>

      {expanded && (
        <div className="searchbox__panel">
          {term.length < MIN_TERM && (
            <div className="searchbox__head">
              <span>Recent searches</span>
              <button
                type="button"
                onClick={() => {
                  clearRecentSearches();
                  setRecent([]);
                }}
              >
                Clear
              </button>
            </div>
          )}

          <ul id={listboxId} role="listbox" aria-label="Search suggestions">
            {items.map((item, index) => {
              const active = index === highlight;
              const props = {
                id: optionId(index),
                role: "option" as const,
                "aria-selected": active,
                className: active ? "is-active" : undefined,
                // Pointer-down beats the blur that would close the panel.
                onPointerDown: (e: React.PointerEvent) => {
                  e.preventDefault();
                  activate(item);
                },
                onMouseEnter: () => setHighlight(index),
              };

              if (item.kind === "product")
                return (
                  <li key={`p-${item.product._id}`} {...props}>
                    <ProductImage
                      photo={item.product.photo}
                      name={item.product.name}
                    />
                    <span className="searchbox__name">{item.product.name}</span>
                  </li>
                );

              if (item.kind === "category")
                return (
                  <li key={`c-${item.category}`} {...props}>
                    <FiTag aria-hidden />
                    <span className="searchbox__name">
                      in <strong>{item.category}</strong>
                    </span>
                  </li>
                );

              return (
                <li key={`r-${item.term}`} {...props}>
                  <FiClock aria-hidden />
                  <span className="searchbox__name">{item.term}</span>
                </li>
              );
            })}
          </ul>

          {term.length >= MIN_TERM && (
            <button
              type="button"
              className="searchbox__all"
              onPointerDown={(e) => {
                e.preventDefault();
                goToSearch(input);
              }}
            >
              See all results for “{term}”
            </button>
          )}
        </div>
      )}

      {/* Only announced, never drawn: a spinner that appears for 80ms on every
          pause is visual noise, but a screen-reader user gets no other signal
          that the list is about to change. */}
      <span className="sr-only" role="status" aria-live="polite">
        {isFetching
          ? "Searching"
          : expanded
          ? `${items.length} suggestions available`
          : ""}
      </span>
    </div>
  );
};

export default SearchBox;
