import { Router } from "express";
import { AppError } from "../../lib/app-error.js";

import { idSchema, pageSchema } from "../../lib/content.schema.js";

import {
  createChapterSchema,
  importChapterSchema,
  updateChapterSchema,
} from "./chapter.schema.js";

import { decodeText, uploadChapter } from "./chapter.upload.js";

import type { ChapterService } from "./chapter.service.js";

// Collection nằm dưới truyện; mergeParams giữ novelId từ router cha.
export function createChapterCollectionRouter(service: ChapterService) {
  const router = Router({
    mergeParams: true,
  });

  router.get<{ novelId: string }>("/", async (req, res) => {
    const result = await service.list(
      idSchema.parse(req.params.novelId),
      pageSchema.parse(req.query),
    );

    res.json({
      success: true,
      ...result,
    });
  });

  router.post<{ novelId: string }>("/", async (req, res) => {
    const data = await service.create(
      idSchema.parse(req.params.novelId),
      createChapterSchema.parse(req.body),
    );

    res.status(201).json({
      success: true,
      data,
    });
  });

  router.post<{ novelId: string }>(
    "/import",
    uploadChapter,
    async (req, res) => {
      const novelId = idSchema.parse(req.params.novelId);

      const metadata = importChapterSchema.parse(req.body);

      const files = req.files as
        | Record<string, Express.Multer.File[]>
        | undefined;

      const source = files?.sourceFile?.[0];
      const chinese = files?.chineseFile?.[0];

      if (!source) {
        throw new AppError(400, "SOURCE_FILE_REQUIRED", "Thiếu sourceFile.");
      }

      const input = createChapterSchema.parse({
        ...metadata,
        sourceText: decodeText(source.buffer),

        originalChinese: chinese ? decodeText(chinese.buffer) : null,
      });

      const data = await service.create(novelId, input);

      res.status(201).json({
        success: true,
        data,
      });
    },
  );

  return router;
}

// Resource dùng chapterId độc lập để frontend không phải gửi lại novelId.
export function createChapterRouter(service: ChapterService) {
  const router = Router();

  router.get("/:chapterId/segments", async (req, res) => {
    const result = await service.segments(
      idSchema.parse(req.params.chapterId),
      pageSchema.parse(req.query),
    );

    res.json({
      success: true,
      ...result,
    });
  });

  router.get("/:chapterId", async (req, res) => {
    const data = await service.get(idSchema.parse(req.params.chapterId));

    res.json({
      success: true,
      data,
    });
  });

  router.patch("/:chapterId", async (req, res) => {
    const data = await service.update(
      idSchema.parse(req.params.chapterId),
      updateChapterSchema.parse(req.body),
    );

    res.json({
      success: true,
      data,
    });
  });

  router.delete("/:chapterId", async (req, res) => {
    await service.delete(idSchema.parse(req.params.chapterId));

    res.status(204).end();
  });

  return router;
}
