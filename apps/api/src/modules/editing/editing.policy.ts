import { AppError } from "../../lib/app-error.js";

export type EditCommand =
  | { type: "SAVE_DRAFT"; text: string }
  | { type: "ACCEPT"; generationId: string }
  | { type: "REJECT"; generationId: string }
  | { type: "RESTORE"; revisionId: string }
  | { type: "APPROVE"; revisionId: string };
export interface RevisionCandidate {
  id: string;
  segmentKey: string;
  text: string | null;
  generationId: string | null;
}

export interface GenerationCandidate {
  id: string;
  segmentKey: string;
  sourceText: string;
  originalChinese: string | null;
  status: string;
  output: string;
}

export interface EditorState {
  id: string;
  sourceText: string;
  originalChinese: string | null;
  draftRevision: RevisionCandidate | null;
}

export interface RevisionPlan {
  kind: "MANUAL" | "AI_ACCEPT" | "AI_REJECT" | "RESTORE" | "APPROVE";
  text: string | null;
  generationId: string | null;
  parentRevisionId: string | null;
  setDraft: boolean;
  setApproved: boolean;
}

// Quyết định thay đổi bằng dữ liệu đã khóa; không gọi DB hoặc LLM.
export function planRevision(
  state: EditorState,
  command: EditCommand,
  candidates: {
    generation?: GenerationCandidate | null;
    revision?: RevisionCandidate | null;
  } = {},
): RevisionPlan {
  const draft = state.draftRevision;

  const base: RevisionPlan = {
    kind: "MANUAL",
    text: null,
    generationId: draft?.generationId ?? null,
    parentRevisionId: draft?.id ?? null,
    setDraft: false,
    setApproved: false,
  };

  if (command.type === "SAVE_DRAFT") {
    return {
      ...base,
      text: command.text,
      setDraft: true,
    };
  }

  if (command.type === "APPROVE") {
    if (
      !draft ||
      draft.id !== command.revisionId ||
      !draft.text?.trim()
    ) {
      throw new AppError(
        409,
        "DRAFT_CHANGED",
        "Draft đã thay đổi hoặc chưa có nội dung.",
      );
    }

    return {
      ...base,
      kind: "APPROVE",
      text: draft.text,
      setApproved: true,
    };
  }

  if (command.type === "RESTORE") {
    const revision = candidates.revision;

    if (
      !revision ||
      revision.id !== command.revisionId ||
      revision.segmentKey !== state.id
    ) {
      throw new AppError(
        404,
        "REVISION_NOT_FOUND",
        "Không tìm thấy revision của segment này.",
      );
    }

    if (revision.text === null || !revision.text.trim()) {
      throw new AppError(
        409,
        "REVISION_NOT_RESTORABLE",
        "Revision này không chứa bản dịch để khôi phục.",
      );
    }

    return {
      ...base,
      kind: "RESTORE",
      text: revision.text,
      generationId: revision.generationId,
      parentRevisionId: revision.id,
      setDraft: true,
    };
  }

  const generation = candidates.generation;

  if (
    !generation ||
    generation.id !== command.generationId ||
    generation.segmentKey !== state.id
  ) {
    throw new AppError(
      404,
      "GENERATION_NOT_FOUND",
      "Không tìm thấy generation của segment này.",
    );
  }

  if (
    generation.sourceText !== state.sourceText ||
    generation.originalChinese !== state.originalChinese
  ) {
    throw new AppError(
      409,
      "GENERATION_SOURCE_CHANGED",
      "Nguồn của generation không khớp segment hiện tại.",
    );
  }

  if (command.type === "REJECT") {
    if (
      !["SUCCEEDED", "TRUNCATED", "FAILED"].includes(generation.status)
    ) {
      throw new AppError(
        409,
        "GENERATION_NOT_FINISHED",
        "Generation chưa kết thúc.",
      );
    }

    // Reject chỉ ghi quyết định; không xóa draft hay bản đã duyệt.
    return {
      ...base,
      kind: "AI_REJECT",
      generationId: generation.id,
    };
  }

  if (
    generation.status !== "SUCCEEDED" ||
    !generation.output.trim()
  ) {
    throw new AppError(
      409,
      "GENERATION_NOT_ACCEPTABLE",
      "Chỉ Accept generation hoàn tất và có nội dung.",
    );
  }

  return {
    ...base,
    kind: "AI_ACCEPT",
    text: generation.output,
    generationId: generation.id,
    setDraft: true,
  };
}
