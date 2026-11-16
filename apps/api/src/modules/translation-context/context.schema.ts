import { z } from "zod";
import { textSchema } from "../../lib/content.schema.js";

const termSchema = textSchema
  .max(120)
  .transform((text) => text.trim().normalize("NFC"))
  .pipe(z.string().min(1).max(120));

export const glossaryInputSchema = z.strictObject({
  sourceTerm: termSchema,
  targetTerm: termSchema,
  notes: textSchema.max(400).nullable().default(null),
});

export const memoryQuerySchema = z.strictObject({
  q: textSchema.max(4_000),
});

export type GlossaryInput = z.infer<typeof glossaryInputSchema>;

// Dùng cùng quy tắc khi lưu, dò trong nguồn và xử lý glossary từ request.
export function normalizeTerm(text: string) {
  return text.trim().normalize("NFC").toLowerCase();
}
