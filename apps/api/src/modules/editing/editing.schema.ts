import { z } from "zod";
import {
  idSchema,
  textSchema,
} from "../../lib/content.schema.js";

export const editGuardSchema = z.strictObject({
  chapterVersion: z.number().int().min(1).max(2147483647),

  // Chừa một đơn vị để lần ghi tiếp theo không vượt PostgreSQL Int.
  editVersion: z.number().int().min(0).max(2147483646),
});

export const saveDraftSchema = editGuardSchema.extend({
  // Không trim nội dung vì cần giữ newline và khoảng trắng người dùng nhập.
  text: textSchema.max(100_000),
});

export const approveSchema = editGuardSchema.extend({
  // Duyệt chính xác revision đang hiển thị, không duyệt draft mới hơn.
  revisionId: idSchema,
});

export const restoreSchema = editGuardSchema.extend({
  revisionId: idSchema,
});

export const reviewGenerationSchema = editGuardSchema.extend({
  decision: z.enum(["ACCEPT", "REJECT"]),
});

export type EditGuard = z.infer<typeof editGuardSchema>;
export type SaveDraftInput = z.infer<typeof saveDraftSchema>;
export type ApproveInput = z.infer<typeof approveSchema>;
export type RestoreInput = z.infer<typeof restoreSchema>;
export type ReviewGenerationInput = z.infer<
  typeof reviewGenerationSchema
>;
