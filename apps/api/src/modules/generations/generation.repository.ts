import {
  Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.js";

import { AppError } from "../../lib/app-error.js";
import {
  pageArgs,
  type PageInput,
} from "../../lib/content.schema.js";

import { buildGenerationPrompt } from "./generation.prompt.js";
import type { GenerateSegmentInput } from "./generation.schema.js";

export class GenerationRepository {
  constructor(private readonly db: PrismaClient) {}

  // Khóa chương theo cùng hàng mà B2 cập nhật trước khi thay segment.
  async enqueue(
    segmentId: string,
    input: GenerateSegmentInput,
    model: string,
  ) {
    try {
      return await this.db.$transaction(async (tx) => {
        const reference = await tx.segment.findUnique({
          where: { id: segmentId },
          select: { chapterId: true },
        });

        if (!reference) {
          throw new AppError(
            404,
            "SEGMENT_NOT_FOUND",
            "Không tìm thấy segment.",
          );
        }

        await tx.$queryRaw`
          SELECT "id"
          FROM "Chapter"
          WHERE "id" = ${reference.chapterId}::uuid
          FOR UPDATE
        `;

        // Đọc lại sau khi lấy khóa: B2 có thể vừa thay toàn bộ segment.
        const segment = await tx.segment.findUnique({
          where: { id: segmentId },
          include: {
            chapter: {
              select: { version: true },
            },
          },
        });

        if (!segment) {
          throw new AppError(
            409,
            "SEGMENT_CHANGED",
            "Segment đã thay đổi; tải lại chương.",
          );
        }

        if (segment.chapter.version !== input.chapterVersion) {
          throw new AppError(
            409,
            "CHAPTER_VERSION_CONFLICT",
            "Chương đã thay đổi; tải lại trước khi generate.",
          );
        }

        const previous = await tx.segment.findFirst({
          where: {
            chapterId: segment.chapterId,
            position: { lt: segment.position },
          },
          orderBy: { position: "desc" },
          select: { sourceText: true },
        });

        const prompt = buildGenerationPrompt(
          segment,
          previous?.sourceText ?? null,
          input,
        );

        return tx.generation.create({
          data: {
            chapterId: segment.chapterId,
            segmentId,
            segmentKey: segmentId,
            chapterVersion: segment.chapter.version,
            position: segment.position,
            sourceText: segment.sourceText,
            originalChinese: segment.originalChinese,
            model,

            promptVersion: prompt.promptVersion,
            messages: prompt.messages,
            parameters: {
              temperature: input.temperature,
              maxTokens: input.maxTokens,
            },
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new AppError(
          409,
          "GENERATION_ACTIVE",
          "Segment đang có generation trong hàng đợi hoặc đang chạy.",
        );
      }

      throw error;
    }
  }

  // Không tự chạy lại inference bị gián đoạn vì có thể tạo kết quả khác.
  async recoverInterrupted() {
    await this.db.generation.updateMany({
      where: { status: "RUNNING" },
      data: {
        status: "FAILED",
        errorCode: "WORKER_INTERRUPTED",
        finishedAt: new Date(),
      },
    });
  }

  // Claim bằng điều kiện status để tránh xử lý lại một job đã đổi trạng thái.
  async claimNext() {
    const next = await this.db.generation.findFirst({
      where: { status: "QUEUED" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });

    if (!next) {
      return null;
    }

    const claimed = await this.db.generation.updateMany({
      where: { id: next.id, status: "QUEUED" },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        errorCode: null,
      },
    });

    if (!claimed.count) {
      return null;
    }

    return this.db.generation.findUniqueOrThrow({
      where: { id: next.id },
    });
  }

  // B1 test đang chiếm model thì chờ lượt sau, chưa coi là inference thất bại.
  async requeue(id: string) {
    await this.db.generation.updateMany({
      where: { id, status: "RUNNING" },
      data: {
        status: "QUEUED",
        startedAt: null,
      },
    });
  }

  // Chỉ worker đang chạy mới được ghi output.
  async saveProgress(id: string, output: string) {
    await this.db.generation.updateMany({
      where: { id, status: "RUNNING" },
      data: { output },
    });
  }

  // Lưu partial output cả khi upstream lỗi để người dùng kiểm tra.
  async finish(
    id: string,
    data: Prisma.GenerationUpdateManyMutationInput,
  ) {
    await this.db.generation.updateMany({
      where: { id, status: "RUNNING" },
      data: {
        ...data,
        finishedAt: new Date(),
      },
    });
  }

  // Detail chứa cả snapshot prompt và tham số đã sử dụng.
  find(id: string) {
    return this.db.generation.findUnique({ where: { id } });
  }

  // Query bằng segmentKey vẫn hoạt động sau khi segmentId được SetNull.
  history(
    where: { segmentKey?: string; chapterId?: string },
    page: PageInput,
  ) {
    return this.db.$transaction(
      async (tx) => {
        const total = await tx.generation.count({ where });

        const data = await tx.generation.findMany({
          where,
          ...pageArgs(page),
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],

          // Lịch sử chỉ tải thông tin cần hiển thị; prompt nằm ở detail.
          select: {
            id: true,
            chapterId: true,
            segmentKey: true,
            chapterVersion: true,
            position: true,
            status: true,
            model: true,
            actualModel: true,
            promptVersion: true,
            parameters: true,
            finishReason: true,
            errorCode: true,
            durationMs: true,
            createdAt: true,
            finishedAt: true,
          },
        });

        return {
          data,
          meta: { ...page, total },
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
}
