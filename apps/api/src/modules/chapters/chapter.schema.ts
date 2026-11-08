import { z } from "zod";

import {
  numberSchema,
  textSchema,
  titleSchema,
} from "../../lib/content.schema.js";

export const createChapterSchema = z.strictObject({
  number: numberSchema,
  title: titleSchema,
  sourceText: textSchema,

  originalChinese: textSchema.nullable().default(null),
});

export const updateChapterSchema = z
  .strictObject({
    version: numberSchema.max(2147483646),
    number: numberSchema.optional(),
    title: titleSchema.optional(),
    sourceText: textSchema.optional(),

    originalChinese: textSchema.nullable().optional(),
  })
  .refine(
    (value) => Object.keys(value).some((key) => key !== "version"),
    "Cần trường cập nhật ngoài version.",
  );

// Multipart gửi metadata dạng chuỗi; JSON vẫn bắt buộc number đúng kiểu.
export const importChapterSchema = z.strictObject({
  number: z
    .string()
    .regex(/^[1-9]\d{0,9}$/)
    .transform(Number)
    .pipe(numberSchema),

  title: titleSchema,
});

export type CreateChapterInput = z.infer<typeof createChapterSchema>;

export type UpdateChapterInput = z.infer<typeof updateChapterSchema>;
