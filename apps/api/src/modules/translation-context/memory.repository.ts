import type { Prisma } from "../../generated/prisma/client.js";

export interface MemoryExample {
  revisionId: string;
  sourceText: string;
  targetText: string;
}

// Tra các bản duyệt hiện hành. Khi duyệt lại hoặc tách lại chương,
// con trỏ approvedRevisionId tự quyết định ví dụ nào còn hiệu lực.
export async function findMemoryExamples(
  db: Prisma.TransactionClient,
  novelId: string,
  query: string,
  excludeSegmentId: string | null = null,
): Promise<MemoryExample[]> {
  // Chỉ lấy chữ và số trước khi ghép toán tử OR.
  // Giới hạn số từ để một đoạn dài không tạo tsquery quá lớn.
  const words = query
    .slice(0, 4_000)
    .normalize("NFC")
    .toLowerCase()
    .match(/[\p{L}\p{M}\p{N}]{2,64}/gu) ?? [];

  const terms = [...new Set(words)].slice(0, 32);

  if (!terms.length) {
    return [];
  }

  const search = terms.join(" | ");

  return db.$queryRaw<MemoryExample[]>`
    WITH needle AS (
      SELECT to_tsquery('simple'::regconfig, ${search}::text) AS value
    )
    SELECT
      revision."id" AS "revisionId",
      revision."sourceText",
      revision."text" AS "targetText"
    FROM "Revision" AS revision
    JOIN "Segment" AS segment
      ON segment."approvedRevisionId" = revision."id"
      AND segment."id" = revision."segmentId"
    JOIN "Chapter" AS chapter
      ON chapter."id" = segment."chapterId"
    CROSS JOIN needle
    WHERE chapter."novelId" = ${novelId}::uuid
      AND segment."id" IS DISTINCT FROM ${excludeSegmentId}::uuid
      AND revision."kind" = 'APPROVE'
      AND revision."text" IS NOT NULL
      AND char_length(revision."sourceText") <= 1000
      AND char_length(revision."text") <= 1200
      AND to_tsvector('simple'::regconfig, revision."sourceText") @@ needle.value
    ORDER BY
      ts_rank(
        to_tsvector('simple'::regconfig, revision."sourceText"),
        needle.value
      ) DESC,
      revision."createdAt" DESC,
      revision."id" DESC
    LIMIT 4
  `;
}
