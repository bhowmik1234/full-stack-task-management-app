import { open, rm } from "fs/promises";
import validator from "validator";
import ErrorHandler from "./utiliy-class.js";

/**
 * Input bounds. The columns are unbounded TEXT, so without these a single
 * request can write megabytes into a product name or shipping address.
 */
export const LIMITS = {
  name: 120,
  email: 254,
  phone: 20,
  category: 60,
  address: 200,
  city: 80,
  state: 80,
  country: 80,
  pinCode: 12,
  couponCode: 40,
  // Razorpay ids are "order_"/"pay_" + 14 chars; the cap is generous headroom
  paymentRef: 64,
  // hex sha256
  signature: 128,
  url: 2048,
  userId: 128,
  description: 5000,
  reviewTitle: 120,
  reviewComment: 2000,
  brand: 80,
  bulletList: 2000,
  specGroup: 60,
  specLabel: 80,
  specValue: 300,
  addressLabel: 40,
} as const;

/** No product needs more specification rows than this. */
export const MAX_SPECS = 60;

/**
 * An address book, not a mailing list. The cap is what stops a script from
 * filling the table through an endpoint that is otherwise happy to be called
 * repeatedly, and it is enforced on create rather than by a rate limit because
 * the limit that matters is total rows, not rows per minute.
 */
export const MAX_ADDRESSES = 20;

export type SpecInput = { group: string; label: string; value: string };

/**
 * Parses the `specs` field of a product form, which arrives as a JSON string
 * because the request is multipart (the same body carries image uploads).
 *
 * Rows with a blank label or value are dropped rather than rejected: the admin
 * form always submits a trailing empty row for the user to type into.
 */
export const parseSpecs = (value: unknown): SpecInput[] | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string")
    throw new ErrorHandler("specs must be a JSON string", 400);

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ErrorHandler("specs must be valid JSON", 400);
  }

  if (!Array.isArray(parsed))
    throw new ErrorHandler("specs must be an array", 400);
  if (parsed.length > MAX_SPECS)
    throw new ErrorHandler(`specs must be at most ${MAX_SPECS} rows`, 400);

  return parsed.flatMap((row: any) => {
    const label = typeof row?.label === "string" ? row.label.trim() : "";
    const val = typeof row?.value === "string" ? row.value.trim() : "";
    if (!label || !val) return [];

    return [
      {
        group:
          optionalString(row.group, "spec group", LIMITS.specGroup) ?? "General",
        label: requireString(label, "spec label", LIMITS.specLabel),
        value: requireString(val, "spec value", LIMITS.specValue),
      },
    ];
  });
};

/**
 * Trims and length-checks a string field. Throws ErrorHandler(400) rather than
 * returning, so callers stay inside the TryCatch wrapper.
 */
export const requireString = (
  value: unknown,
  field: string,
  max: number,
  { min = 1 }: { min?: number } = {}
): string => {
  if (typeof value !== "string")
    throw new ErrorHandler(`${field} must be a string`, 400);

  const trimmed = value.trim();
  if (trimmed.length < min)
    throw new ErrorHandler(`${field} is required`, 400);
  if (trimmed.length > max)
    throw new ErrorHandler(`${field} must be at most ${max} characters`, 400);

  return trimmed;
};

export const optionalString = (
  value: unknown,
  field: string,
  max: number
): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  return requireString(value, field, max);
};

/** A finite, non-negative number within `max`. Rejects NaN/Infinity strings. */
export const requireAmount = (
  value: unknown,
  field: string,
  max = 1_000_000_00
): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new ErrorHandler(`${field} must be a number`, 400);
  if (n < 0) throw new ErrorHandler(`${field} must not be negative`, 400);
  if (n > max) throw new ErrorHandler(`${field} is too large`, 400);
  return n;
};

export const requireInteger = (value: unknown, field: string, max = 1_000_000): number => {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new ErrorHandler(`${field} must be a whole number`, 400);
  if (n < 0) throw new ErrorHandler(`${field} must not be negative`, 400);
  if (n > max) throw new ErrorHandler(`${field} is too large`, 400);
  return n;
};

export const requireEmail = (value: unknown): string => {
  const email = requireString(value, "email", LIMITS.email);
  if (!validator.isEmail(email)) throw new ErrorHandler("Invalid email address", 400);
  return validator.normalizeEmail(email) || email;
};

/**
 * Phone numbers are stored exactly as Firebase reports them on the credential:
 * E.164, a leading `+` and up to 15 digits. Normalising to one canonical form
 * is what makes the unique index meaningful — "+919876543210" and
 * "09876543210" must not be able to become two accounts.
 */
export const requirePhone = (value: unknown): string => {
  const phone = requireString(value, "phone", LIMITS.phone).replace(/[\s-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    throw new ErrorHandler("Phone must be in international format, e.g. +919876543210", 400);
  return phone;
};

/**
 * Profile photos come from the Firebase provider as a URL string and are
 * rendered in an <img src>. Reject anything that is not http(s) so a
 * `javascript:` or `data:` URL can never reach the DOM.
 */
export const requireHttpUrl = (value: unknown, field: string): string => {
  const url = requireString(value, field, LIMITS.url);
  if (!validator.isURL(url, { protocols: ["http", "https"], require_protocol: true }))
    throw new ErrorHandler(`${field} must be a valid http(s) URL`, 400);
  return url;
};

export const requireDate = (value: unknown, field: string): Date => {
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime()))
    throw new ErrorHandler(`${field} must be a valid date`, 400);
  return date;
};

// Leading bytes for the formats multer accepts. WEBP is "RIFF....WEBP".
const MAGIC: { ext: string; test: (b: Buffer) => boolean }[] = [
  { ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    ext: "png",
    test: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: "webp",
    test: (b) =>
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

/**
 * Confirms an uploaded file really is one of the accepted image formats by
 * reading its magic bytes, and deletes it if not.
 *
 * multer's fileFilter can only see the client-declared Content-Type, which is
 * trivially forged. Files land in uploads/ and are served back over HTTP, so
 * an HTML or SVG payload with `Content-Type: image/png` would otherwise become
 * stored XSS on the API origin.
 */
export const assertRealImage = async (filePath: string) => {
  let header: Buffer;
  try {
    const handle = await open(filePath, "r");
    try {
      header = Buffer.alloc(12);
      const { bytesRead } = await handle.read(header, 0, 12, 0);
      header = header.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  } catch {
    throw new ErrorHandler("Could not read the uploaded file", 400);
  }

  if (!MAGIC.some((m) => m.test(header))) {
    await rm(filePath, { force: true });
    throw new ErrorHandler("Uploaded file is not a valid JPEG, PNG or WEBP image", 400);
  }
};
