import type {
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client.js";

import { AppError } from "../../lib/app-error.js";
import {
  pageArgs,
  type PageInput,
} from "../../lib/content.schema.js";

import {
  planRevision,
  type EditCommand,
} from "./editing.policy.js";

import type { EditGuard } from "./editing.schema.js";

const editorInclude = {
  chapter: {
    select: { version: true },
  },
  draftRevision: true,
  approvedRevision: true,
} satisfies Prisma.SegmentInclude;

type EditorRecord = Prisma.SegmentGetPayload<{
  include: typeof editorInclude;
}>;

// finalText luôn xuất phát từ revision đã duyệt, không lấy từ generation mới nhất.
function toEditor(segment: EditorRecord) {
  const draftText = segment.draftRevision?.text ?? null;
  const finalText = segment.approvedRevision?.text ?? null;

  const hasUnapprovedChanges = draftText !== finalText;

  const status =
    finalText === null
      ? draftText === null
        ? "EMPTY"
        : "DRAFT"
      : hasUnapprovedChanges
        ? "CHANGES_PENDING"
        : "APPROVED";

  return {
    segmentId: segment.id,
    chapterId: segment.chapterId,
    chapterVersion: segment.chapter.version,
    editVersion: segment.editVersion,

    sourceText: segment.sourceText,
    originalChinese: segment.originalChinese,

    draftText,
    finalText,
    draftRevisionId: segment.draftRevisionId,
    approvedRevisionId: segment.approvedRevisionId,

    draftGenerationId: segment.draftRevision?.generationId ?? null,
    approvedGenerationId:
      segment.approvedRevision?.generationId ?? null,

    approvedAt: segment.approvedRevision?.createdAt ?? null,
    hasUnapprovedChanges,
    status,
  };
}

export class EditingRepository {
  constructor(private readonly db: PrismaClient) {}

  // Version chương và hai revision phải thuộc cùng snapshot.
  read(segmentId: string) {
    return this.db.$transaction(
      async (tx) => {
        const segment = await tx.segment.findUnique({
          where: { id: segmentId },
          include: editorInclude,
        });

        if (!segment) {
          throw new AppError(
            404,
            "SEGMENT_NOT_FOUND",
            "Không tìm thấy segment.",
          );
        }

        return toEditor(segment);
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  // Revision và con trỏ draft/approved cùng commit hoặc cùng rollback.
  write(
    segmentId: string,
    guard: EditGuard,
    command: EditCommand,
  ) {
    return this.db.$transaction(async (tx) => {
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

      // B2 và B3 cũng khóa/cập nhật Chapter trước khi xử lý segment.
      // Giữ cùng thứ tự khóa để tránh đua với thao tác tách lại chương.
      await tx.$queryRaw`
        SELECT "id"
        FROM "Chapter"
        WHERE "id" = ${reference.chapterId}::uuid
        FOR UPDATE
      `;

      const segment = await tx.segment.findUnique({
        where: { id: segmentId },
        include: editorInclude,
      });

      if (!segment) {
        throw new AppError(
          409,
          "SEGMENT_CHANGED",
          "Segment đã thay đổi; tải lại chương.",
        );
      }

      if (segment.chapter.version !== guard.chapterVersion) {
        throw new AppError(
          409,
          "CHAPTER_VERSION_CONFLICT",
          "Chương đã thay đổi; tải lại trước khi chỉnh sửa.",
        );
      }

      if (segment.editVersion !== guard.editVersion) {
        throw new AppError(
          409,
          "EDIT_VERSION_CONFLICT",
          "Bản dịch đã thay đổi ở phiên khác; tải lại trước khi lưu.",
        );
      }

      const generation =
        command.type === "ACCEPT" || command.type === "REJECT"
          ? await tx.generation.findUnique({
              where: { id: command.generationId },
            })
          : null;

      const previousRevision =
        command.type === "RESTORE"
          ? await tx.revision.findUnique({
              where: { id: command.revisionId },
            })
          : null;

      const plan = planRevision(segment, command, {
        generation,
        revision: previousRevision,
      });

      const revision = await tx.revision.create({
        data: {
          chapterId: segment.chapterId,
          segmentId,
          segmentKey: segmentId,
          chapterVersion: segment.chapter.version,
          sequence: guard.editVersion + 1,

          kind: plan.kind,
          text: plan.text,

          sourceText: segment.sourceText,
          originalChinese: segment.originalChinese,

          generationId: plan.generationId,
          parentRevisionId: plan.parentRevisionId,
        },
      });

      // CAS bảo vệ version ngay tại câu lệnh ghi, ngoài kiểm tra phía trên.
      const changed = await tx.segment.updateMany({
        where: {
          id: segmentId,
          editVersion: guard.editVersion,
        },
        data: {
          editVersion: { increment: 1 },

          ...(plan.setDraft
            ? { draftRevisionId: revision.id }
            : {}),

          ...(plan.setApproved
            ? { approvedRevisionId: revision.id }
            : {}),
        },
      });

      if (!changed.count) {
        throw new AppError(
          409,
          "EDIT_VERSION_CONFLICT",
          "Bản dịch đã thay đổi; tải lại trước khi lưu.",
        );
      }

      const updated = await tx.segment.findUniqueOrThrow({
        where: { id: segmentId },
        include: editorInclude,
      });

      return {
        ...toEditor(updated),
        createdRevisionId: revision.id,
      };
    });
  }

  // Đọc được lịch sử segment cũ kể cả khi B2 đã xóa segment đó.
  history(
    where: { segmentKey?: string; chapterId?: string },
    page: PageInput,
  ) {
    return this.db.$transaction(
      async (tx) => {
        const total = await tx.revision.count({ where });

        const data = await tx.revision.findMany({
          where,
          ...pageArgs(page),
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
