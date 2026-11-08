import {
  Prisma,
  type Generation,
} from "../../generated/prisma/client.js";

import { AppError } from "../../lib/app-error.js";
import type { PageInput } from "../../lib/content.schema.js";
import type { LlmService } from "../llm/llm.service.js";

import type { GenerationRepository } from "./generation.repository.js";
import {
  generationParametersSchema,
  promptMessagesSchema,
  type GenerateSegmentInput,
} from "./generation.schema.js";

type RepositoryPort = Pick<
  GenerationRepository,
  | "enqueue"
  | "recoverInterrupted"
  | "claimNext"
  | "requeue"
  | "saveProgress"
  | "finish"
  | "find"
  | "history"
>;

export class GenerationService {
  private readonly shutdownController = new AbortController();

  private timer: ReturnType<typeof setTimeout> | undefined;
  private task: Promise<void> | undefined;

  constructor(
    private readonly repo: RepositoryPort,
    private readonly llm: Pick<LlmService, "stream">,
    private readonly defaultModel: string,
    private readonly timeoutMs: number,
  ) {}

  // SSE và inference cùng nhận tín hiệu shutdown.
  get stopSignal(): AbortSignal {
    return this.shutdownController.signal;
  }

  // Khôi phục trạng thái trước khi nhận generation mới.
  async start() {
    await this.repo.recoverInterrupted();
    this.kick();
  }

  // Request chỉ enqueue; đóng HTTP/SSE không hủy công việc.
  async generate(segmentId: string, input: GenerateSegmentInput) {
    if (this.stopSignal.aborted) {
      throw new AppError(
        503,
        "SERVER_STOPPING",
        "API đang dừng.",
      );
    }

    const model = input.model ?? this.defaultModel;

    if (!model) {
      throw new AppError(
        400,
        "MODEL_REQUIRED",
        "Truyền model hoặc đặt LLM_MODEL_ID trong .env.",
      );
    }

    const generation = await this.repo.enqueue(segmentId, input, model);

    this.kick();

    return generation;
  }

  // Một vòng drain duy nhất cho toàn process.
  private kick() {
    if (this.stopSignal.aborted || this.task) {
      return;
    }

    clearTimeout(this.timer);

    this.task = this.drain()
      .catch(() => {
        // Không log prompt hoặc lỗi DB có thể chứa dữ liệu truyện.
        console.error({ code: "GENERATION_WORKER_FAILED" });
      })
      .finally(() => {
        this.task = undefined;

        if (!this.stopSignal.aborted) {
          // Poll DB cũng xử lý được job được enqueue đúng lúc drain kết thúc.
          this.timer = setTimeout(() => this.kick(), 1000);
          this.timer.unref();
        }
      });
  }

  // Chỉ recover khi không còn inference của vòng drain trước.
  private async drain() {
    await this.repo.recoverInterrupted();

    while (!this.stopSignal.aborted) {
      const generation = await this.repo.claimNext();

      if (!generation) {
        return;
      }

      const canContinue = await this.run(generation);

      if (!canContinue) {
        return;
      }
    }
  }

  // Mỗi generation có output riêng; retry không ghi đè kết quả trước.
  private async run(generation: Generation): Promise<boolean> {
    let output = "";
    let lastSavedAt = 0;

    const startedAt = performance.now();

    try {
      const parameters = generationParametersSchema.parse(
        generation.parameters,
      );

      const messages = promptMessagesSchema.parse(
        generation.messages,
      );

      const result = await this.llm.stream(
        {
          model: generation.model,
          messages,
          ...parameters,
          timeoutMs: this.timeoutMs,
        },
        async (delta) => {
          output += delta;

          // Gom token thành đợt nhỏ, tránh ghi DB cho từng token.
          if (Date.now() - lastSavedAt >= 250) {
            await this.repo.saveProgress(generation.id, output);
            lastSavedAt = Date.now();
          }
        },
        this.stopSignal,
      );

      const status =
        result.finishReason === "stop"
          ? "SUCCEEDED"
          : result.finishReason === "length"
            ? "TRUNCATED"
            : "FAILED";

      await this.repo.finish(generation.id, {
        output: result.output,
        status,
        actualModel: result.model,
        finishReason: result.finishReason,
        durationMs: result.durationMs,

        usage:
          result.usage == null
            ? Prisma.DbNull
            : (JSON.parse(
                JSON.stringify(result.usage),
              ) as Prisma.InputJsonValue),

        errorCode:
          status === "FAILED"
            ? "LLM_FINISH_REJECTED"
            : null,
      });

      return true;
    } catch (error) {
      if (error instanceof AppError && error.code === "LLM_BUSY") {
        await this.repo.requeue(generation.id);
        return false;
      }

      await this.repo.finish(generation.id, {
        output,
        status: "FAILED",
        durationMs: Math.round(performance.now() - startedAt),
        errorCode:
          error instanceof AppError
            ? error.code
            : "GENERATION_FAILED",
      });

      return true;
    }
  }

  // Detail dùng cho SSE reconnect và kiểm tra snapshot.
  async get(id: string) {
    const generation = await this.repo.find(id);

    if (!generation) {
      throw new AppError(
        404,
        "GENERATION_NOT_FOUND",
        "Không tìm thấy generation.",
      );
    }

    return generation;
  }

  // Không yêu cầu segment còn tồn tại để đọc lịch sử cũ.
  history(
    where: { segmentKey?: string; chapterId?: string },
    page: PageInput,
  ) {
    return this.repo.history(where, page);
  }

  // Đợi worker lưu trạng thái cuối trước khi đóng Prisma.
  async stop() {
    this.shutdownController.abort();
    clearTimeout(this.timer);
    await this.task;
  }
}
