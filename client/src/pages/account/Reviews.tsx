import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import toast from "react-hot-toast";
import { FiStar } from "react-icons/fi";
import { RootState } from "../../redux/store";
import {
  useDeleteReviewMutation,
  useMyReviewsQuery,
} from "../../redux/api/productAPI";
import { CustomError } from "../../types/api-types";
import { MyReview } from "../../types/types";
import { Skeleton } from "../../components/Loader";
import ErrorState from "../../components/ErrorState";
import { queryErrorMessage } from "../../utils/errors";
import ProductImage from "../../components/ProductImage";

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const Stars = ({ rating }: { rating: number }) => (
  <span className="my-reviews__stars" aria-label={`${rating} out of 5`}>
    {[1, 2, 3, 4, 5].map((n) => (
      <FiStar key={n} className={n <= rating ? "is-filled" : ""} aria-hidden />
    ))}
  </span>
);

/**
 * Everything the customer has reviewed.
 *
 * Editing happens on the product page rather than here: a review is written
 * against the product, next to the other reviews and the thing being rated, and
 * duplicating that editor would give the app two forms writing the same row. So
 * this page links out to it, and keeps only the destructive action — the one
 * with nowhere else to live, because a product page for something you no longer
 * want to talk about is not where you go to stop talking about it.
 */
const Reviews = () => {
  const { user } = useSelector((state: RootState) => state.userReducer);
  const id = user?._id ?? "";

  const { data, isLoading, isError, error, refetch } = useMyReviewsQuery(id, { skip: !id });
  const [remove] = useDeleteReviewMutation();

  const destroy = async (review: MyReview) => {
    if (!window.confirm(`Delete your review of "${review.product.name}"?`)) return;

    const res = await remove({ productId: review.productId, userId: id });
    const err = (res as { error?: CustomError }).error;

    if (err) toast.error(err.data?.message ?? "Could not delete the review");
    else toast.success("Review removed");
  };

  if (isLoading) return <Skeleton length={5} />;
  // Was `<p className="account__error">`, a class with no rule anywhere in
  // styles/ — so the one page that did distinguish an error from an empty
  // list announced it in unstyled body text.
  if (isError)
    return (
      <ErrorState
        title="Couldn't load your reviews"
        message={queryErrorMessage(error)}
        onRetry={refetch}
      />
    );

  const reviews = data?.reviews ?? [];

  if (reviews.length === 0)
    return (
      <div className="empty-state">
        <FiStar />
        <h2>No reviews yet</h2>
        <p>
          Once you have bought something, your rating helps the next person
          decide.
        </p>
        <Link to="/orders" className="btn">
          Review something you ordered
        </Link>
      </div>
    );

  return (
    <div className="my-reviews">
      <div className="section-head">
        <div>
          <h2>Your reviews</h2>
          <p>
            {reviews.length} review{reviews.length === 1 ? "" : "s"}. Edit one by
            opening the product.
          </p>
        </div>
      </div>

      <ul className="my-reviews__list">
        {reviews.map((review) => (
          <li key={review._id} className="card my-reviews__item">
            <Link to={`/product/${review.productId}`} className="my-reviews__product">
              <ProductImage photo={review.product.photo} name={review.product.name} />
              <span>{review.product.name}</span>
            </Link>

            <div className="my-reviews__body">
              <div className="my-reviews__meta">
                <Stars rating={review.rating} />
                {review.verified && (
                  <span className="badge badge--success">Verified purchase</span>
                )}
                <time dateTime={review.updatedAt}>
                  {formatDate(review.updatedAt)}
                </time>
              </div>

              {review.title && <h3>{review.title}</h3>}
              <p>{review.comment}</p>

              <div className="my-reviews__actions">
                <Link to={`/product/${review.productId}`} className="btn btn--ghost">
                  Edit on product page
                </Link>
                <button className="btn btn--danger" onClick={() => destroy(review)}>
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default Reviews;
