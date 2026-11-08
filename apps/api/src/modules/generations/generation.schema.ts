import { z } from "zod";
import { textSchema } from "../../lib/content.schema.js";

export const generationParametersSchema = z.strictObject({
  temperature: z.number().min(0).max(2).default(0.2),
  maxTokens: z.number().int().min(64).max(4096).default(2048),
});

export const generateSegmentSchema = generationParametersSchema.extend({
  // Bắt buộc khớp version mà frontend đã đọc ở B2.
  chapterVersion: z.number().int().min(1).max(2147483647),

  model: textSchema
    .max(200)
    .transform((value) => value.trim())
    .optional(),

  context: textSchema.max(2000).optional(),

  glossary: z
    .array(
      z.strictObject({
        source: textSchema.max(120),
        target: textSchema.max(120),
      }),
    )
    .max(30)
    .default([]),
});

export const promptMessagesSchema = z.array(
  z.strictObject({
    role: z.enum(["system", "user"]),
    content: z.string(),
  }),
);

export type GenerateSegmentInput = z.infer<typeof generateSegmentSchema>;

export type GenerationParameters = z.infer<typeof generationParametersSchema>;

export type PromptMessage = z.infer<typeof promptMessagesSchema>[number];
