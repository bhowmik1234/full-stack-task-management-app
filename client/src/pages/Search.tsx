
import { useEffect, useState } from "react";
import ProductCart from "../components/ProductCart";
import { useCategoriesQuery, useLatestProductsQuery, useSeatchProductsQuery } from "../redux/api/productAPI";
import toast from "react-hot-toast";
import { ProductSkeleton } from "../components/Loader";
import ErrorState from "../components/ErrorState";
import { queryErrorMessage } from "../utils/errors";
import { CartItem } from "../types/types";
import { addToCart } from "../redux/reducer/cartReducer";
import { useDispatch } from "react-redux";
import { useSearchParams } from "react-router-dom";
import { formatINR } from "../utils/features";
import Seo from "../components/Seo";

const MAX_PRICE = 100000;

const Search = () => {
  const dispatch = useDispatch();
  const { data: CategoriesResponse, isLoading: isLoadingCategories, isError, error } = useCategoriesQuery("");
  // fallback list when a search returns nothing. Uses the public `latest`
  // endpoint — `admin-products` is admin-only and returns the whole catalogue.
  const { data: LatestData, isError: LatestError, error: lerror } = useLatestProductsQuery("");

  // The term arrives as ?q=, and the category rail links in with ?category=.
  // The legacy /search/:id path no longer reaches this component — App.tsx
  // redirects it to ?q= so one result set has one URL.
  const [searchParams] = useSearchParams();
  const queryTerm = searchParams.get("q") ?? "";
  const search = queryTerm === "product" ? "" : queryTerm;
  const categoryParam = searchParams.get("category") ?? "";

  const [sort, setSort] = useState("");
  const [maxPrice, setMaxPrice] = useState(MAX_PRICE);
  const [category, setCategory] = useState(categoryParam);
  const [page, setPage] = useState(1);

  // Following a category link while already on this page has to move the
  // filter, and any new query resets pagination.
  useEffect(() => {
    setCategory(categoryParam);
  }, [categoryParam]);

  useEffect(() => {
    setPage(1);
  }, [search, category, sort, maxPrice]);

  const {
    data: SearchedData,
    isLoading: SearchDataLoading,
    isError: SearchisError,
    error: SearchError,
    refetch: refetchSearch }
    = useSeatchProductsQuery({ search, sort, category, page, price: maxPrice });

  // These three used to be bare `if (isError) toast.error(err.data.message)` in
  // the render body, which was two bugs in one line. `err.data` is undefined on
  // a network failure, so reading `.message` threw a TypeError *during render*
  // and blanked the page — on the page that re-renders most, since every filter
  // change re-runs this. And a toast is a side effect: it fired again on each
  // of those re-renders, stacking identical messages.
  useEffect(() => {
    if (isError) toast.error(queryErrorMessage(error, "Could not load categories."));
  }, [isError, error]);

  useEffect(() => {
    if (LatestError) toast.error(queryErrorMessage(lerror, "Could not load suggestions."));
  }, [LatestError, lerror]);

  const addToCartHandler = (cartItem: CartItem) => {
    if (cartItem.stock < 1) {
      return toast.error("out of stock");
    }
    dispatch(addToCart(cartItem));
    toast.success("added to cart");
  }

  const results = SearchedData?.products ?? [];
  const totalPage = SearchedData?.totalPage ?? 1;
  const isPrevPage = page > 1;
  const isNextPage = page < totalPage;
  const hasFilters = Boolean(sort || category) || maxPrice < MAX_PRICE;

  const clearFilters = () => {
    setSort("");
    setCategory("");
    setMaxPrice(MAX_PRICE);
  };

  return (
    <div className="product-search-page page">
      {/* Titled by what is actually being browsed, so a tab full of category
          pages is readable. Not indexed: every filter combination is its own
          URL, and letting a crawler enumerate them fills an index with
          thousands of near-identical pages competing with the product pages
          that should rank. `Seo` drops the query string from the canonical for
          the same reason. */}
      <Seo
        title={
          search
            ? `Search: ${search}`
            : categoryParam
              ? `${categoryParam.charAt(0).toUpperCase()}${categoryParam.slice(1)}`
              : "All products"
        }
        description="Browse the full catalogue by category, price and rating."
        noIndex
      />

      <aside className="filters">
        <h2>
          Filters
          {hasFilters && (
            <button type="button" onClick={clearFilters}>Clear all</button>
          )}
        </h2>

        <div className="filter-group">
          <h4><label htmlFor="sort">Sort by</label></h4>
          <select id="sort" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="">Relevance</option>
            <option value="asc">Price: low to high</option>
            <option value="dsc">Price: high to low</option>
          </select>
        </div>

        <div className="filter-group">
          <h4>
            <label htmlFor="max-price">Max price</label>
            <span>{formatINR(maxPrice)}</span>
          </h4>
          <input
            id="max-price"
            type="range"
            min={100}
            max={MAX_PRICE}
            step={100}
            value={maxPrice}
            onChange={(e) => setMaxPrice(Number(e.target.value))}
          />
          <div className="range-bounds">
            <span>{formatINR(100)}</span>
            <span>{formatINR(MAX_PRICE)}</span>
          </div>
        </div>

        <div className="filter-group">
          <h4><label htmlFor="category">Category</label></h4>
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">All categories</option>
            {!isLoadingCategories && CategoriesResponse?.categories.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
      </aside>

      <main>
        <div className="search-summary">
          <h1>
            {search ? <>Results for <span>“{search}”</span></> : "All products"}
          </h1>
          {!SearchDataLoading && results.length > 0 && (
            <p>
              Page {page} of {totalPage}
            </p>
          )}
        </div>

        {SearchDataLoading ? (
          <ProductSkeleton length={8} layout="grid" />
        ) : SearchisError ? (
          // Not "No products matched". A failed request and a search with no
          // results look identical in the data — both leave `results` empty —
          // and telling someone their term matched nothing sends them off
          // rewording a query that was never the problem.
          <ErrorState
            title="Couldn't load these results"
            message={queryErrorMessage(SearchError)}
            onRetry={refetchSearch}
          />
        ) : results.length > 0 ? (
          <div className="search-product-list">
            {results.map((i) => (
              <ProductCart
                key={i._id}
                productId={i._id}
                name={i.name}
                price={i.price}
                stock={i.stock}
                category={i.category}
                ratings={i.ratings}
                numOfReviews={i.numOfReviews}
                hasVariants={i.hasVariants}
                handler={addToCartHandler}
                photo={i.photo}
              />
            ))}
          </div>
        ) : (
          <div className="search-fallback">
            <div className="empty-state">
              <h2>No products matched</h2>
              <p>
                {hasFilters
                  ? "Try widening your price range or clearing the category filter."
                  : "Try a different search term."}
              </p>
              {hasFilters && (
                <button type="button" className="btn btn--ghost" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>

            {!!LatestData?.products.length && (
              <>
                <h2>You might like these instead</h2>
                <div className="search-product-list">
                  {LatestData.products.map((i) => (
                    <ProductCart
                      key={i._id}
                      productId={i._id}
                      name={i.name}
                      price={i.price}
                      stock={i.stock}
                      category={i.category}
                      ratings={i.ratings}
                      numOfReviews={i.numOfReviews}
                      hasVariants={i.hasVariants}
                      handler={addToCartHandler}
                      photo={i.photo}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {results.length > 0 && totalPage > 1 && (
          <article>
            <button
              disabled={!isPrevPage}
              onClick={() => setPage((prev) => prev - 1)}
            >
              Previous
            </button>
            <span>
              {page} of {totalPage}
            </span>
            <button
              disabled={!isNextPage}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Next
            </button>
          </article>
        )}
      </main>
    </div>
  );
};

export default Search;
