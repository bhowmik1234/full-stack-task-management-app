import { useEffect, useState } from "react";
import { FaImage } from "react-icons/fa";

type Props = {
  photo?: string;
  name: string;
  className?: string;
  /**
   * True for the one image that is the page's largest contentful paint — the
   * hero on a product page, the first card above the fold.
   *
   * `loading="lazy"` on an LCP element is actively harmful: it defers the
   * fetch until layout has run, which is precisely the image whose arrival the
   * score measures. This flips it to an eager, high-priority fetch instead.
   */
  priority?: boolean;
};

// Product photos are files on the backend's disk, and rows whose upload has
// gone missing rendered as a browser broken-image icon inside an empty box —
// most visible on the detail page, where that box is the size of the screen.
const ProductImage = ({ photo, name, className = "", priority = false }: Props) => {
  const [failed, setFailed] = useState(false);

  // A card recycled for a different product must retry rather than stay stuck
  // on the previous product's failure.
  useEffect(() => setFailed(false), [photo]);

  if (!photo || failed) {
    return (
      <div className={`image-fallback ${className}`.trim()} role="img" aria-label={name}>
        <FaImage aria-hidden />
        <span>{name}</span>
      </div>
    );
  }

  return (
    <img
      src={`${import.meta.env.VITE_SERVER}/${photo}`}
      alt={name}
      className={className || undefined}
      loading={priority ? "eager" : "lazy"}
      // `fetchpriority` is what actually moves an image up the network queue;
      // `loading="eager"` only stops it being deferred.
      fetchPriority={priority ? "high" : undefined}
      // Off the main thread, so a grid of images cannot block interaction while
      // they decode. `sync` on the hero keeps it from flashing in after paint.
      decoding={priority ? "sync" : "async"}
      onError={() => setFailed(true)}
    />
  );
};

export default ProductImage;
