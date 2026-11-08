import { AppError } from "../../lib/app-error.js";

export interface SegmentDraft {
  position: number;
  startOffset: number;
  endOffset: number;
  sourceText: string;
  originalChinese: string | null;
}

// Tách tại dòng trống; giữ nguyên newline, indent, dấu câu và khoảng trắng.
export function splitParagraphs(text: string) {
  const spans: Array<{
    startOffset: number;
    endOffset: number;
    sourceText: string;
  }> = [];

  let start = 0;
  let hasContent = false;
  let previousBlank = false;

  for (const match of text.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    if (!match[0]) {
      continue;
    }

    const line = match[0].replace(/(?:\r\n|\r|\n)$/, "");

    const blank = line.trim().length === 0;

    if (!blank) {
      if (hasContent && previousBlank) {
        // Gắn separator vào đoạn trước để join các segment khôi phục đúng bản gốc.
        spans.push({
          startOffset: start,
          endOffset: match.index,
          sourceText: text.slice(start, match.index),
        });

        start = match.index;
      }

      hasContent = true;
    }

    previousBlank = blank;
  }

  if (hasContent) {
    spans.push({
      startOffset: start,
      endOffset: text.length,
      sourceText: text.slice(start),
    });
  }

  return spans;
}

// Ghép hai bản theo vị trí đoạn; không suy đoán alignment khi khác số đoạn.
export function buildSegments(
  sourceText: string,
  originalChinese: string | null,
): SegmentDraft[] {
  const source = splitParagraphs(sourceText);

  const chinese =
    originalChinese === null ? null : splitParagraphs(originalChinese);

  if (!source.length) {
    throw new AppError(422, "EMPTY_CHAPTER", "Chương không có nội dung.");
  }

  if (source.length > 5000) {
    throw new AppError(
      422,
      "TOO_MANY_SEGMENTS",
      "Mỗi chương tối đa 5000 segment.",
    );
  }

  if (chinese && chinese.length !== source.length) {
    throw new AppError(
      422,
      "SEGMENT_ALIGNMENT_MISMATCH",
      "Hai bản phải có cùng số đoạn; hãy căn chỉnh trước khi nhập.",
      {
        sourceCount: source.length,
        chineseCount: chinese.length,
      },
    );
  }

  return source.map((span, index) => ({
    ...span,
    position: index + 1,
    originalChinese: chinese?.[index]?.sourceText ?? null,
  }));
}
