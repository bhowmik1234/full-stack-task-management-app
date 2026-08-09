import { FaStar, FaStarHalfAlt, FaRegStar } from "react-icons/fa";

type Props = {
  value: number;
  /** Review count rendered after the stars, e.g. "(12)". Omit to hide. */
  count?: number;
  showValue?: boolean;
  size?: "sm" | "md" | "lg";
};

// One place that turns a 0-5 average into stars, so the card, the buy box and
// the review summary can never drift apart.
const StarRating = ({ value, count, showValue = false, size = "sm" }: Props) => (
  <span className={`star-rating star-rating--${size}`} aria-label={`${value} out of 5 stars`}>
    <span className="star-rating__stars" aria-hidden>
      {[1, 2, 3, 4, 5].map((star) => {
        if (value >= star) return <FaStar key={star} />;
        // A half star at .25-.75 reads truer than rounding 4.5 up to 5.
        if (value >= star - 0.75) return <FaStarHalfAlt key={star} />;
        return <FaRegStar key={star} className="star-rating__empty" />;
      })}
    </span>
    {showValue && <span className="star-rating__value">{value.toFixed(1)}</span>}
    {typeof count === "number" && (
      <span className="star-rating__count">
        ({count})
      </span>
    )}
  </span>
);

export default StarRating;
