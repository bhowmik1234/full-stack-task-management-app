import { Link } from "react-router-dom";
import { FaTrash } from "react-icons/fa";
import { CartItem } from "../types/types";
import { formatINR } from "../utils/features";

type CartItemProps = {
    cartItem: CartItem,
    incrementHandler: (cartItem: CartItem) => void,
    decrementHandler: (cartItem: CartItem) => void,
    // The whole line, not an id — see the note on Cart's removeHandler.
    removeHandler: (cartItem: CartItem) => void
}

const CartItemCard = ({cartItem, incrementHandler, decrementHandler, removeHandler}: CartItemProps) => {
   const { productId, photo, name, price, quantity, stock, variantLabel } = cartItem;

  return (
    <div className="cart-item">
      <img src={`${import.meta.env.VITE_SERVER}/${photo}`} alt={name} loading="lazy" />
      <article>
        <Link to={`/product/${productId}`}>{name}</Link>
        {/* Without this, two sizes of the same shirt are two identical-looking
            rows and the only way to tell them apart is the price. */}
        {variantLabel && <span className="cart-item__variant">{variantLabel}</span>}
        <span className="unit-price">{formatINR(price)} each</span>
        <span className="line-total">{formatINR(price * quantity)}</span>
      </article>

      <div>
        {/* The handlers already refuse to go past these bounds; disabling the
            buttons says so instead of silently doing nothing. */}
        <button
          onClick={() => decrementHandler(cartItem)}
          disabled={quantity <= 1}
          aria-label={`Decrease quantity of ${name}`}
        >
          −
        </button>
        <p aria-label={`Quantity of ${name}`}>{quantity}</p>
        <button
          onClick={() => incrementHandler(cartItem)}
          disabled={quantity >= stock}
          aria-label={`Increase quantity of ${name}`}
        >
          +
        </button>
      </div>

      <button
        onClick={() => removeHandler(cartItem)}
        aria-label={`Remove ${name}${variantLabel ? ` (${variantLabel})` : ""} from cart`}
      >
        <FaTrash />
      </button>
    </div>
  )
}

export default CartItemCard
