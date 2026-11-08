import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createPrisma } from "./lib/prisma.js";
import { createLlmClient } from "./modules/llm/llm.client.js";
import { LlmService } from "./modules/llm/llm.service.js";

import { createContentRouter } from "./modules/content.routes.js";

const env = loadEnv();

const prisma = createPrisma(env.DATABASE_URL);

const llm = new LlmService(
  createLlmClient(env.LLM_BASE_URL, env.LLM_API_KEY, env.LLM_TIMEOUT_MS),
  env.LLM_MODEL_ID,
);

const app = createApp({
  llm,
  webOrigin: env.WEB_ORIGIN,
  contentRouter: createContentRouter(prisma),

  checkDatabase: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
});

const server = app.listen(env.PORT, env.HOST, () => {
  console.info(`API: http://${env.HOST}:${env.PORT}`);
});

// Dọn pool nếu cổng bị chiếm; tránh giữ process không phục vụ được request.
server.on("error", () => {
  console.error("Không mở được HTTP server; kiểm tra HOST/PORT.");

  void prisma.$disconnect().finally(() => {
    process.exit(1);
  });
});

let stopping = false;

// Dừng nhận request mới, chờ request đang chạy, rồi đóng DB; luôn có hạn chót.
function shutdown() {
  if (stopping) {
    return;
  }

  stopping = true;

  const deadline = setTimeout(() => {
    process.exit(1);
  }, env.LLM_TIMEOUT_MS + 5000);

  deadline.unref();

  server.close(() => {
    void prisma
      .$disconnect()
      .then(() => {
        clearTimeout(deadline);
        process.exit(0);
      })
      .catch(() => {
        process.exit(1);
      });
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
