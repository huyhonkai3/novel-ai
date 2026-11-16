import {
  Prisma,
  type PrismaClient,
} from "../../generated/prisma/client.js";

import { AppError } from "../../lib/app-error.js";
import { pageArgs, type PageInput } from "../../lib/content.schema.js";
import { normalizeTerm, type GlossaryInput } from "./context.schema.js";

const glossarySelect = {
  id: true,
  novelId: true,
  sourceTerm: true,
  targetTerm: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GlossaryEntrySelect;

// Trả danh sách và tổng số từ cùng snapshot.
export async function listGlossary(
  db: PrismaClient,
  novelId: string,
  page: PageInput,
) {
  const novel = await db.$transaction(
    (tx) =>
      tx.novel.findUnique({
        where: { id: novelId },
        select: {
          _count: { select: { glossaryEntries: true } },
          glossaryEntries: {
            ...pageArgs(page),
            orderBy: { sourceKey: "asc" },
            select: glossarySelect,
          },
        },
      }),
    { isolationLevel: "RepeatableRead" },
  );

  if (!novel) {
    throw new AppError(404, "NOVEL_NOT_FOUND", "Không tìm thấy truyện.");
  }

  return {
    data: novel.glossaryEntries,
    meta: { ...page, total: novel._count.glossaryEntries },
  };
}

// Dùng chung kiểm tra trùng từ khóa cho POST và PUT.
export async function saveGlossaryEntry(
  db: PrismaClient,
  novelId: string,
  input: GlossaryInput,
  entryId?: string,
) {
  const data = {
    ...input,
    sourceKey: normalizeTerm(input.sourceTerm),
  };

  try {
    if (entryId) {
      return await db.glossaryEntry.update({
        where: { id: entryId, novelId },
        data,
        select: glossarySelect,
      });
    }

    const novel = await db.novel.findUnique({
      where: { id: novelId },
      select: { id: true },
    });

    if (!novel) {
      throw new AppError(404, "NOVEL_NOT_FOUND", "Không tìm thấy truyện.");
    }

    return await db.glossaryEntry.create({
      data: { ...data, novelId },
      select: glossarySelect,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AppError(
        409,
        "GLOSSARY_TERM_EXISTS",
        "Thuật ngữ nguồn đã có trong truyện.",
      );
    }

    throw error;
  }
}

// Dò chuỗi con cho chữ Hán. Với chữ Latin, kiểm tra ranh giới để "he"
// không khớp với "the". Escape để thuật ngữ như C++ được dò theo nghĩa đen.
function containsTerm(text: string, key: string) {
  if (/\p{Script=Han}/u.test(key)) {
    return text.includes(key);
  }

  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}_])${escaped}(?![\\p{L}\\p{M}\\p{N}_])`,
    "u",
  ).test(text);
}

// Lọc theo đoạn đang dịch và bản Trung đối chiếu. Cụm dài được ưu tiên.
export async function findGlossaryHints(
  db: Prisma.TransactionClient,
  novelId: string,
  sourceText: string,
  originalChinese: string | null,
) {
  const source = normalizeTerm(sourceText);
  const chinese = normalizeTerm(originalChinese ?? "");

  const entries = await db.$queryRaw<
    Array<{
      sourceTerm: string;
      sourceKey: string;
      targetTerm: string;
      notes: string | null;
    }>
  >`
    SELECT "sourceTerm", "sourceKey", "targetTerm", "notes"
    FROM "GlossaryEntry"
    WHERE "novelId" = ${novelId}::uuid
      AND (
        strpos(${source}::text, "sourceKey") > 0
        OR strpos(${chinese}::text, "sourceKey") > 0
      )
    ORDER BY char_length("sourceKey") DESC, "sourceKey" ASC
  `;

  return entries
    .filter(({ sourceKey }) =>
      containsTerm(source, sourceKey) || containsTerm(chinese, sourceKey),
    )
    .slice(0, 30)
    .map(({ sourceTerm, targetTerm, notes }) => ({
      source: sourceTerm,
      target: targetTerm,
      notes,
    }));
}
