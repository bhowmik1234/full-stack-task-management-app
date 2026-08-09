import { useLocation, useNavigate } from "react-router-dom";
import { currentPath, loginState } from "../utils/loginRedirect";
import { prefetchRoute } from "../routes/lazyRoutes";
import { CartItem } from "../types/types"
import { FaHeart, FaShoppingBag } from 'react-icons/fa';
import React, { useEffect } from "react";
import { useSelector } from "react-redux";
import { RootState } from "../redux/store";
import { useAddWishListMutation, useDeleteWishListMutation, useMyWishListQuery } from "../redux/api/wishlistAPI";
import { productAPI } from "../redux/api/productAPI";
import toast from "react-hot-toast";
import { formatINR } from "../utils/features";
import ProductImage from "./ProductImage";
import StarRating from "./StarRating";


type ProductProps = {
  productId: string;
  photo: string;
  name: string;
  price: number;
  stock: number;
  category?: string;
  ratings?: number;
  numOfReviews?: number;
  /**
   * True when the product varies along at least one option.
   *
   * List endpoints send the flag but not the combinations themselves — a card
   * renders a hero image and a "from" price and has no use for them. It matters
   * here because a product with options cannot be added to a cart without one:
   * the card's button has to become a link to the product page rather than
   * create a line checkout is going to refuse.
   */
  hasVariants?: boolean;
  handler: (cartItem: CartItem) => string | undefined;
}
const ProductCart = ({
  productId,
  photo,
  name,
  price,
  stock,
  category,
  ratings,
  numOfReviews,
  hasVariants,
  handler
}: ProductProps) => {
  const [isWishlisted, setIsWishlisted] = React.useState(false);
  const { user } = useSelector((state: RootState) => state.userReducer);
  const { data: wishListData} = useMyWishListQuery(user?._id ?? "", {
    skip: !user?._id,
  });

  useEffect(() => {
    if (wishListData) {
      setIsWishlisted(wishListData.WishList.some(e => e._id === productId));
    }
  }, [wishListData, productId]);

  const [addWishList] = useAddWishListMutation();
  const [deleteWishList] = useDeleteWishListMutation();

  const outOfStock = stock < 1;
  // "Only n left" is worth surfacing; anything above this is just noise.
  const lowStock = !outOfStock && stock <= 5;

  const navigate = useNavigate();
  const location = useLocation();
  const productDetail = () =>{
    return navigate(`/product/${productId}`);
  }

  // RTK Query's prefetch writes into the same cache the detail page reads, so
  // the page finds its data already there rather than issuing the request on
  // mount. `ifOlderThan: 60` means a hover does not re-request something
  // fetched moments ago, so sweeping the pointer across a grid is cheap.
  const prefetchProduct = productAPI.usePrefetch("ProdectDetails", { ifOlderThan: 60 });
  const warm = () => {
    prefetchRoute(`/product/${productId}`);
    prefetchProduct(productId);
  };

  const handleWishlist = async (e: any) => {
    e.stopPropagation();
    // A toast naming the requirement and offering no way to meet it is a dead
    // end, not a gate. Send them to sign in, come back to this grid, and finish
    // the save they already asked for (components/LoginIntent.tsx).
    if (!user?._id) {
      toast("Sign in to save this to your wishlist.");
      return navigate("/login", {
        state: loginState(currentPath(location), { type: "wishlist", productId }),
      });
    }
    try {
      if(!isWishlisted){
        await addWishList({userId: user._id, productId});
        toast.success("Added to wishlist.");
        setIsWishlisted(true);
      }else{
        setIsWishlisted(false);
        await deleteWishList({userId: user._id, productId});
        toast.success("Removed from wishlist.");
      }
    } catch (error) {
      console.log(error);
    }
  };

  const addTocart = (e:any) =>{
    e.stopPropagation();

    // A product with options has no single price or stock pool to add against,
    // so there is nothing honest for this button to do — the card's `price` is
    // the cheapest variant and its `stock` the sum across them. Sending the
    // shopper to the picker is the only correct action.
    if (hasVariants) return productDetail();

    handler({
      productId,
      photo,
      name,
      price,
      stock,
      quantity: 1,
      variantId: null,
      variantLabel: "",
    });
  }

  return (
    <div
      className={`productCart${outOfStock ? " productCart--sold-out" : ""}`}
      onClick={productDetail}
      // The card is the primary link to the product, so it has to be reachable
      // and activatable from the keyboard, not just the mouse.
      role="link"
      tabIndex={0}
      // Warm the product page on intent — both halves of what the click needs:
      // the route's chunk, and the product's own data. A shopper's pointer
      // rests on a card for a good fraction of a second before they commit, and
      // spending that on the two requests the click is about to make is the
      // difference between the detail page appearing and it loading.
      onMouseEnter={warm}
      onFocus={warm}
      onTouchStart={warm}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          productDetail();
        }
      }}
    >
      <div className="imageWrapper">
        <ProductImage photo={photo} name={name} />

        <button
          className={`wishlistBtn ${isWishlisted ? 'wishlisted' : ''}`}
          onClick={handleWishlist}
          aria-label={isWishlisted ? `Remove ${name} from wishlist` : `Add ${name} to wishlist`}
          aria-pressed={isWishlisted}
        >
          <FaHeart />
        </button>

        {outOfStock && <div className="outOfStock">Out of stock</div>}
      </div>

      <div className="productInfo">
        {category && <span className="category">{category}</span>}
        <h3 className="name">{name}</h3>
        {/* Ratings render only when the product actually has some — the card
            used to hard-code five stars for everything. */}
        {typeof ratings === "number" && ratings > 0 && (
          <StarRating value={ratings} count={numOfReviews} />
        )}
        <div className="foot">
          <span className="price">
            {/* The catalogue price of a product with options is its cheapest
                variant, so stating it bare would be a price nobody can
                necessarily pay. */}
            {hasVariants && <small className="price__from">from </small>}
            {formatINR(price)}
          </span>
          {!outOfStock && (
            <span className={`stock${lowStock ? " stock--low" : ""}`}>
              {lowStock ? `${stock} left` : "In stock"}
            </span>
          )}
        </div>
      </div>

      <button
        className="addToCartBtn"
        onClick={addTocart}
        disabled={outOfStock}
      >
        {/* The image already carries the "out of stock" flag, so the button
            says what it is rather than repeating it. */}
        <FaShoppingBag />{" "}
        {outOfStock ? "Unavailable" : hasVariants ? "Choose options" : "Add to cart"}
      </button>
    </div>
  )
}

export default ProductCart
