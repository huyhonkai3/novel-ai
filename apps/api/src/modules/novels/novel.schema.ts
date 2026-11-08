import { z } from "zod";
import { titleSchema } from "../../lib/content.schema.js";

export const createNovelSchema = z.strictObject({
  title: titleSchema,

  description: z.string().trim().max(10000).nullable().default(null),
});

// PATCH không kế thừa default(null), tránh xóa description khi chỉ sửa title.
export const updateNovelSchema = z
  .strictObject({
    title: titleSchema.optional(),

    description: z.string().trim().max(10000).nullable().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Cần ít nhất một trường để cập nhật.",
  );

export type CreateNovelInput = z.infer<typeof createNovelSchema>;

export type UpdateNovelInput = z.infer<typeof updateNovelSchema>;
