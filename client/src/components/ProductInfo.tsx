import { FaBoxOpen, FaShieldAlt } from "react-icons/fa";
import { Product } from "../types/types";

// The "Specifications" block a real storefront carries: admin-entered rows
// grouped into sections, plus the facts the system already knows (category,
// stock, item code, listed date) folded in as a General group so there is no
// separate orphan strip.
const ProductInfo = ({ product }: { product: Product }) => {
  const derived: { label: string; value: string }[] = [
    { label: "Category", value: product.category },
    ...(product.brand ? [{ label: "Brand", value: product.brand }] : []),
    {
      label: "Availability",
      value: product.stock > 0 ? `${product.stock} in stock` : "Out of stock",
    },
    { label: "Item code", value: product._id.slice(-8).toUpperCase() },
    ...(product.createdAt
      ? [
          {
            label: "Listed",
            value: new Date(product.createdAt).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            }),
          },
        ]
      : []),
  ];

  // Preserve the order the admin entered rather than sorting alphabetically:
  // "General" first, then whatever groups follow, in their saved order.
  const groups = new Map<string, { label: string; value: string }[]>();
  groups.set("General", derived);

  for (const spec of product.specs ?? []) {
    const key = spec.group || "General";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ label: spec.label, value: spec.value });
  }

  return (
    <section className="product-info">
      <h2>Product information</h2>

      <div className="product-info__groups">
        {[...groups.entries()].map(([group, rows]) => (
          <div key={group} className="product-info__group">
            <h3>{group}</h3>
            <table>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.label}-${index}`}>
                    <th scope="row">{row.label}</th>
                    <td>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {(product.inTheBox?.length || product.warranty) && (
        <div className="product-info__extras">
          {!!product.inTheBox?.length && (
            <div className="product-info__extra">
              <h3>
                <FaBoxOpen /> In the box
              </h3>
              <ul>
                {product.inTheBox.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {product.warranty && (
            <div className="product-info__extra">
              <h3>
                <FaShieldAlt /> Warranty
              </h3>
              <p>{product.warranty}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default ProductInfo;
