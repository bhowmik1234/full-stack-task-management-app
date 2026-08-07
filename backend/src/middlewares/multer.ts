import multer, { FileFilterCallback } from "multer";
import { Request } from "express";
import { v4 as uuid } from "uuid";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const storage = multer.diskStorage({
  destination(req, file, callback) {
    callback(null, "uploads");
  },
  filename(req, file, callback) {
    const id = uuid();
    const extName = file.originalname.split(".").pop();
    callback(null, `${id}.${extName}`);
  },
});

const fileFilter = (req: Request, file: Express.Multer.File, callback: FileFilterCallback) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return callback(new Error("Only JPEG, PNG, and WEBP images are allowed"));
  }
  callback(null, true);
};

const multerOptions = {
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
};

export const singleUpload = multer(multerOptions).single("photo");
export const mutliUpload = multer(multerOptions).array("photos", 5);