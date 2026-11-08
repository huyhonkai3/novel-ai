import { z } from "zod";

export const idSchema = z.uuid();

export const titleSchema = z.string().trim().min(1).max(300);

export const numberSchema = z.number().int().min(1).max(2147483647);

// PostgreSQL không nhận NUL.
// Lone surrogate sẽ bị thay ký tự khi encode UTF-8, làm mất tính nguyên trạng.
export const textSchema = z
  .string()
  .max(1_000_000)
  .refine(
    (text) =>
      text.trim().length > 0 &&
      !text.includes("\0") &&
      !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        text,
      ),
    "Văn bản phải có nội dung, Unicode hợp lệ và không chứa NUL.",
  );

export const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),

  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PageInput = z.infer<typeof pageSchema>;

// Dùng cùng quy ước offset cho các API phân trang.
export function pageArgs(page: PageInput) {
  return {
    skip: (page.page - 1) * page.pageSize,
    take: page.pageSize,
  };
}
