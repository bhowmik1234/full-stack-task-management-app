// Product.tsx
import { useMemo, useRef, useState } from 'react';
import { FaShoppingCart, FaHeart, FaTruck, FaUndoAlt, FaLock } from 'react-icons/fa';
import {
    useProdectDetailsQuery,
    useRelatedProductsQuery,
    useStockAlertQuery,
    useUnwatchStockMutation,
    useWatchStockMutation,
} from '../redux/api/productAPI';
import toast from 'react-hot-toast';
import ProductCart from '../components/ProductCart';
import ProductGallery from '../components/ProductGallery';
import ProductReviews from '../components/ProductReviews';
import ProductFaq from '../components/ProductFaq';
import ProductInfo from '../components/ProductInfo';
import StarRating from '../components/StarRating';
import { ProductSkeleton, Skeleton } from '../components/Loader';
import ErrorState from '../components/ErrorState';
import { queryErrorMessage } from '../utils/errors';
import { CartItem } from '../types/types';
import { useDispatch, useSelector } from 'react-redux';
import { addToCart } from '../redux/reducer/cartReducer';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { currentPath, loginState } from '../utils/loginRedirect';
import { RootState } from '../redux/store';
import {
    useAddWishListMutation,
    useDeleteWishListMutation,
    useMyWishListQuery,
} from '../redux/api/wishlistAPI';
import { formatINR } from '../utils/features';
import VariantPicker, { variantFor } from '../components/VariantPicker';
import Seo from '../components/Seo';


const Product = () => {
    const { id } = useParams();
    const {
        data: productData,
        isLoading: productLoaing,
        isError: productisError,
        error: productError,
        refetch: refetchProduct,
    } = useProdectDetailsQuery(id!);

    // The rail used to be `useLatestProductsQuery` — the newest products site
    // wide, under a heading that claimed they were related. This asks the
    // server for products actually near this one; it ranks them and excludes
    // the current product itself, so nothing is filtered out here.
    const { data, isLoading, isError } = useRelatedProductsQuery(id!, { skip: !id });

    // A failed *rail* is not a failed page: the product is still readable, and a
    // toast saying "cannot fetch the product" over a product that rendered
    // fine is just confusing. That section hides itself instead — see the
    // `isError` guard further down.
    //
    // A failed *product* is a failed page, and it is handled where the page is
    // rendered rather than with a toast. This used to be a bare
    // `if (productisError) toast.error(...)` here in the render body, which
    // fired again on every re-render, and the render below then fell into its
    // `!product` leg — so the page sat on a loading skeleton for ever, with no
    // 404, no message and no way to retry.

    const productSliderRef = useRef<HTMLDivElement>(null);
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useSelector((state: RootState) => state.userReducer);

    /**
     * Send a signed-out visitor to sign in and bring them back *here*.
     *
     * The three gated actions on this page used to answer a click with a toast
     * naming the requirement and offering no way to satisfy it — a dead end,
     * not a gate.
     */
    const askToSignIn = (why: string, intent?: { type: "wishlist"; productId: string }) => {
        toast(why);
        navigate("/login", { state: loginState(currentPath(location), intent) });
    };
    // The store's own rules, already loaded by App. Read here so the delivery
    // and returns promises next to the buy button are the real ones.
    const config = useSelector((state: RootState) => state.cartReducer.config);

    // The heart used to be local state only, so it forgot the choice on every
    // reload and never reached the wishlist API.
    const { data: wishListData } = useMyWishListQuery(user?._id ?? "", { skip: !user?._id });
    const [addWishList] = useAddWishListMutation();
    const [deleteWishList] = useDeleteWishListMutation();

    // Only asked when there is something to ask about: an in-stock product has
    // no alert state worth a request, and a signed-out visitor has no alerts.
    // Keyed off productData rather than the `product` alias below, because
    // hooks cannot be declared after the early returns that sit between them.
    const { data: alertData } = useStockAlertQuery(
        { productId: id!, userId: user?._id ?? "" },
        {
            skip:
                !id ||
                !user?._id ||
                !productData ||
                (productData.product?.stock ?? 0) > 0,
        }
    );
    const [watchStock, { isLoading: savingAlert }] = useWatchStockMutation();
    const [unwatchStock, { isLoading: removingAlert }] = useUnwatchStockMutation();
    const watching = alertData?.watching ?? false;
    const alertBusy = savingAlert || removingAlert;

    const scrollProducts = (direction: 'left' | 'right') => {
        const track = productSliderRef.current;
        if (!track) return;
        const amount = track.clientWidth * 0.85;
        track.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
    };

    const addToCartHandler = (cartItem: CartItem) => {
        if (cartItem.stock < 1) {
            return toast.error("out of stock");
        }
        dispatch(addToCart(cartItem)!);
        toast.success("added to cart");
    }

    const [quantity, setQuantity] = useState(1);
    // One entry per option, "" until chosen. Starts empty rather than
    // preselecting the first combination: preselecting means a customer who
    // never looked at the picker still buys *something*, and the size they
    // receive is whichever happened to be first in the admin form.
    const [selection, setSelection] = useState<string[]>([]);

    const product = productData?.product;
    const options = product?.options ?? [];
    const variants = product?.variants ?? [];
    const hasVariants = options.length > 0;

    // The combination the customer has landed on, once every option is chosen.
    const chosenVariant = useMemo(
        () => (hasVariants ? variantFor(variants, selection) : undefined),
        [hasVariants, variants, selection]
    );

    // Price and stock come from the variant when there is one. `product.price`
    // is the cheapest variant and `product.stock` the sum across them, which is
    // right for a card and wrong for a buy box — it would offer the blue medium
    // at the red small's price.
    const price = chosenVariant?.price ?? product?.price ?? 0;
    const stock = hasVariants ? (chosenVariant?.stock ?? 0) : (product?.stock ?? 0);

    // A product with variants but nothing chosen yet is not out of stock — it is
    // waiting for a choice, and the two need different buttons.
    const awaitingChoice = hasVariants && !chosenVariant;
    const outOfStock = !awaitingChoice && stock < 1;
    const lowStock = !outOfStock && !awaitingChoice && stock <= 5;
    const rating = product?.ratings ?? 0;
    const isFavorite = wishListData?.WishList.some((i) => i._id === product?._id) ?? false;

    const changeQuantity = (next: number) => {
        if (Number.isNaN(next) || next < 1 || next > stock) return;
        setQuantity(next);
    };

    const putInCart = () => {
        if (!product) return false;

        if (awaitingChoice) {
            toast.error(`Please choose ${options.map((o) => o.name.toLowerCase()).join(" and ")}.`);
            return false;
        }

        if (outOfStock) {
            toast.error("out of stock");
            return false;
        }

        dispatch(addToCart({
            productId: product._id,
            photo: product.photo,
            name: product.name,
            price,
            quantity,
            stock,
            // null for a product without options. The cart keys its lines on
            // this together with productId, so two sizes are two lines.
            variantId: chosenVariant?._id ?? null,
            variantLabel: chosenVariant?.label ?? "",
        }));
        return true;
    };

    const addToaCart = () => {
        if (putInCart()) toast.success("added to cart.");
    };

    // Straight to checkout. /shipping is behind ProtectedRoute, so send a
    // signed-out shopper to login rather than letting it bounce them home —
    // carrying /shipping as the return path, since the item is already in the
    // cart and checkout is what they actually asked for. Without that state
    // they signed in and landed on the home page.
    const buyNow = () => {
        if (!putInCart()) return;
        if (!user?._id)
            return navigate("/login", { state: loginState("/shipping") });
        navigate("/shipping");
    };

    /**
     * Back-in-stock request. Login is demanded here for the same reason it is on
     * the wishlist — there is nowhere to send the email otherwise — and it is one
     * of the small set of places the app asks at all.
     */
    const toggleStockAlert = async () => {
        if (!user?._id)
            return askToSignIn("Sign in so we know where to email you.");
        if (!product) return;

        try {
            if (watching) {
                await unwatchStock({ userId: user._id, productId: product._id }).unwrap();
                toast.success("Alert cancelled.");
            } else {
                await watchStock({ userId: user._id, productId: product._id }).unwrap();
                toast.success("We'll email you when it's back.");
            }
        } catch (error) {
            // The server refuses if the product restocked between the page load
            // and the click, and says so; showing that beats a generic failure.
            const message = (error as { data?: { message?: string } })?.data?.message;
            toast.error(message ?? "Could not update your alert.");
        }
    };

    const toggleFavorite = async () => {
        // The wishlist is the one gated action worth resuming: coming back to
        // the page still leaves the customer a second click from the thing they
        // already clicked. LoginIntent finishes it. See utils/loginRedirect.ts.
        if (!user?._id)
            return askToSignIn(
                "Sign in to save this to your wishlist.",
                product ? { type: "wishlist", productId: product._id } : undefined
            );
        if (!product) return;

        try {
            if (isFavorite) {
                await deleteWishList({ userId: user._id, productId: product._id });
                toast.success("Removed from wishlist.");
            } else {
                await addWishList({ userId: user._id, productId: product._id });
                toast.success("Added to wishlist.");
            }
        } catch {
            toast.error("Could not update your wishlist.");
        }
    };

    return (
        <div className="product page">
            {/* Every product used to share the home page's title and
                description, so a link to any of them previewed as the shop
                front. The description falls back to a generated sentence
                because plenty of products have no description written. */}
            {product && (
                <Seo
                    title={product.name}
                    description={
                        product.description?.slice(0, 155) ||
                        `Buy ${product.name}${product.brand ? ` by ${product.brand}` : ""} for ${formatINR(product.price)}.`
                    }
                    image={product.photo}
                    type="product"
                />
            )}

            <nav className="product__breadcrumb" aria-label="Breadcrumb">
                <Link to="/">Home</Link>
                <span>/</span>
                {product?.category ? (
                    <>
                        <Link to={`/search?category=${encodeURIComponent(product.category)}`}>
                            {product.category}
                        </Link>
                        <span>/</span>
                    </>
                ) : null}
                <span>{product?.name ?? "Product"}</span>
            </nav>

            {productLoaing ? (
                <Skeleton length={6} height="2.5rem" />
            ) : productisError || !product ? (
                <ErrorState
                    title="We couldn't load this product"
                    message={queryErrorMessage(
                        productError,
                        "This product may have been removed."
                    )}
                    onRetry={refetchProduct}
                />
            ) : (
                <>
                    <section className="product__main">
                        <ProductGallery
                            images={product.images?.length ? product.images : [product.photo]}
                            name={product.name}
                            outOfStock={outOfStock}
                        />

                        <div className="product__buybox">
                            {product.category && (
                                <Link
                                    className="product__category"
                                    to={`/search?category=${encodeURIComponent(product.category)}`}
                                >
                                    {product.category}
                                </Link>
                            )}
                            <h1 className="product__name">{product.name}</h1>
                            {product.brand && (
                                <p className="product__brand">by {product.brand}</p>
                            )}

                            {rating > 0 ? (
                                <a href="#reviews" className="product__rating">
                                    <StarRating value={rating} showValue />
                                    <span>
                                        {product.numOfReviews}{" "}
                                        {product.numOfReviews === 1 ? "review" : "reviews"}
                                    </span>
                                </a>
                            ) : (
                                <a href="#reviews" className="product__rating product__rating--empty">
                                    <StarRating value={0} />
                                    <span>No reviews yet</span>
                                </a>
                            )}

                            <div className="product__price">
                                <strong>
                                    {/* "from" while no combination is chosen: the
                                        product's price is the cheapest variant, and
                                        showing it bare would read as the price of
                                        whatever the customer picks next. */}
                                    {awaitingChoice && <span className="product__price-from">from </span>}
                                    {formatINR(price)}
                                </strong>
                                <small>Inclusive of all taxes</small>
                            </div>

                            {hasVariants && (
                                <VariantPicker
                                    options={options}
                                    variants={variants}
                                    selection={selection}
                                    onChange={(next) => {
                                        setSelection(next);
                                        // The new combination may hold fewer units
                                        // than the last one. Snapping back to 1 is
                                        // better than silently capping, which looks
                                        // like the input ignored a keystroke.
                                        setQuantity(1);
                                    }}
                                />
                            )}

                            <p className="product__stock">
                                {awaitingChoice ? (
                                    <span className="badge badge--muted">
                                        Choose {options.map((o) => o.name.toLowerCase()).join(" and ")}
                                    </span>
                                ) : outOfStock ? (
                                    <span className="badge badge--danger">Out of stock</span>
                                ) : lowStock ? (
                                    <>
                                        <span className="badge badge--warning">Only {stock} left</span>
                                        Order soon
                                    </>
                                ) : (
                                    <>
                                        <span className="badge badge--success">In stock</span>
                                        Ready to ship
                                    </>
                                )}
                            </p>

                            <div className="product__actions">
                                <div className="product__quantity">
                                    <button
                                        type="button"
                                        onClick={() => changeQuantity(quantity - 1)}
                                        disabled={quantity <= 1 || outOfStock || awaitingChoice}
                                        aria-label="Decrease quantity"
                                    >
                                        −
                                    </button>
                                    <input
                                        type="number"
                                        id="quantity"
                                        value={quantity}
                                        onChange={(e) => changeQuantity(parseInt(e.target.value, 10))}
                                        min="1"
                                        max={stock}
                                        aria-label="Quantity"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => changeQuantity(quantity + 1)}
                                        disabled={quantity >= stock || outOfStock || awaitingChoice}
                                        aria-label="Increase quantity"
                                    >
                                        +
                                    </button>
                                </div>
                                <button
                                    className="product__add-to-cart"
                                    onClick={addToaCart}
                                    disabled={outOfStock}
                                >
                                    <FaShoppingCart />{" "}
                                    {/* Left enabled while a choice is outstanding
                                        on purpose: pressing it names the option
                                        still to pick, which teaches more than a
                                        greyed-out button explaining nothing. */}
                                    {awaitingChoice
                                        ? "Select options"
                                        : outOfStock
                                            ? "Out of stock"
                                            : "Add to cart"}
                                </button>
                                <button
                                    className={`product__favorite ${isFavorite ? 'favorite-active' : ''}`}
                                    onClick={toggleFavorite}
                                    aria-pressed={isFavorite}
                                    aria-label={isFavorite ? "Remove from wishlist" : "Add to wishlist"}
                                >
                                    <FaHeart />
                                </button>
                            </div>

                            {outOfStock ? (
                                // Replaces "Buy now" rather than sitting beside it: a
                                // disabled buy button next to a live one is a dead
                                // control competing with the only thing that works here.
                                <button
                                    className="product__buy-now"
                                    onClick={toggleStockAlert}
                                    disabled={alertBusy}
                                >
                                    {watching
                                        ? "We'll email you — cancel alert"
                                        : "Email me when it's back"}
                                </button>
                            ) : (
                                <button
                                    className="product__buy-now"
                                    onClick={buyNow}
                                >
                                    Buy now
                                </button>
                            )}

                            {!!product.highlights?.length && (
                                <ul className="product__highlights">
                                    {product.highlights.map((point) => (
                                        <li key={point}>{point}</li>
                                    ))}
                                </ul>
                            )}

                            {/* These used to state ₹1,000 and 7 days as literals,
                                which made them a fourth copy of numbers the store
                                configures — and the one a customer reads just
                                before deciding to buy. They now come from the
                                same config the cart prices with. */}
                            <ul className="product__perks">
                                <li>
                                    <FaTruck /> Free delivery on orders over{" "}
                                    {formatINR(config.freeShippingThreshold)}
                                </li>
                                <li>
                                    <FaUndoAlt /> {config.returnWindowDays}-day returns —{" "}
                                    <Link to="/returns-policy">see the policy</Link>
                                </li>
                                <li><FaLock /> Secure checkout powered by Razorpay</li>
                            </ul>
                        </div>
                    </section>

                    {product.description && (
                        <section className="product__description">
                            <h2>About this product</h2>
                            {/* Stored as plain text; split on blank lines so an
                                admin can write paragraphs. */}
                            {product.description
                                .split(/\n\s*\n/)
                                .map((paragraph, index) => (
                                    <p key={index}>{paragraph}</p>
                                ))}
                        </section>
                    )}

                    <ProductInfo product={product} />

                    <ProductReviews productId={product._id} />

                    <ProductFaq />
                </>
            )}

            {/* Hidden entirely when there is nothing to show — an empty rail
                under a heading promising suggestions is worse than no rail.
                Also hidden if the request failed; see the comment above. */}
            {(isLoading || (!isError && (data?.products.length ?? 0) > 0)) && (
            <section className="product__related">
                <h2>You may also like</h2>
                <div className="product-rail">
                    <button
                        className="product-rail__arrow product-rail__arrow--left"
                        onClick={() => scrollProducts('left')}
                        aria-label="Scroll left"
                    >
                        &#10094;
                    </button>
                    <div className="product-rail__track" ref={productSliderRef}>
                        {isLoading ? (
                            <ProductSkeleton length={5} />
                        ) : (
                            // No .filter() here any more: the server excludes
                            // the current product, so the rail always renders
                            // the full count instead of quietly dropping to
                            // four whenever this product was among the newest.
                            data?.products.map((i) => (
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
                            ))
                        )}
                    </div>
                    <button
                        className="product-rail__arrow product-rail__arrow--right"
                        onClick={() => scrollProducts('right')}
                        aria-label="Scroll right"
                    >
                        &#10095;
                    </button>
                </div>
            </section>
            )}
        </div>
    );
};

export default Product;
