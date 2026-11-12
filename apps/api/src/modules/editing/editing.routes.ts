import { Router } from "express";

import {
  idSchema,
  pageSchema,
} from "../../lib/content.schema.js";

import {
  approveSchema,
  restoreSchema,
  reviewGenerationSchema,
  saveDraftSchema,
} from "./editing.schema.js";

import type { EditingService } from "./editing.service.js";

// Schema kiểm tra HTTP input; service/repository xử lý nghiệp vụ và transaction.
export function createEditingRouter(service: EditingService) {
  const router = Router();

  router.get("/segments/:segmentId/editor", async (req, res) => {
    const data = await service.get(
      idSchema.parse(req.params.segmentId),
    );

    res.json({ success: true, data });
  });

  router.put("/segments/:segmentId/draft", async (req, res) => {
    const data = await service.saveDraft(
      idSchema.parse(req.params.segmentId),
      saveDraftSchema.parse(req.body),
    );

    res.json({ success: true, data });
  });

  router.post("/segments/:segmentId/approve", async (req, res) => {
    const data = await service.approve(
      idSchema.parse(req.params.segmentId),
      approveSchema.parse(req.body),
    );

    res.json({ success: true, data });
  });

  router.post("/segments/:segmentId/restore", async (req, res) => {
    const data = await service.restore(
      idSchema.parse(req.params.segmentId),
      restoreSchema.parse(req.body),
    );

    res.json({ success: true, data });
  });

  router.post(
    "/segments/:segmentId/generations/:generationId/review",
    async (req, res) => {
      const data = await service.review(
        idSchema.parse(req.params.segmentId),
        idSchema.parse(req.params.generationId),
        reviewGenerationSchema.parse(req.body),
      );

      res.json({ success: true, data });
    },
  );

  router.get("/segments/:segmentId/revisions", async (req, res) => {
    const result = await service.history(
      { segmentKey: idSchema.parse(req.params.segmentId) },
      pageSchema.parse(req.query),
    );

    res.json({ success: true, ...result });
  });

  router.get("/chapters/:chapterId/revisions", async (req, res) => {
    const result = await service.history(
      { chapterId: idSchema.parse(req.params.chapterId) },
      pageSchema.parse(req.query),
    );

    res.json({ success: true, ...result });
  });

  return router;
}
