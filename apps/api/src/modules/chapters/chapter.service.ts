import { AppError } from "../../lib/app-error.js";
import type { PageInput } from "../../lib/content.schema.js";
import { buildSegments } from "../segments/segmenter.js";
import type { ChapterRepository } from "./chapter.repository.js";

import type {
  CreateChapterInput,
  UpdateChapterInput,
} from "./chapter.schema.js";

type ChapterRepositoryPort = Pick<
  ChapterRepository,
  "list" | "find" | "create" | "update" | "segments" | "delete"
>;

export class ChapterService {
  constructor(private readonly repo: ChapterRepositoryPort) {}

  // Sắp xếp theo số chương, không theo thời điểm nhập.
  async list(novelId: string, page: PageInput) {
    const novel = await this.repo.list(novelId, page);

    if (!novel) {
      throw new AppError(404, "NOVEL_NOT_FOUND", "Không tìm thấy truyện.");
    }

    return {
      data: novel.chapters,
      meta: {
        ...page,
        total: novel._count.chapters,
      },
    };
  }

  //   Dùng chung kiểm tra tồn tại cho detail và update.
  async get(id: string) {
    const chapter = await this.repo.find(id);

    if (!chapter) {
      throw new AppError(404, "CHAPTER_NOT_FOUND", "Không tìm thấy chương.");
    }

    return chapter;
  }

  //   Kiểm tra alignment trước khi ghi để không tạo chương dở dang.
  create(novelId: string, input: CreateChapterInput) {
    const segments = buildSegments(input.sourceText, input.originalChinese);

    return this.repo.create(novelId, input, segments);
  }

  //   Chỉ tạo lại segment khi gửi văn bản; sửa metadata giữ nguyên segment ID.
  async update(id: string, input: UpdateChapterInput) {
    const current = await this.get(id);

    if (current.version !== input.version) {
      throw new AppError(
        409,
        "CHAPTER_VERSION_CONFLICT",
        "Chương đã thay đổi; tải lại trước khi cập nhật.",
      );
    }

    const { version, ...data } = input;

    const contentChanged =
      input.sourceText !== undefined || input.originalChinese !== undefined;

    const segments = contentChanged
      ? buildSegments(
          input.sourceText ?? current.sourceText,

          input.originalChinese === undefined
            ? current.originalChinese
            : input.originalChinese,
        )
      : undefined;

    return this.repo.update(id, version, data, segments);
  }

  // Trả version để client phát hiện chương thay đổi giữa các trang segment.
  async segments(id: string, page: PageInput) {
    const chapter = await this.repo.segments(id, page);

    if (!chapter) {
      throw new AppError(404, "CHAPTER_NOT_FOUND", "Không tìm thấy chương.");
    }

    return {
      data: chapter.segments,
      meta: {
        ...page,
        total: chapter._count.segments,
        chapterId: id,
        version: chapter.version,
      },
    };
  }

  //   Repository để DB xử lý xóa dây chuyền.
  delete(id: string) {
    return this.repo.delete(id);
  }
}
