import multer, { FileFilterCallback } from "multer";
import { Request } from "express";
import { v4 as uuid } from "uuid";

// The extension is derived from this map, never from the uploaded filename.
// `originalname` is attacker-controlled, so trusting it lets someone store
// `<uuid>.html` in uploads/ — which express.static then serves from the same
// origin as the SPA, i.e. stored XSS.
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const storage = multer.diskStorage({
  destination(req, file, callback) {
    callback(null, "uploads");
  },
  filename(req, file, callback) {
    const extName = MIME_EXTENSIONS[file.mimetype];
    if (!extName) return callback(new Error("Unsupported image type"), "");
    callback(null, `${uuid()}.${extName}`);
  },
});

const fileFilter = (req: Request, file: Express.Multer.File, callback: FileFilterCallback) => {
  // The declared mimetype is only a first pass — assertRealImage() checks the
  // file's actual magic bytes once it has been written.
  if (!MIME_EXTENSIONS[file.mimetype]) {
    return callback(new Error("Only JPEG, PNG, and WEBP images are allowed"));
  }
  callback(null, true);
};

const multerOptions = {
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 5, fields: 20 },
};

export const singleUpload = multer(multerOptions).single("photo");
export const mutliUpload = multer(multerOptions).array("photos", 5);

// Product create/edit takes the hero image and up to four gallery shots in one
// request. `limits.files` above is 5, which is exactly this budget.
export const productUpload = multer(multerOptions).fields([
  { name: "photo", maxCount: 1 },
  { name: "photos", maxCount: 4 },
]);

/** Flattens req.files from the .fields() shape into one list, for cleanup. */
export const allUploadedFiles = (
  files: Record<string, Express.Multer.File[]> | Express.Multer.File[] | undefined
): Express.Multer.File[] => {
  if (!files) return [];
  if (Array.isArray(files)) return files;
  return Object.values(files).flat();
};
