import { Link, useNavigate } from "react-router-dom";
import { FiPlus } from "react-icons/fi";
import { useProductsQuery } from "../api";
import { useCan } from "../store";
import { uploadUrl } from "../config";
import { Product } from "../../types/types";
import DataTable, { Column } from "../components/DataTable";
import { SkeletonRows } from "../components/Spinner";
import { Card, EmptyState, Money, PageHeader } from "../components/ui";

const stockPill = (stock: number) => {
  if (stock === 0) return <span className="c-pill c-pill--critical">Out of stock</span>;
  if (stock <= 5) return <span className="c-pill c-pill--warning">{stock} left</span>;
  return <span className="c-pill c-pill--muted">{stock}</span>;
};

const Products = () => {
  const canWrite = useCan()("products_write");
  const navigate = useNavigate();
  const { data, isLoading, isError } = useProductsQuery();

  const columns: Column<Product>[] = [
    {
      key: "photo",
      header: "",
      width: "3.5rem",
      render: (product) => (
        <img className="c-thumb" src={uploadUrl(product.photo)} alt="" loading="lazy" />
      ),
    },
    {
      key: "name",
      header: "Product",
      value: (product) => product.name,
      // The product page is the editor, so it is a link only for someone who
      // may edit. A read-only operator gets the name as text rather than a
      // link into a form that would refuse to save.
      render: (product) =>
        canWrite ? (
          <Link to={`/products/${product._id}`} className="c-link">
            {product.name}
          </Link>
        ) : (
          product.name
        ),
    },
    { key: "category", header: "Category", value: (product) => product.category },
    {
      key: "price",
      header: "Price",
      align: "right",
      value: (product) => product.price,
      render: (product) => <Money value={product.price} />,
    },
    {
      key: "stock",
      header: "Stock",
      align: "right",
      value: (product) => product.stock,
      render: (product) => stockPill(product.stock),
    },
  ];

  return (
    <div className="l-page">
      <PageHeader
        title="Products"
        subtitle={data ? `${data.products.length} in the catalogue` : undefined}
        actions={
          canWrite && (
            <Link to="/products/new" className="c-btn c-btn--primary">
              <FiPlus aria-hidden="true" /> New product
            </Link>
          )
        }
      />

      <Card>
        {isLoading ? (
          <SkeletonRows rows={8} />
        ) : isError || !data ? (
          <EmptyState>Could not load the catalogue.</EmptyState>
        ) : (
          <DataTable
            columns={columns}
            rows={data.products}
            rowKey={(product) => product._id}
            search="Search by name or category"
            empty="No products yet. Create the first one."
            onRowClick={(product) => navigate(`/products/${product._id}`)}
          />
        )}
      </Card>
    </div>
  );
};

export default Products;
