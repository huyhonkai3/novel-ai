import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

import { Router, type Response } from "express";

import {
  idSchema,
  pageSchema,
} from "../../lib/content.schema.js";

import { generateSegmentSchema } from "./generation.schema.js";
import type { GenerationService } from "./generation.service.js";

const terminalStatuses = new Set([
  "SUCCEEDED",
  "TRUNCATED",
  "FAILED",
]);

// Chờ drain khi client đọc chậm để không tăng buffer vô hạn.
async function writeEvent(
  res: Response,
  event: string,
  data: unknown,
  signal: AbortSignal,
) {
  signal.throwIfAborted();

  const writable = res.write(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );

  if (!writable) {
    await once(res, "drain", { signal });
  }
}

// Endpoint dùng chung envelope với B1/B2.
export function createGenerationRouter(service: GenerationService) {
  const router = Router();

  router.post("/segments/:segmentId/generate", async (req, res) => {
    const generation = await service.generate(
      idSchema.parse(req.params.segmentId),
      generateSegmentSchema.parse(req.body),
    );

    res
      .status(202)
      .location(`/api/generations/${generation.id}`)
      .json({
        success: true,
        data: {
          id: generation.id,
          status: generation.status,
          streamUrl: `/api/generations/${generation.id}/stream`,
        },
      });
  });

  router.get("/segments/:segmentId/generations", async (req, res) => {
    const result = await service.history(
      { segmentKey: idSchema.parse(req.params.segmentId) },
      pageSchema.parse(req.query),
    );

    res.json({ success: true, ...result });
  });

  // Vẫn tìm được lịch sử khi chương đã được tách lại thành segment mới.
  router.get("/chapters/:chapterId/generations", async (req, res) => {
    const result = await service.history(
      { chapterId: idSchema.parse(req.params.chapterId) },
      pageSchema.parse(req.query),
    );

    res.json({ success: true, ...result });
  });

  router.get("/generations/:generationId", async (req, res) => {
    const data = await service.get(
      idSchema.parse(req.params.generationId),
    );

    res.json({ success: true, data });
  });

  router.get("/generations/:generationId/stream", async (req, res) => {
    const id = idSchema.parse(req.params.generationId);

    // Kiểm tra 404 trước khi gửi SSE headers.
    let generation = await service.get(id);

    const controller = new AbortController();

    const abort = () => controller.abort();

    res.once("close", abort);
    service.stopSignal.addEventListener("abort", abort, { once: true });

    if (service.stopSignal.aborted) {
      abort();
    }

    res.status(200);
    res.set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    });

    res.setTimeout(0);
    res.flushHeaders();

    let previousState = "";
    let lastHeartbeatAt = Date.now();

    try {
      while (!controller.signal.aborted && !res.destroyed) {
        const state = `${generation.status}:${generation.output.length}`;

        if (state !== previousState) {
          // Gửi snapshot thay vì delta để reconnect không nhân đôi output.
          await writeEvent(
            res,
            "snapshot",
            {
              id: generation.id,
              status: generation.status,
              output: generation.output,
            },
            controller.signal,
          );

          previousState = state;
        }

        if (terminalStatuses.has(generation.status)) {
          // done có cả errorCode/finishReason để phân biệt lỗi và bị cắt.
          await writeEvent(
            res,
            "done",
            generation,
            controller.signal,
          );

          break;
        }

        if (Date.now() - lastHeartbeatAt >= 15_000) {
          await writeEvent(
            res,
            "heartbeat",
            { at: Date.now() },
            controller.signal,
          );

          lastHeartbeatAt = Date.now();
        }

        await delay(300, undefined, {
          signal: controller.signal,
        });

        generation = await service.get(id);
      }
    } catch {
      if (!controller.signal.aborted && !res.destroyed) {
        // Sau SSE headers phải báo lỗi bằng event, không gửi JSON middleware.
        try {
          await writeEvent(
            res,
            "problem",
            { code: "GENERATION_STREAM_UNAVAILABLE" },
            controller.signal,
          );
        } catch {
          // Socket có thể đóng trong lúc gửi event cuối.
        }
      }
    } finally {
      res.off("close", abort);
      service.stopSignal.removeEventListener("abort", abort);

      if (!res.destroyed) {
        res.end();
      }
    }
  });

  return router;
}
