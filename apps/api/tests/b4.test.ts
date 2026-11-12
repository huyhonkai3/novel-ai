import assert from "node:assert/strict";
import { test } from "node:test";

import {
  planRevision,
  type EditorState,
  type GenerationCandidate,
} from "../src/modules/editing/editing.policy.js";

const state: EditorState = {
  id: "segment-a",
  sourceText: "Hello",
  originalChinese: null,
  draftRevision: {
    id: "revision-a",
    segmentKey: "segment-a",
    text: "Xin chào",
    generationId: "generation-a",
  },
};

const generation: GenerationCandidate = {
  id: "generation-a",
  segmentKey: "segment-a",
  sourceText: "Hello",
  originalChinese: null,
  status: "SUCCEEDED",
  output: "Chào bạn",
};

test("lưu draft giữ provenance và không cập nhật bản duyệt", () => {
  const result = planRevision(state, {
    type: "SAVE_DRAFT",
    text: "Chào anh",
  });

  assert.equal(result.setDraft, true);
  assert.equal(result.setApproved, false);
  assert.equal(result.generationId, "generation-a");
  assert.equal(result.parentRevisionId, "revision-a");
});

test("duyệt đúng draft và không sửa draft", () => {
  const result = planRevision(state, {
    type: "APPROVE",
    revisionId: "revision-a",
  });

  assert.equal(result.text, "Xin chào");
  assert.equal(result.setApproved, true);
  assert.equal(result.setDraft, false);
});

test("từ chối duyệt draft cũ hoặc chưa có draft", () => {
  assert.throws(
    () =>
      planRevision(state, {
        type: "APPROVE",
        revisionId: "old",
      }),
    { code: "DRAFT_CHANGED" },
  );

  assert.throws(
    () =>
      planRevision(
        { ...state, draftRevision: null },
        { type: "APPROVE", revisionId: "old" },
      ),
    { code: "DRAFT_CHANGED" },
  );
});

test("Accept chỉ tạo draft, không tự approve", () => {
  const result = planRevision(
    state,
    { type: "ACCEPT", generationId: generation.id },
    { generation },
  );

  assert.equal(result.text, "Chào bạn");
  assert.equal(result.setDraft, true);
  assert.equal(result.setApproved, false);
});

test("không Accept output bị cắt, lỗi hoặc rỗng", () => {
  const candidates = [
    { ...generation, status: "TRUNCATED" },
    { ...generation, status: "FAILED" },
    { ...generation, output: " " },
  ];

  for (const candidate of candidates) {
    assert.throws(
      () =>
        planRevision(
          state,
          { type: "ACCEPT", generationId: candidate.id },
          { generation: candidate },
        ),
      { code: "GENERATION_NOT_ACCEPTABLE" },
    );
  }
});

test("chặn generation khác segment hoặc khác nguồn", () => {
  assert.throws(
    () =>
      planRevision(
        state,
        { type: "ACCEPT", generationId: generation.id },
        {
          generation: {
            ...generation,
            segmentKey: "other",
          },
        },
      ),
    { code: "GENERATION_NOT_FOUND" },
  );

  assert.throws(
    () =>
      planRevision(
        state,
        { type: "ACCEPT", generationId: generation.id },
        {
          generation: {
            ...generation,
            sourceText: "Changed",
          },
        },
      ),
    { code: "GENERATION_SOURCE_CHANGED" },
  );
});

test("Reject không ghi đè draft/final", () => {
  const result = planRevision(
    state,
    { type: "REJECT", generationId: generation.id },
    { generation },
  );

  assert.equal(result.kind, "AI_REJECT");
  assert.equal(result.text, null);
  assert.equal(result.setDraft, false);
  assert.equal(result.setApproved, false);
});

test("Restore lấy snapshot cũ làm draft mới", () => {
  const revision = {
    id: "old",
    segmentKey: state.id,
    text: "Chào",
    generationId: null,
  };

  const result = planRevision(
    state,
    { type: "RESTORE", revisionId: revision.id },
    { revision },
  );

  assert.equal(result.text, "Chào");
  assert.equal(result.parentRevisionId, "old");
  assert.equal(result.generationId, null);
  assert.equal(result.setApproved, false);
});

test("không Restore revision khác segment hoặc event Reject", () => {
  const revision = {
    id: "old",
    segmentKey: "other",
    text: "Chào",
    generationId: null,
  };

  assert.throws(
    () =>
      planRevision(
        state,
        { type: "RESTORE", revisionId: revision.id },
        { revision },
      ),
    { code: "REVISION_NOT_FOUND" },
  );

  assert.throws(
    () =>
      planRevision(
        state,
        { type: "RESTORE", revisionId: revision.id },
        {
          revision: {
            ...revision,
            segmentKey: state.id,
            text: null,
          },
        },
      ),
    { code: "REVISION_NOT_RESTORABLE" },
  );
});
