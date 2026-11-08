import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  HOST: z.string().min(1).default("127.0.0.1"),

  PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  WEB_ORIGIN: z.url().default("http://localhost:5173"),

  DATABASE_URL: z
    .string()
    .regex(
      /^postgres(ql)?:\/\//,
      "DATABASE_URL phải là PostgreSQL connection URL.",
    ),

  LLM_BASE_URL: z.url().refine((value) => {
    // Refinement có thể chạy dù URL sai format; tránh để URL parser ném lỗi thô.
    if (!URL.canParse(value)) {
      return false;
    }

    const url = new URL(value);

    return (
      ["http:", "https:"].includes(url.protocol) &&
      url.pathname.replace(/\/$/, "") === "/v1" &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
    );
  }, "LLM_BASE_URL phải là HTTP(S) endpoint kết thúc bằng /v1."),

  LLM_API_KEY: z.string().trim().min(1).default("lm-studio"),

  LLM_MODEL_ID: z.string().trim().default(""),

  LLM_TIMEOUT_MS: z.coerce.number().int().min(100).max(600000).default(120000),
});

// Dừng sớm khi cấu hình sai; chỉ báo tên trường để tránh lộ URL DB hoặc API key.
export function loadEnv(input: NodeJS.ProcessEnv = process.env) {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    const fields = [
      ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
    ];

    throw new Error(`Cấu hình .env không hợp lệ: ${fields.join(", ")}`);
  }

  return parsed.data;
}
