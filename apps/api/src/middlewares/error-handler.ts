import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { MulterError } from "multer";

import { Prisma } from "../generated/prisma/client.js";
import { AppError } from "../lib/app-error.js";

// Chuẩn hóa lỗi; không trả stack trace, prompt hoặc thông tin DB nội bộ.
export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  next,
) => {
  if (res.destroyed) {
    return;
  }

  if (res.headersSent) {
    return next(error);
  }

  let problem: AppError;

  if (error instanceof AppError) {
    problem = error;
  } else if (error instanceof ZodError) {
    problem = new AppError(
      400,
      "VALIDATION_ERROR",
      "Dữ liệu gửi lên không hợp lệ.",

      error.issues.map(({ path, message }) => ({
        field: path.join("."),
        message,
      })),
    );
  } else if (error instanceof MulterError) {
    const tooLarge = error.code === "LIMIT_FILE_SIZE";

    problem = new AppError(
      tooLarge ? 413 : 400,
      error.code,

      tooLarge
        ? "File vượt giới hạn 2 MiB."
        : "Multipart không hợp lệ hoặc vượt giới hạn upload.",
    );
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped: Record<string, [number, string, string]> = {
      P2002: [409, "DUPLICATE_RESOURCE", "Số chương đã tồn tại trong truyện."],

      P2003: [
        409,
        "RELATION_CONFLICT",
        "Truyện hoặc chương liên quan không còn tồn tại.",
      ],

      P2025: [404, "RESOURCE_NOT_FOUND", "Bản ghi không tồn tại."],

      P2034: [
        409,
        "WRITE_CONFLICT",
        "Dữ liệu thay đổi đồng thời; thử lại sau khi tải lại.",
      ],
    };

    const [status, code, message] = mapped[error.code] ?? [
      500,
      "DATABASE_ERROR",
      "Không xử lý được dữ liệu.",
    ];

    problem = new AppError(status, code, message);
  } else if (isBodyError(error, "entity.parse.failed")) {
    problem = new AppError(400, "INVALID_JSON", "Body phải là JSON hợp lệ.");
  } else if (isBodyError(error, "entity.too.large")) {
    problem = new AppError(
      413,
      "BODY_TOO_LARGE",
      "Body vượt giới hạn dung lượng của endpoint.",
    );
  } else {
    problem = new AppError(500, "INTERNAL_ERROR", "Lỗi máy chủ.");

    console.error({
      requestId: res.locals.requestId,
      code: problem.code,
    });
  }

  res.status(problem.status).json({
    success: false,

    error: {
      code: problem.code,
      message: problem.message,
      details: problem.details,
    },

    requestId: res.locals.requestId,
  });
};

// Nhận diện lỗi body-parser bằng thuộc tính ổn định thay vì message.
function isBodyError(error: unknown, type: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === type
  );
}
