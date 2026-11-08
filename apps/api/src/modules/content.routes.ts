import { Router } from "express";
import type { PrismaClient } from "../generated/prisma/client.js";

import { NovelRepository } from "./novels/novel.repository.js";
import { NovelService } from "./novels/novel.service.js";
import { createNovelRouter } from "./novels/novel.routes.js";

import { ChapterRepository } from "./chapters/chapter.repository.js";
import { ChapterService } from "./chapters/chapter.service.js";

import {
  createChapterCollectionRouter,
  createChapterRouter,
} from "./chapters/chapter.routes.js";

// Nối dependency một lần khi bootstrap, dùng chung Prisma pool từ B1.
export function createContentRouter(prisma: PrismaClient) {
  const router = Router();

  const novels = new NovelService(new NovelRepository(prisma));

  const chapters = new ChapterService(new ChapterRepository(prisma));

  router.use("/novels", createNovelRouter(novels));

  router.use(
    "/novels/:novelId/chapters",
    createChapterCollectionRouter(chapters),
  );

  router.use("/chapters", createChapterRouter(chapters));

  return router;
}
