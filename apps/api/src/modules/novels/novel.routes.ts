import { Router } from "express";

import { idSchema, pageSchema } from "../../lib/content.schema.js";

import { createNovelSchema, updateNovelSchema } from "./novel.schema.js";

import type { NovelService } from "./novel.service.js";

// HTTP adapter chỉ parse input và định dạng response; nghiệp vụ đặt trong service.
export function createNovelRouter(service: NovelService) {
  const router = Router();

  router.get("/", async (req, res) => {
    const result = await service.list(pageSchema.parse(req.query));

    res.json({
      success: true,
      ...result,
    });
  });

  router.post("/", async (req, res) => {
    const data = await service.create(createNovelSchema.parse(req.body));

    res.status(201).json({
      success: true,
      data,
    });
  });

  router.get("/:novelId", async (req, res) => {
    const data = await service.get(idSchema.parse(req.params.novelId));

    res.json({
      success: true,
      data,
    });
  });

  router.patch("/:novelId", async (req, res) => {
    const data = await service.update(
      idSchema.parse(req.params.novelId),
      updateNovelSchema.parse(req.body),
    );

    res.json({
      success: true,
      data,
    });
  });

  router.delete("/:novelId", async (req, res) => {
    await service.delete(idSchema.parse(req.params.novelId));

    res.status(204).end();
  });

  return router;
}
