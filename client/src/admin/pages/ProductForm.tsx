import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { FiArrowLeft, FiTrash2 } from "react-icons/fi";
import {
  useCreateProductMutation,
  useDeleteProductMutation,
  useProductQuery,
  useUpdateProductMutation,
} from "../api";
import { uploadUrl } from "../config";
import { reportToast } from "../mutation";
import { ProductOption, ProductSpec } from "../../types/types";
import SpecEditor, { emptySpec } from "../components/SpecEditor";
import VariantEditor, { DraftVariant, draftsFrom } from "../components/VariantEditor";
import Spinner from "../components/Spinner";
import { Card, EmptyState, PageHeader } from "../components/ui";

/** Reads a File into a data URL for the preview. */
const readPreview = (file: File) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });

type Fields = {
  name: string;
  category: string;
  brand: string;
  price: number;
  stock: number;
  description: string;
  highlights: string;
  inTheBox: string;
  warranty: string;
};

const BLANK: Fields = {
  name: "",
  category: "",
  brand: "",
  price: 0,
  stock: 1,
  description: "",
  highlights: "",
  inTheBox: "",
  warranty: "",
};

/**
 * Create and edit in one page.
 *
 * They were two near-identical files that had already drifted — the edit form
 * grew fields the create form never got. The only real differences are which
 * mutation runs and whether there is anything to delete, so they are branches
 * rather than files.
 */
const ProductForm = () => {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const { data, isLoading, isError } = useProductQuery(id!, { skip: !isEdit });
  const [createProduct, { isLoading: creating }] = useCreateProductMutation();
  const [updateProduct, { isLoading: updating }] = useUpdateProductMutation();
  const [deleteProduct, { isLoading: deleting }] = useDeleteProductMutation();

  const [fields, setFields] = useState<Fields>(BLANK);
  const [specs, setSpecs] = useState<ProductSpec[]>([emptySpec()]);
  // Options and their combinations. Empty means "this product has no
  // variants", which is the state almost every product is in.
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [variants, setVariants] = useState<DraftVariant[]>([]);
  const [photo, setPhoto] = useState<File>();
  const [photoPreview, setPhotoPreview] = useState("");
  const [gallery, setGallery] = useState<File[]>([]);
  const [galleryPreview, setGalleryPreview] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const product = data?.product;

  useEffect(() => {
    if (!product) return;
    setFields({
      name: product.name,
      category: product.category,
      brand: product.brand ?? "",
      price: product.price,
      stock: product.stock,
      description: product.description ?? "",
      // The API sends these as arrays; the textareas edit them as lines.
      highlights: (product.highlights ?? []).join("\n"),
      inTheBox: (product.inTheBox ?? []).join("\n"),
      warranty: product.warranty ?? "",
    });
    setSpecs(product.specs?.length ? product.specs : [emptySpec()]);
    setOptions(product.options ?? []);
    setVariants(draftsFrom(product.variants));
  }, [product]);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(await readPreview(file));
  };

  const onGallery = async (e: ChangeEvent<HTMLInputElement>) => {
    // The backend accepts four extra images; trim here so the request isn't
    // rejected after the upload has already been sent.
    const files = Array.from(e.target.files ?? []).slice(0, 4);
    setGallery(files);
    setGalleryPreview(await Promise.all(files.map(readPreview)));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (!fields.name.trim()) return toast.error("A product needs a name.");
    if (!fields.category.trim()) return toast.error("A product needs a category.");
    if (fields.price <= 0) return toast.error("Price must be more than zero.");
    if (fields.stock < 0) return toast.error("Stock cannot be negative.");
    if (!isEdit && !photo) return toast.error("A product needs a photo.");

    // Caught here rather than left to the server, which answers with a message
    // about option values several steps from what the operator actually did:
    // they named an axis and never pressed Generate.
    const usableOptions = options.filter((o) => o.name.trim() && o.values.length > 0);
    if (usableOptions.length > 0 && variants.length === 0)
      return toast.error(
        "Generate the combinations before saving, or remove the options."
      );
    if (variants.some((v) => v.price === "" || Number(v.price) <= 0))
      return toast.error("Every combination needs a price above zero.");

    const body = new FormData();
    body.set("name", fields.name);
    body.set("category", fields.category);
    body.set("brand", fields.brand);
    body.set("price", String(fields.price));
    body.set("stock", String(fields.stock));
    // Always sent, so clearing a box actually clears the stored value.
    body.set("description", fields.description);
    body.set("highlights", fields.highlights);
    body.set("inTheBox", fields.inTheBox);
    body.set("warranty", fields.warranty);
    // Multipart bodies are flat, so the spec rows travel as JSON.
    body.set("specs", JSON.stringify(specs));

    // Options and variants are always sent, including as empty arrays — that is
    // how a product stops having variants. Omitting them would mean "leave the
    // variants alone", so there would be no way to remove them once added.
    body.set(
      "options",
      JSON.stringify(
        options
          .filter((o) => o.name.trim() && o.values.length > 0)
          .map((o) => ({ name: o.name.trim(), values: o.values }))
      )
    );
    body.set(
      "variants",
      JSON.stringify(
        variants.map((v) => ({
          sku: v.sku.trim() || undefined,
          optionValues: v.optionValues,
          price: Number(v.price),
          stock: Number(v.stock),
        }))
      )
    );
    if (photo) body.set("photo", photo);
    // Repeated field name, which is what multer's .fields() expects.
    gallery.forEach((file) => body.append("photos", file));

    const ok = isEdit
      ? reportToast(await updateProduct({ productId: id!, body }), "Product updated")
      : reportToast(await createProduct(body), "Product created");

    if (ok) navigate("/products");
  };

  const remove = async () => {
    const ok = reportToast(
      await deleteProduct(id!),
      "Product deleted"
    );
    if (ok) navigate("/products");
  };

  if (isEdit && isLoading) return <Spinner full />;

  if (isEdit && (isError || !product))
    return (
      <div className="l-page">
        <PageHeader title="Product" />
        <EmptyState>That product could not be loaded.</EmptyState>
      </div>
    );

  // Uploading a gallery replaces the whole set, so the existing images are
  // shown until new ones are chosen — and then the new ones, to make the
  // replacement obvious before it happens.
  const existingGallery = product?.images?.slice(1) ?? [];
  const shownGallery =
    galleryPreview.length > 0 ? galleryPreview : existingGallery.map(uploadUrl);

  return (
    <div className="l-page">
      <PageHeader
        title={isEdit ? fields.name || "Product" : "New product"}
        subtitle={
          <Link to="/products" className="c-link">
            <FiArrowLeft aria-hidden="true" /> All products
          </Link>
        }
        actions={
          isEdit &&
          (confirmDelete ? (
            <div className="c-confirm">
              <span>Delete this product?</span>
              <button type="button" className="c-btn c-btn--ghost" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
              <button type="button" className="c-btn c-btn--danger" disabled={deleting} onClick={remove}>
                Delete
              </button>
            </div>
          ) : (
            <button type="button" className="c-btn c-btn--ghost" onClick={() => setConfirmDelete(true)}>
              <FiTrash2 aria-hidden="true" /> Delete
            </button>
          ))
        }
      />

      <form onSubmit={submit} className="l-split l-split--wide">
        <div className="l-stack">
          <Card title="Details">
            <div className="c-form">
              <div className="c-field">
                <label htmlFor="p-name">Name</label>
                <input
                  id="p-name"
                  type="text"
                  value={fields.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </div>

              <div className="c-field-row">
                <div className="c-field">
                  <label htmlFor="p-category">Category</label>
                  <input
                    id="p-category"
                    type="text"
                    placeholder="laptop, camera…"
                    value={fields.category}
                    onChange={(e) => set("category", e.target.value)}
                  />
                  <small>Stored lowercase; category links match on that.</small>
                </div>
                <div className="c-field">
                  <label htmlFor="p-brand">Brand</label>
                  <input
                    id="p-brand"
                    type="text"
                    value={fields.brand}
                    onChange={(e) => set("brand", e.target.value)}
                  />
                </div>
              </div>

              <div className="c-field-row">
                <div className="c-field">
                  <label htmlFor="p-price">Price (₹)</label>
                  <input
                    id="p-price"
                    type="number"
                    min={1}
                    value={fields.price}
                    onChange={(e) => set("price", Number(e.target.value))}
                  />
                </div>
                <div className="c-field">
                  <label htmlFor="p-stock">Stock</label>
                  <input
                    id="p-stock"
                    type="number"
                    min={0}
                    value={fields.stock}
                    onChange={(e) => set("stock", Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="c-field">
                <label htmlFor="p-description">Description</label>
                <textarea
                  id="p-description"
                  rows={5}
                  value={fields.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </div>
            </div>
          </Card>

          <Card title="Copy" hint="One item per line">
            <div className="c-form">
              <div className="c-field">
                <label htmlFor="p-highlights">Highlights</label>
                <textarea
                  id="p-highlights"
                  rows={4}
                  placeholder={"14-inch 2.8K display\n16GB memory, 512GB storage"}
                  value={fields.highlights}
                  onChange={(e) => set("highlights", e.target.value)}
                />
              </div>
              <div className="c-field">
                <label htmlFor="p-box">In the box</label>
                <textarea
                  id="p-box"
                  rows={3}
                  placeholder={"Laptop\n65W charger"}
                  value={fields.inTheBox}
                  onChange={(e) => set("inTheBox", e.target.value)}
                />
              </div>
              <div className="c-field">
                <label htmlFor="p-warranty">Warranty</label>
                <textarea
                  id="p-warranty"
                  rows={2}
                  value={fields.warranty}
                  onChange={(e) => set("warranty", e.target.value)}
                />
              </div>
            </div>
          </Card>

          <Card title="Specifications" hint="Submitting replaces the whole set">
            <SpecEditor specs={specs} onChange={setSpecs} />
          </Card>

          <Card title="Options and variants">
            <VariantEditor
              options={options}
              variants={variants}
              onOptionsChange={setOptions}
              onVariantsChange={setVariants}
              basePrice={fields.price}
            />
          </Card>
        </div>

        <div className="l-stack">
          <Card title="Images">
            <div className="c-form">
              <div className="c-field">
                <label htmlFor="p-photo">Main photo</label>
                <input id="p-photo" type="file" accept="image/*" onChange={onPhoto} />
              </div>

              {(photoPreview || product?.photo) && (
                <img
                  className="c-preview"
                  src={photoPreview || uploadUrl(product!.photo)}
                  alt="Main product photo"
                />
              )}

              <div className="c-field">
                <label htmlFor="p-gallery">Gallery (up to 4)</label>
                <input
                  id="p-gallery"
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={onGallery}
                />
                <small>
                  {isEdit
                    ? "Uploading replaces the current gallery and deletes the old files."
                    : "Extra angles shown on the product page."}
                </small>
              </div>

              {shownGallery.length > 0 && (
                <div className="c-gallery">
                  {shownGallery.map((src, index) => (
                    <img key={src + index} src={src} alt={`Gallery ${index + 1}`} />
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <button
              type="submit"
              className="c-btn c-btn--primary c-btn--block"
              disabled={creating || updating}
            >
              {isEdit ? "Save changes" : "Create product"}
            </button>
            {isEdit && product && (
              <p className="c-note">
                Product id <code>{product._id}</code>
              </p>
            )}
          </Card>
        </div>
      </form>
    </div>
  );
};

export default ProductForm;
