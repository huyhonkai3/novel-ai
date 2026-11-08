import { randomUUID } from "node:crypto";

import cors from "cors";
import express, { type Router } from "express";

import { AppError } from "./lib/app-error.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { createLlmRouter } from "./modules/llm/llm.routes.js";
import type { LlmService } from "./modules/llm/llm.service.js";

interface AppDependencies {
  llm: LlmService;
  checkDatabase: () => Promise<void>;
  webOrigin: string;

  // Cho phép test B1 độc lập mà không khởi tạo repository nội dung.
  contentRouter?: Router;
}

// Inject dependency để test HTTP mà không cần DB hoặc model thật.
export function createApp({
  llm,
  checkDatabase,
  webOrigin,
  contentRouter,
}: AppDependencies) {
  const app = express();

  app.disable("x-powered-by");

  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();

    res.setHeader("X-Request-Id", res.locals.requestId as string);

    next();
  });

  app.use(cors({ origin: webOrigin }));

  // Phải đặt parser chương trước parser mặc định để nhận văn bản lớn.
  app.use("/api/novels/:novelId/chapters", express.json({ limit: "8mb" }));

  app.use("/api/chapters/:chapterId", express.json({ limit: "8mb" }));

  app.use(express.json({ limit: "128kb" }));

  // Health phản ánh DB readiness; không chạy inference để giám sát API.
  app.get("/api/health", async (_req, res) => {
    try {
      await checkDatabase();
    } catch {
      throw new AppError(
        503,
        "DATABASE_UNAVAILABLE",
        "Không kết nối được PostgreSQL.",
      );
    }

    res.json({
      success: true,
      data: {
        status: "ok",
        database: "up",
      },
    });
  });

  app.use("/api/llm", createLlmRouter(llm));

  if (contentRouter) {
    app.use("/api", contentRouter);
  }

  app.use((_req, _res, next) => {
    next(new AppError(404, "ROUTE_NOT_FOUND", "API không tồn tại."));
  });

  app.use(errorHandler);

  return app;
}
