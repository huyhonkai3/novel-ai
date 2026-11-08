import type { PrismaClient } from "../../generated/prisma/client.js";

import {
  pageArgs,
  type PageInput,
} from "../../lib/content.schema.js";

import type {
  CreateNovelInput,
  UpdateNovelInput,
} from "./novel.schema.js";

export class NovelRepository {
  constructor (private readonly db: PrismaClient) {}

  // Count và danh sách dùng chung snapshot khi có thay đổi đồng thời.
  list(page: PageInput) {
    return this.db.$transaction(
      [
        this.db.novel.findMany({
          ...pageArgs(page),
          orderBy: [
            {createdAt: "desc"},
            {id: "desc"}
          ],
        }),
        this.db.novel.count(),
      ],
      {
        isolationLevel: "RepeatableRead",
      }
    )
  }

  // Chỉ lấy metadata truyện; nội dung chương có API riêng.
  find(id: string) {
    return this.db.novel.findUnique({
      where: {id},
      include: {
        _count: {
          select: {
            chapters: true,
          }
        }
      }
    })
  }

  // Lưu truyện mới.
  create(data: CreateNovelInput) {
    return this.db.novel.create({ data })
  }

  // Prisma ném P2025 nếu truyện không còn tồn tại.
  update(id: string, data: UpdateNovelInput) {
    return this.db.novel.update({
      where: { id },
      data,
    })
  }

  // FK cascade xóa cả chương và segment thuộc truyện.
  delete(id: string) {
    return this.db.novel.delete({
      where: { id }
    })
  }
}