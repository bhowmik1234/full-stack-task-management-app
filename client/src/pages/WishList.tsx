import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { FaHeart } from 'react-icons/fa';
import { CartItem } from '../types/types';
import { addToCart } from '../redux/reducer/cartReducer';
import { useDispatch, useSelector } from 'react-redux';
import ProductCart from '../components/ProductCart';
import { useMyWishListQuery } from '../redux/api/wishlistAPI';
import { RootState } from '../redux/store';
import { ProductSkeleton } from '../components/Loader';
import ErrorState from '../components/ErrorState';
import { queryErrorMessage } from '../utils/errors';


const WishList = () => {
    const dispatch = useDispatch();
    const { user } = useSelector((state: RootState) => state.userReducer);
    const { data: wishListData, isLoading, isError, error, refetch } = useMyWishListQuery(
        user?._id ?? "",
        { skip: !user?._id }
    );

    const addToCartHandler = (cartItem: CartItem) => {
        if (cartItem.stock < 1) {
            return toast.error('Out of stock');
        }
        dispatch(addToCart(cartItem));
        toast.success('Added to cart');
    };

    const items = wishListData?.WishList ?? [];

    return (
        <div className="wishlist-page">
            <header>
                <div>
                    <h2>My wishlist</h2>
                    {!isLoading && !isError && (
                        <p>{items.length} {items.length === 1 ? "item" : "items"} saved</p>
                    )}
                </div>
                <Link to="/search">Continue shopping</Link>
            </header>

            {isLoading ? (
                <ProductSkeleton length={8} layout="grid" />
            ) : isError ? (
                // Before the empty branch: a failed load left `items` empty and
                // claimed nothing was saved, which for a wishlist reads as the
                // saved items having been lost.
                <ErrorState
                    title="Couldn't load your wishlist"
                    message={queryErrorMessage(error)}
                    onRetry={refetch}
                />
            ) : items.length === 0 ? (
                // Previously an empty wishlist rendered a blank page.
                <div className="empty-state">
                    <FaHeart />
                    <h2>Nothing saved yet</h2>
                    <p>Tap the heart on any product to keep it here for later.</p>
                    <Link to="/search" className="btn">Browse products</Link>
                </div>
            ) : (
                <div className="wishlist-container">
                    {items.map((i) => (
                        <ProductCart
                            key={i._id}
                            productId={i._id}
                            name={i.name}
                            price={i.price}
                            stock={i.stock}
                            category={i.category}
                            hasVariants={i.hasVariants}
                            handler={addToCartHandler}
                            photo={i.photo}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default WishList;
