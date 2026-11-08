import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { AppError } from "../../lib/app-error.js";
import type { TestLlmInput } from "./llm.schema.js";

export class LlmService {
  private busy = false;

  constructor(
    private readonly client: OpenAI,
    private readonly defaultModel: string,
  ) {}

  // Chỉ trả về model ID; /v1/models không đảm bảo model đã được load vào bộ nhớ.
  async listModels(signal?: AbortSignal) {
    try {
      const page = await this.client.models.list({
        timeout: 5000,
        signal,
      });

      return page.data.map(({ id }) => ({ id }));
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  // Kiểm tra toàn bộ luồng API -> LM Studio -> response bằng một chat completion.
  async test(input: TestLlmInput, signal?: AbortSignal) {
    const model = input.model ?? this.defaultModel;

    if (!model) {
      throw new AppError(
        400,
        "MODEL_REQUIRED",
        "Truyền model hoặc đặt LLM_MODEL_ID trong .env",
      );
    }

    if (this.busy) {
      throw new AppError(
        429,
        "LLM_BUSY",
        "Đang xử lý một prompt; hãy chờ hoàn tất.",
      );
    }

    // Khóa trong cùng process để tránh hai inference tranh VRAM.
    // finally phải luôn mở khóa, kể cả khi timeout hoặc client hủy request.
    this.busy = true;

    const startedAt = performance.now();

    try {
      const messages: ChatCompletionMessageParam[] = [];

      if (input.systemPrompt) {
        messages.push({
          role: "system",
          content: input.systemPrompt,
        });
      }

      messages.push({
        role: "user",
        content: input.prompt,
      });

      const result = await this.client.chat.completions.create(
        {
          model,
          messages,
          temperature: input.temperature,
          max_tokens: input.maxTokens,
          stream: false,
        },
        { signal },
      );

      const choice = result.choices?.[0];
      const content = choice?.message?.content;

      if (typeof content !== "string" || !content.trim()) {
        throw new AppError(
          502,
          "LLM_EMPTY_RESPONSE",
          "Model không trả nội dung văn bản.",
        );
      }

      return {
        model: result.model,
        content,
        finishReason: choice?.finish_reason ?? null,

        // length báo output bị cắt; frontend không nên coi là bản dịch hoàn chỉnh.
        truncated: choice?.finish_reason === "length",

        usage: result.usage ?? null,
        durationMs: Math.round(performance.now() - startedAt),
      };
    } catch (error) {
      throw this.normalizeError(error);
    } finally {
      this.busy = false;
    }
  }

  //   Phân loại bằng type/status; HTTP 400  không đủ để kết luận model chưa load.
  private normalizeError(error: unknown): AppError {
    if (error instanceof AppError) {
      return error;
    }

    if (error instanceof OpenAI.APIConnectionTimeoutError) {
      return new AppError(
        504,
        "LLM_TIMEOUT",
        "LM Studio phản hồi quá thời gian cho phép.",
      );
    }

    if (error instanceof OpenAI.APIUserAbortError) {
      return new AppError(499, "LLM_CANCELLED", "Yêu cầu đã bị hủy.");
    }

    if (error instanceof OpenAI.APIConnectionError) {
      return new AppError(
        503,
        "LLM_UNREACHABLE",
        "Không kết nối được LM Studio. Kiểm tra server và LLM_BASE_URL.",
      );
    }

    if (error instanceof OpenAI.APIError) {
      const details = {
        upstreamStatus: error.status,
      };

      if (error.status === 401 || error.status === 403) {
        return new AppError(
          502,
          "LLM_AUTH_ERROR",
          "LM Studio từ chối API key hoặc quyền truy cập.",
          details,
        );
      }

      if (
        error.status === 400 ||
        error.status === 404 ||
        error.status === 422
      ) {
        return new AppError(
          502,
          "LLM_REQUEST_REJECTED",
          "LM Studio từ chối yêu cầu. Kiểm tra model ID, model đã load/JIT, endpoint và giới hạn context.",
          details,
        );
      }

      if (error.status === 429) {
        return new AppError(
          503,
          "LLM_RATE_LIMITED",
          "LM Studio đang quá tải; thử lại sau.",
          details,
        );
      }

      return new AppError(
        502,
        "LLM_UPSTREAM_ERROR",
        "LM Studio gặp lỗi xử lý.",
        details,
      );
    }

    return new AppError(
      502,
      "LLM_INVALID_RESPONSE",
      "Phản hồi LM Studio không đúng định dạng mong đợi.",
    );
  }
}
