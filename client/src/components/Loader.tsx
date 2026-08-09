// src/Loader.jsx
import '../styles/loader.scss';

const Loader = () => {
  return (
    <div className="loader" role="status" aria-live="polite">
      <div className="spinner" />
      <span>Loading</span>
    </div>
  );
};

export default Loader;

interface SkeletonProps {
  width?: string;
  length?: number;
  height?: string;
  containerHeight?: string;
}

export const Skeleton = ({
  width = "unset",
  length = 3,
  height = "30px",
  containerHeight = "unset",
}: SkeletonProps) => {
  const skeletions = Array.from({ length }, (_, idx) => (
    <div key={idx} className="skeleton-shape" style={{ height }}></div>
  ));

  return (
    <div className="skeleton-loader" style={{ width, height: containerHeight }}>
      {skeletions}
    </div>
  );
};

// Card-shaped placeholders. A rail or grid of products loads into a specific
// silhouette; filling it with the bar Skeleton made the layout jump once the
// data arrived.
export const ProductSkeleton = ({
  length = 4,
  layout = "rail",
}: {
  length?: number;
  layout?: "rail" | "grid";
}) => (
  <div className={`skeleton-cards${layout === "grid" ? " skeleton-cards--grid" : ""}`}>
    {Array.from({ length }, (_, idx) => (
      <span key={idx} />
    ))}
  </div>
);
