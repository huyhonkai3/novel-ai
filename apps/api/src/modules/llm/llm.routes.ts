import { Router } from "express";
import { LlmController } from "./llm.controller.js";
import type { LlmService } from "./llm.service.js";

// Express 5 tự chuyển rejected Promise từ async handler đến error middleware.
export function createLlmRouter(service: LlmService) {
  const router = Router();
  const controller = new LlmController(service);

  router.get("/models", controller.models);
  router.post("/test", controller.test);

  return router;
}
