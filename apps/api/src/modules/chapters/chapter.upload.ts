import { extname } from "node:path";
import { TextDecoder } from "node:util";
import multer from "multer";
import type { RequestHandler } from "express";
import { AppError } from "../../lib/app-error.js";

const parseUpload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 2,
    fields: 2,
    parts: 4,
    fieldSize: 2048,
  },

  fileFilter: (_req, file, callback) => {
    const extension = extname(file.originalname).toLowerCase();

    if (![".txt", ".md"].includes(extension)) {
      return callback(
        new AppError(
          415,
          "UNSUPPORTED_FILE",
          "Chỉ nhận file .txt hoặc .md mã hóa UTF-8.",
        ),
      );
    }

    callback(null, true);
  },
}).fields([
  {
    name: "sourceFile",
    maxCount: 1,
  },
  {
    name: "chineseFile",
    maxCount: 1,
  },
]);

// Chỉ bật multipart tại endpoint import.
export const uploadChapter: RequestHandler = (req, res, next) => {
  if (!req.is("multipart/form-data")) {
    return next(
      new AppError(
        415,
        "MULTIPART_REQUIRED",
        "Endpoint import yêu cầu multipart/form-data.",
      ),
    );
  }

  parseUpload(req, res, next);
};

// Reject UTF-8 lỗi thay vì âm thầm thay ký tự; giữ BOM nếu file có BOM.
export function decodeText(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(buffer);
  } catch {
    throw new AppError(
      422,
      "INVALID_UTF8",
      "File phải được lưu bằng UTF-8 hợp lệ.",
    );
  }
}
