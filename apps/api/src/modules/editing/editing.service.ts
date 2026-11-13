import type { PageInput } from "../../lib/content.schema.js";
import type { EditingRepository } from "./editing.repository.js";

import type {
  ApproveInput,
  RestoreInput,
  ReviewGenerationInput,
  SaveDraftInput,
} from "./editing.schema.js";

type RepositoryPort = Pick<
  EditingRepository,
  "read" | "write" | "history"
>;

export class EditingService {
  constructor(private readonly repo: RepositoryPort) { }

  // Trả draft và final cùng version mà client phải dùng khi ghi.
  get(segmentId: string) {
    return this.repo.read(segmentId)
  }

  // Lưu bản sửa thành revision mới, giữ provenance từ draft trước.
  saveDraft(segmentId: string, input: SaveDraftInput) {
    return this.repo.write(segmentId, input, {
      type: "SAVE_DRAFT",
      text: input.text,
    })
  }

  // Accept đưa output vào draft; Reject chỉ lưu sự kiện đánh giá.
  review(
    segmentId: string,
    generationId: string,
    input: ReviewGenerationInput
  ) {
    return this.repo.write(segmentId, input, {
      type: input.decision,
      generationId,
    })
  }

  // Chỉ thao tác này được đổi con trỏ bản đã duyệt.
  approve(segmentId: string, input: ApproveInput) {
    return this.repo.write(segmentId, input, {
      type: "APPROVE",
      revisionId: input.revisionId
    })
  }

  // Khôi phục bằng cách tạo draft mới, không sửa revision lịch sử.
  restore(segmentId: string, input: RestoreInput) {
    return this.repo.write(segmentId, input, {
      type: "RESTORE",
      revisionId: input.revisionId
    })
  }

  // Hỗ trợ lịch sử theo segment hoặc theo toàn chương.
  history(
    where: { segmentKey?: string; chapterId?: string },
    page: PageInput,
  ) {
    return this.repo.history(where, page);
  }
}
