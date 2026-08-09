import { useEffect, useState } from "react";
import ProductImage from "./ProductImage";

type Props = {
  images: string[];
  name: string;
  outOfStock?: boolean;
};

// Hero image plus a thumbnail strip. A product with a single photo renders
// just the hero, so the strip never appears as a lone orphan thumbnail.
const ProductGallery = ({ images, name, outOfStock }: Props) => {
  const [active, setActive] = useState(0);

  // Navigating between products reuses this component; without the reset the
  // new product opens on the previous one's third thumbnail.
  useEffect(() => setActive(0), [images.join("|")]);

  const gallery = images.length > 0 ? images : [""];
  const current = gallery[Math.min(active, gallery.length - 1)];

  return (
    <div className="product-gallery">
      <div className="product-gallery__frame">
        {outOfStock && (
          <span className="badge badge--danger product-gallery__flag">Out of stock</span>
        )}
        {/* The product page's LCP element. Lazy-loading it deferred exactly the
            image the page is about. */}
        <ProductImage
          photo={current}
          name={name}
          className="product-gallery__image"
          priority
        />
      </div>

      {gallery.length > 1 && (
        <div className="product-gallery__thumbs" role="tablist" aria-label={`${name} images`}>
          {gallery.map((image, index) => (
            <button
              key={`${image}-${index}`}
              type="button"
              role="tab"
              aria-selected={index === active}
              aria-label={`Image ${index + 1} of ${gallery.length}`}
              className={`product-gallery__thumb${
                index === active ? " product-gallery__thumb--active" : ""
              }`}
              onClick={() => setActive(index)}
              // Hovering to preview matches how most storefronts behave, while
              // the click still commits the choice for touch users.
              onMouseEnter={() => setActive(index)}
            >
              <ProductImage photo={image} name={`${name} thumbnail ${index + 1}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProductGallery;
