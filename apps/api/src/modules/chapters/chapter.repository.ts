import type { PrismaClient, Prisma } from "../../generated/prisma/client.js";

import { AppError } from "../../lib/app-error.js";

import { pageArgs, type PageInput } from "../../lib/content.schema.js";

import type { SegmentDraft } from "../segments/segmenter.js";
import type { CreateChapterInput } from "./chapter.schema.js";

const summary = {
  id: true,
  novelId: true,
  number: true,
  title: true,
  version: true,
  createdAt: true,
  updatedAt: true,

  _count: {
    select: {
      segments: true,
    },
  },
} satisfies Prisma.ChapterSelect;

export class ChapterRepository {
  constructor(private readonly db: PrismaClient) {}

  // Parent và danh sách chương cùng snapshot; không tải sourceText khi liệt kê.
  list(novelId: string, page: PageInput) {
    return this.db.$transaction(
      (tx) =>
        tx.novel.findUnique({
          where: {
            id: novelId,
          },

          select: {
            id: true,

            _count: {
              select: {
                chapters: true,
              },
            },

            chapters: {
              ...pageArgs(page),
              orderBy: {
                number: "asc",
              },
              select: summary,
            },
          },
        }),

      {
        isolationLevel: "Repeatable",
      },
    );
  }

  // Lấy toàn bộ văn bản nguyên trạng để hiển thị hoặc chỉnh sửa.
  async find(id: string) {
    return this.db.chapter.findUnique({
      where: { id },
    });
  }

  //   Nested write đảm bảo chương và segment cùng commit hoặc cùng rollback.
  async create(
    novelId: string,
    input: CreateChapterInput,
    segments: SegmentDraft[],
  ) {
    return this.db.chapter.create({
      data: {
        novelId,
        ...input,

        segments: {
          createMany: {
            data: segments,
          },
        },
      },

      select: summary,
    });
  }

  //   Kiểm tra version tại DB tước khi thay segment để tránh ghi đè đồng thời.
  update(
    id: string,
    version: number,
    data: Prisma.ChapterUpdateManyMutationInput,
    segments?: SegmentDraft[],
  ) {
    return this.db.$transaction(async (tx) => {
      const changed = await tx.chapter.updateMany({
        where: {
          id,
          version,
        },

        data: {
          ...data,
          version: {
            increment: 1,
          },
        },
      });

      if (!changed.count) {
        throw new AppError(
          409,
          "CHAPTER_VERSION_CONFLICT",
          "Chương đã thay đổi; tải lại trước khi cập nhật.",
        );
      }

      if (segments) {
        await tx.segment.deleteMany({
          where: {
            chapterId: id,
          },
        });

        await tx.segment.createMany({
          data: segments.map((segment) => ({
            ...segment,
            chapterId: id,
          })),
        });
      }

      return tx.chapter.findUniqueOrThrow({
        where: { id },
        select: summary,
      });
    });
  }

  //   Version, count và segment cùng snapshot dù chương đang được cập nhật.
  segments(id: string, page: PageInput) {
    return this.db.$transaction(
      (tx) =>
        tx.chapter.findUnique({
          where: { id },

          select: {
            id: true,
            version: true,

            _count: {
              select: {
                segments: true,
              },
            },

            segments: {
              ...pageArgs(page),
              orderBy: {
                position: "asc",
              },
            },
          },
        }),

      {
        isolationLevel: "RepeatableRead",
      },
    );
  }

  //   FK cascade dọn segment của chương.
  async delete(id: string) {
    return this.db.chapter.delete({
      where: { id },
      select: {
        id: true,
      },
    });
  }
}
