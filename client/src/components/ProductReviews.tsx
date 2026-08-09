import { FormEvent, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { currentPath, loginState } from "../utils/loginRedirect";
import { useSelector } from "react-redux";
import toast from "react-hot-toast";
import { FaCheckCircle, FaRegStar, FaStar, FaTrash } from "react-icons/fa";
import {
  useDeleteReviewMutation,
  useMyReviewQuery,
  useNewReviewMutation,
  useProductReviewsQuery,
} from "../redux/api/productAPI";
import { RootState } from "../redux/store";
import StarRating from "./StarRating";
import { Skeleton } from "./Loader";

const RATING_LABELS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

const ProductReviews = ({ productId }: { productId: string }) => {
  const { user } = useSelector((state: RootState) => state.userReducer);
  const location = useLocation();

  const { data, isLoading } = useProductReviewsQuery(productId);
  const { data: mine } = useMyReviewQuery(
    { productId, userId: user?._id ?? "" },
    { skip: !user?._id }
  );

  const [submitReview, { isLoading: isSaving }] = useNewReviewMutation();
  const [removeReview] = useDeleteReviewMutation();

  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");

  // Opening the form to edit should start from what was written before.
  useEffect(() => {
    if (mine?.review) {
      setRating(mine.review.rating);
      setTitle(mine.review.title);
      setComment(mine.review.comment);
    }
  }, [mine?.review]);

  const reviews = data?.reviews ?? [];
  const average = data?.average ?? 0;
  const total = data?.numOfReviews ?? 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user?._id) return toast.error("Please log in to write a review.");
    if (rating < 1) return toast.error("Pick a star rating first.");
    if (!comment.trim()) return toast.error("Add a few words about the product.");

    const res = await submitReview({
      productId,
      userId: user._id,
      rating,
      title: title.trim(),
      comment: comment.trim(),
    });

    if ("data" in res) {
      toast.success(res.data?.message ?? "Thanks for your review.");
      setOpen(false);
    } else {
      toast.error("Could not save your review.");
    }
  };

  const remove = async () => {
    if (!user?._id) return;
    const res = await removeReview({ productId, userId: user._id });
    if ("data" in res) {
      toast.success(res.data?.message ?? "Review removed.");
      setRating(0);
      setTitle("");
      setComment("");
      setOpen(false);
    } else {
      toast.error("Could not remove your review.");
    }
  };

  return (
    <section className="reviews" id="reviews">
      <h2>Ratings &amp; reviews</h2>

      {isLoading ? (
        <Skeleton length={4} height="2.5rem" />
      ) : (
        <>
          <div className="reviews__summary">
            <div className="reviews__score">
              <strong>{average.toFixed(1)}</strong>
              <StarRating value={average} size="md" />
              <span>
                {total} {total === 1 ? "review" : "reviews"}
              </span>
            </div>

            <div className="reviews__breakdown">
              {(data?.distribution ?? []).map((bucket) => {
                const percent = total ? (bucket.count / total) * 100 : 0;
                return (
                  <div key={bucket.stars} className="reviews__bar">
                    <span>{bucket.stars} ★</span>
                    <div className="reviews__track">
                      <div className="reviews__fill" style={{ width: `${percent}%` }} />
                    </div>
                    <span className="reviews__bar-count">{bucket.count}</span>
                  </div>
                );
              })}
            </div>

            <div className="reviews__cta">
              {user?._id ? (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setOpen((prev) => !prev)}
                >
                  {mine?.review ? "Edit your review" : "Write a review"}
                </button>
              ) : (
                <>
                  <p>Bought this? Tell other shoppers what you think.</p>
                  {/* Back to this product, not the home page — a review is
                      about the thing they are looking at. */}
                  <Link
                    to="/login"
                    state={loginState(currentPath(location))}
                    className="btn btn--ghost"
                  >
                    Log in to review
                  </Link>
                </>
              )}
              {mine?.purchased && (
                <span className="reviews__verified-note">
                  <FaCheckCircle /> You bought this item
                </span>
              )}
            </div>
          </div>

          {open && user?._id && (
            <form className="reviews__form" onSubmit={submit}>
              <div className="reviews__stars-input">
                <span>Your rating</span>
                <div onMouseLeave={() => setHovered(0)}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      onMouseEnter={() => setHovered(star)}
                      aria-label={`${star} star${star > 1 ? "s" : ""}`}
                      aria-pressed={rating === star}
                    >
                      {(hovered || rating) >= star ? <FaStar /> : <FaRegStar />}
                    </button>
                  ))}
                </div>
                {(hovered || rating) > 0 && <em>{RATING_LABELS[hovered || rating]}</em>}
              </div>

              <div className="field">
                <label htmlFor="review-title">Headline (optional)</label>
                <input
                  id="review-title"
                  className="input"
                  value={title}
                  maxLength={120}
                  placeholder="Sum it up in a few words"
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="review-comment">Your review</label>
                <textarea
                  id="review-comment"
                  className="input"
                  rows={4}
                  maxLength={2000}
                  value={comment}
                  placeholder="What did you like or dislike? How did you use it?"
                  onChange={(e) => setComment(e.target.value)}
                />
                <span className="reviews__counter">{comment.length}/2000</span>
              </div>

              <div className="reviews__form-actions">
                <button type="submit" className="btn" disabled={isSaving}>
                  {isSaving ? "Saving…" : mine?.review ? "Update review" : "Submit review"}
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                {mine?.review && (
                  <button type="button" className="btn btn--danger" onClick={remove}>
                    <FaTrash /> Delete
                  </button>
                )}
              </div>
            </form>
          )}

          {reviews.length === 0 ? (
            <div className="empty-state">
              <FaRegStar />
              <h3>No reviews yet</h3>
              <p>Be the first to share what you think about this product.</p>
            </div>
          ) : (
            <ul className="reviews__list">
              {reviews.map((review) => (
                <li key={review._id} className="reviews__item">
                  <div className="reviews__avatar" aria-hidden>
                    {review.user?.photo ? (
                      <img src={review.user.photo} alt="" referrerPolicy="no-referrer" />
                    ) : (
                      <span>{(review.user?.name ?? "?").charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="reviews__body">
                    <div className="reviews__meta">
                      <strong>{review.user?.name ?? "Shopper"}</strong>
                      {review.verified && (
                        <span className="reviews__verified">
                          <FaCheckCircle /> Verified purchase
                        </span>
                      )}
                      <time dateTime={review.createdAt}>
                        {new Date(review.createdAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </time>
                    </div>
                    <StarRating value={review.rating} />
                    {review.title && <h3>{review.title}</h3>}
                    <p>{review.comment}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
};

export default ProductReviews;
