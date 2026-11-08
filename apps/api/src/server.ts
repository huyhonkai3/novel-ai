import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createPrisma } from "./lib/prisma.js";

import { createContentRouter } from "./modules/content.routes.js";

import { createLlmClient } from "./modules/llm/llm.client.js";
import { LlmService } from "./modules/llm/llm.service.js";

import { GenerationRepository } from "./modules/generations/generation.repository.js";
import { GenerationService } from "./modules/generations/generation.service.js";
import { createGenerationRouter } from "./modules/generations/generation.routes.js";

const env = loadEnv();
const prisma = createPrisma(env.DATABASE_URL);

// B1 và B3 phải dùng cùng instance để chia sẻ khóa inference.
const llm = new LlmService(
  createLlmClient(
    env.LLM_BASE_URL,
    env.LLM_API_KEY,
    env.LLM_TIMEOUT_MS,
  ),
  env.LLM_MODEL_ID,
);

const generations = new GenerationService(
  new GenerationRepository(prisma),
  llm,
  env.LLM_MODEL_ID,
  env.LLM_TIMEOUT_MS,
);

// Chưa mở HTTP nếu không khôi phục được trạng thái job trong DB.
try {
  await generations.start();
} catch {
  console.error({ code: "GENERATION_STARTUP_FAILED" });
  await prisma.$disconnect();
  process.exit(1);
}

const app = createApp({
  llm,
  webOrigin: env.WEB_ORIGIN,
  contentRouter: createContentRouter(prisma),
  generationRouter: createGenerationRouter(generations),

  checkDatabase: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
});

const server = app.listen(env.PORT, env.HOST, () => {
  console.info(`API: http://${env.HOST}:${env.PORT}`);
});

let stopping = false;

// Đóng SSE và inference trước khi đóng DB để giữ trạng thái cuối.
async function shutdown(exitCode = 0) {
  if (stopping) {
    return;
  }

  stopping = true;

  const deadline = setTimeout(() => {
    process.exit(1);
  }, env.LLM_TIMEOUT_MS + 5000);

  deadline.unref();

  try {
    const httpClosed = new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    await Promise.all([
      httpClosed,
      generations.stop(),
    ]);

    await prisma.$disconnect();

    clearTimeout(deadline);
    process.exit(exitCode);
  } catch {
    process.exit(1);
  }
}

server.on("error", () => {
  console.error("Không mở được HTTP server; kiểm tra HOST/PORT.");
  void shutdown(1);
});

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
