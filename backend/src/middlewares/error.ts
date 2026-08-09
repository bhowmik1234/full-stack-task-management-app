import { NextFunction, Request, Response } from "express";
import multer from "multer";
import ErrorHandler from "../utils/utiliy-class.js";
import { ControllerTypes } from "../types/types.js";

export const errorMiddleware = (
  err: Error & { statusCode?: number; code?: string },
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Only messages we wrote ourselves are safe to echo back. Anything else
  // (Prisma errors, TypeErrors) can carry table names, SQL fragments or file
  // paths, so those become a generic 500 and are logged server-side instead.
  if (err instanceof ErrorHandler) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  }

  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Image must be 5MB or smaller"
        : "Invalid file upload";
    return res.status(400).json({ success: false, message });
  }

  // fileFilter rejections arrive as plain Errors with our own message
  if (/images are allowed|Unsupported image type/.test(err.message || "")) {
    return res.status(400).json({ success: false, message: err.message });
  }

  console.error("[unhandled]", err);

  return res.status(500).json({
    success: false,
    message: "Internal server error",
  });
};

// create shortcut try catch block
export const TryCatch = (func: ControllerTypes) => (req:Request, res:Response, next:NextFunction) => {
    return Promise.resolve(func(req, res, next)).catch(next);
};
