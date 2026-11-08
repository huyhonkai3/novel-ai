import { AppError } from "../../lib/app-error.js";
import type { PageInput } from "../lib/content.schema.js";
import type { NovelRepository } from "./novel.repository.js";

import type { CreateNovelInput, UpdateNovelInput } from "./novel.schema.js";

export class NovelService {
  constructor(private readonly repo: NovelRepository) {}

  // Đóng gói kết quả và thông phân trang thống nhất.
  async list(page: PageInput) {
    const [data, total] = await this.repo.list(page);

    return {
      data,
      meta: {
        ...page,
        total,
      },
    };
  }

  // Phân biệt truyện không tồn tại với truyện chưa có chương.
  async get(id: string) {
    const novel = await this.repo.find(id);

    if (!novel) {
      throw new AppError(404, "NOVEL_NOT_FOUND", "Không tìm thấy truyện.");
    }

    return novel;
  }

  // Metadata truyện
  create(input: CreateNovelInput) {
    return this.repo.create(input);
  }

  update(id: string, input: UpdateNovelInput) {
    return this.repo.update(id, input);
  }

  delete(id: string) {
    return this.repo.delete(id);
  }
}
