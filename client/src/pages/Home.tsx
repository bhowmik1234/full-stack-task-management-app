import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { FaTruck, FaLock, FaUndoAlt, FaHeadset } from 'react-icons/fa';
import ProductCart from "../components/ProductCart";
import { useCategoriesQuery, useLatestProductsQuery } from "../redux/api/productAPI";
import toast from "react-hot-toast";
import { ProductSkeleton } from "../components/Loader";
import ErrorState from "../components/ErrorState";
import { CartItem, Product, StorefrontConfig } from "../types/types";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../redux/store";
import { formatINR } from "../utils/features";
import { addToCart } from "../redux/reducer/cartReducer";
import Slider from "../components/Slider";
import Seo from "../components/Seo";
import { storeName } from "../utils/store";

// Wordmarks only. The logo images these used to point at are hotlinked from
// third-party hosts and several of them 404, which rendered as broken images.
const brands: string[] = ["Nike", "Adidas", "Zara", "H&M", "Uniqlo", "Levi's"];

const images: string[] = [
  "https://images.pexels.com/photos/205421/pexels-photo-205421.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2",
  "https://images-eu.ssl-images-amazon.com/images/G/31/img24/Tablet/Samsung/July/Samsung-Galaxy-S6-Lite_1500-x-300.jpg",
  "https://images-eu.ssl-images-amazon.com/images/G/31/img24/Beauty/July/TBS/Updated/Lux-perfumes-for-men-PCgh._CB567481362_.jpg",
  "https://images-eu.ssl-images-amazon.com/images/G/31/img22/Wireless/Meghana/iQOO/Z9LiteBau/V2/D147682074_WLD_BAU_iQOO-Z9-Lite-5G_DesktopTall_Hero_3000x1200V2._CB569330392_.jpg",
];

// Decorative tiles: the name and blurb carry the meaning, the artwork is
// atmosphere. It used to be six hotlinked Google Images thumbnails
// (encrypted-tbn0.gstatic.com/images?q=tbn:...), which is both fragile and not
// ours to hotlink — those are other sites' images served from Google's cache,
// and the URLs are search-result handles that expire. They had already started
// 404ing one by one.
//
// A gradient needs no network, cannot rot, and cannot 404. `tone` indexes the
// palette in styles/home.scss so the colour lives with the rest of the theme
// rather than inline here.
const collections = [
  { name: "Summer Vibes", blurb: "Light layers for warm days", tone: 1 },
  { name: "Urban Chic", blurb: "City-ready essentials", tone: 2 },
  { name: "Cozy Autumn", blurb: "Soft knits and warm tones", tone: 3 },
  { name: "Winter Warmth", blurb: "Built for the cold", tone: 4 },
  { name: "Spring Bloom", blurb: "Fresh colours, new season", tone: 5 },
  { name: "Elegant Evening", blurb: "For the occasions that count", tone: 6 },
];

/**
 * The four promises under the hero.
 *
 * A function of the store's configuration rather than a module-level constant,
 * because two of them are numbers the store actually enforces — the free
 * delivery threshold and the return window. Hardcoded here they were a fourth
 * copy of figures that live in the cart, the product page and the server, and
 * the first one a shopper reads.
 */
const servicesFor = (config: StorefrontConfig) => [
  {
    icon: <FaTruck />,
    title: "Free delivery",
    copy: `On every order above ${formatINR(config.freeShippingThreshold)}`,
  },
  {
    icon: <FaUndoAlt />,
    title: "Easy returns",
    copy: `${config.returnWindowDays}-day returns on most items`,
  },
  { icon: <FaLock />, title: "Secure payments", copy: "Protected by Razorpay" },
  { icon: <FaHeadset />, title: "Here to help", copy: "Support seven days a week" },
];

// One rail owns one ref. The previous version shared a single ref across three
// rails, so the arrows on the lower two scrolled the top rail instead.
const ProductRail = ({
  products,
  isLoading,
  isError,
  onRetry,
  handler,
}: {
  products?: Product[];
  isLoading: boolean;
  isError?: boolean;
  onRetry?: () => void;
  handler: (cartItem: CartItem) => string | undefined;
}) => {
  const trackRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    const track = trackRef.current;
    if (!track) return;
    const amount = track.clientWidth * 0.85;
    track.scrollBy({ left: direction === "left" ? -amount : amount, behavior: "smooth" });
  };

  if (isLoading) return <ProductSkeleton length={5} />;
  // The home page's rails are the whole shop front. Returning null on a failed
  // load left the headings ("New arrivals", "Featured brands") sitting above
  // nothing, which reads as a store with no stock rather than a request that
  // failed — and the only hint otherwise was a toast that had already gone.
  if (isError)
    return (
      <ErrorState
        title="Couldn't load these products"
        message="The catalogue didn't load. Everything else on this page still works."
        onRetry={onRetry}
      />
    );
  if (!products?.length) return null;

  return (
    <div className="product-rail">
      <button
        className="product-rail__arrow product-rail__arrow--left"
        onClick={() => scroll("left")}
        aria-label="Scroll left"
      >
        &#10094;
      </button>
      <div className="product-rail__track" ref={trackRef}>
        {products.map((i) => (
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
            handler={handler}
            photo={i.photo}
          />
        ))}
      </div>
      <button
        className="product-rail__arrow product-rail__arrow--right"
        onClick={() => scroll("right")}
        aria-label="Scroll right"
      >
        &#10095;
      </button>
    </div>
  );
};

export const Home = () => {
  const dispatch = useDispatch();
  const config = useSelector((state: RootState) => state.cartReducer.config);
  const services = servicesFor(config);

  const addToCartHandler = (cartItem: CartItem) => {
    if (cartItem.stock < 1) {
      return toast.error("out of stock");
    }
    dispatch(addToCart(cartItem));
    toast.success("added to cart");
  }

  const { data, isLoading, isError, refetch } = useLatestProductsQuery("");
  const { data: categoryData } = useCategoriesQuery("");

  // Was a bare `if (isError) toast.error(...)` here in the render body — a side
  // effect during render, so it re-fired on every re-render of the page. The
  // rails say it themselves now, in place and with a retry, so there is nothing
  // left for a toast to add.

  const latest = data?.products;
  // Same catalogue, other end first — the page used to render the identical
  // list three times under three different headings.
  const trending = latest ? [...latest].reverse() : undefined;

  return (
    <div className="home page">
      {/* The one page whose title was already right, but it had no og:* tags —
          so every link to the shop front previewed as a bare URL. */}
      <Seo
        title={`${storeName()} — Online Shopping`}
        description={`Shop fashion, tech and beauty at ${storeName()}. Fast delivery, secure checkout and easy returns.`}
      />

      <section className="home__hero">
        <Slider images={images} />
        <div className="home__hero-copy">
          <div>
            <h1>Everything you need, delivered fast</h1>
            <p>New arrivals every week across fashion, tech and beauty.</p>
          </div>
          <Link className="btn" to="/search">Shop now</Link>
        </div>
      </section>

      <section className="home__services">
        {services.map((service) => (
          <div key={service.title}>
            {service.icon}
            <div>
              <strong>{service.title}</strong>
              <span>{service.copy}</span>
            </div>
          </div>
        ))}
      </section>

      {!!categoryData?.categories.length && (
        <section>
          <div className="section-head">
            <div>
              <h2>Shop by category</h2>
              <p>Browse the full catalogue</p>
            </div>
            <Link to="/search">View all</Link>
          </div>
          <div className="home__categories">
            {categoryData.categories.map((category) => (
              <Link key={category} to={`/search?category=${encodeURIComponent(category)}`}>
                {category}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="section-head">
          <div>
            <h2>New arrivals</h2>
            <p>The latest additions to the store</p>
          </div>
          <Link to="/search">View all</Link>
        </div>
        <ProductRail products={latest} isLoading={isLoading} isError={isError} onRetry={refetch} handler={addToCartHandler} />
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>Featured brands</h2>
          </div>
        </div>
        <div className="brands">
          {brands.map((brand) => (
            <div key={brand} className="brand">
              <span className="name">{brand}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>Trending now</h2>
            <p>What other shoppers are looking at</p>
          </div>
          <Link to="/search">View all</Link>
        </div>
        <ProductRail products={trending} isLoading={isLoading} isError={isError} onRetry={refetch} handler={addToCartHandler} />
      </section>

      <section>
        <div className="section-head">
          <div>
            <h2>Shop the collections</h2>
          </div>
        </div>
        <div className="collection">
          {collections.map((item) => (
            <Link
              key={item.name}
              className={`collection-item collection-item--${item.tone}`}
              to={`/search?q=${encodeURIComponent(item.name)}`}
            >
              <div className="item-name">
                {item.name}
                <span>{item.blurb}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

export default Home;
