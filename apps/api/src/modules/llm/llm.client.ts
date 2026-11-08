import OpenAI from "openai";

// Dùng endpoint tương thích OpenAI của LM Studio; không fallback sang cloud.
export function createLlmClient(
  baseURL: string,
  apiKey: string,
  timeout: number,
) {
  return new OpenAI({
    baseURL: baseURL.replace(/\/$/, ""),
    apiKey,
    timeout,

    // Retry mặc định có thể nhân thời gian chờ và chạy lại inference trên máy yếu.
    maxRetries: 0,
  });
}
