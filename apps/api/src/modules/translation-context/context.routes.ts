import { Router } from "express";

import type { PrismaClient } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/app-error.js";
import { idSchema, pageSchema } from "../../lib/content.schema.js";

import { glossaryInputSchema, memoryQuerySchema } from "./context.schema.js";
import { listGlossary, saveGlossaryEntry } from "./glossary.repository.js";
import { findMemoryExamples } from "./memory.repository.js";

type NovelParams = { novelId: string };
type EntryParams = NovelParams & { entryId: string };

// Mount dưới /novels/:novelId để glossary và memory dùng chung phạm vi truyện.
export function createTranslationContextRouter(db: PrismaClient) {
  const router = Router({ mergeParams: true });

  router.get<NovelParams>("/glossary", async (req, res) => {
    const result = await listGlossary(
      db,
      idSchema.parse(req.params.novelId),
      pageSchema.parse(req.query),
    );

    res.json({ success: true, ...result });
  });

  router.post<NovelParams>("/glossary", async (req, res) => {
    const data = await saveGlossaryEntry(
      db,
      idSchema.parse(req.params.novelId),
      glossaryInputSchema.parse(req.body),
    );

    res.status(201).json({ success: true, data });
  });

  router.put<EntryParams>("/glossary/:entryId", async (req, res) => {
    const data = await saveGlossaryEntry(
      db,
      idSchema.parse(req.params.novelId),
      glossaryInputSchema.parse(req.body),
      idSchema.parse(req.params.entryId),
    );

    res.json({ success: true, data });
  });

  router.delete<EntryParams>("/glossary/:entryId", async (req, res) => {
    await db.glossaryEntry.delete({
      where: {
        id: idSchema.parse(req.params.entryId),
        novelId: idSchema.parse(req.params.novelId),
      },
    });

    res.status(204).end();
  });

  router.get<NovelParams>("/translation-memory", async (req, res) => {
    const novelId = idSchema.parse(req.params.novelId);
    const { q } = memoryQuerySchema.parse(req.query);

    const novel = await db.novel.findUnique({
      where: { id: novelId },
      select: { id: true },
    });

    if (!novel) {
      throw new AppError(404, "NOVEL_NOT_FOUND", "Không tìm thấy truyện.");
    }

    const data = await findMemoryExamples(db, novelId, q);
    res.json({ success: true, data });
  });

  return router;
}
