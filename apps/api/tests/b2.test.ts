import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { Router } from "express";

import { createApp } from "../src/app.js";
import { textSchema } from "../src/lib/content.schema.js";

import { createLlmClient } from "../src/modules/llm/llm.client.js";
import { LlmService } from "../src/modules/llm/llm.service.js";

import { updateNovelSchema } from "../src/modules/novels/novel.schema.js";

import { createChapterSchema } from "../src/modules/chapters/chapter.schema.js";
import { createChapterCollectionRouter } from "../src/modules/chapters/chapter.routes.js";
import { ChapterService } from "../src/modules/chapters/chapter.service.js";
import { decodeText } from "../src/modules/chapters/chapter.upload.js";

import {
  buildSegments,
  splitParagraphs,
} from "../src/modules/segments/segmenter.js";

const novelId = "10000000-0000-4000-8000-000000000001";

const chapterId = "10000000-0000-4000-8000-000000000002";

type Repo = ConstructorParameters<typeof ChapterService>[0];

// Chỉ thay repository; schema, service, multipart và middleware chạy thật.
async function fixture(t: TestContext) {
  let captured: Parameters<Repo["create"]> | undefined;

  const unused = async (): Promise<never> => {
    throw new Error("Không được gọi trong test này");
  };

  const repo: Repo = {
    list: unused,
    find: unused,
    update: unused,
    segments: unused,
    delete: unused,

    create: async (...args) => {
      captured = args;

      return {
        id: chapterId,
        novelId: args[0],
        number: args[1].number,
        title: args[1].title,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: {
          segments: args[2].length,
        },
      };
    },
  };

  const contentRouter = Router();

  contentRouter.use(
    "/novels/:novelId/chapters",
    createChapterCollectionRouter(new ChapterService(repo)),
  );

  const app = createApp({
    llm: new LlmService(
      createLlmClient("http://127.0.0.1:1/v1", "test", 100),
      "test",
    ),

    checkDatabase: async () => {},
    webOrigin: "http://localhost:5173",
    contentRouter,
  });

  const server = createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  t.after(async () => {
    server.closeAllConnections();

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}` + `/api/novels/${novelId}/chapters`,

    captured: () => captured,
  };
}

// Tạo đúng hợp đồng multipart của endpoint import.
function form(buffer: Uint8Array, name = "chapter.md") {
  const data = new FormData();

  data.set("number", "1");
  data.set("title", "Chương 1");

  data.set("sourceFile", new Blob([Buffer.from(buffer)]), name);

  return data;
}

test("segment round-trip giữ nguyên newline, indent, BOM và emoji", () => {
  for (const newline of ["\n", "\r\n", "\r"]) {
    const text =
      `\uFEFF${newline}` +
      `  Đoạn 😀.  ${newline}${newline}` +
      `\t${newline}` +
      `“Xin chào!”${newline}` +
      `“Chào.”${newline}${newline}`;

    const parts = splitParagraphs(text);

    assert.equal(parts.length, 2);

    assert.equal(parts.map((part) => part.sourceText).join(""), text);

    let offset = 0;

    for (const part of parts) {
      assert.equal(part.startOffset, offset);

      assert.equal(
        text.slice(part.startOffset, part.endOffset),
        part.sourceText,
      );

      offset = part.endOffset;
    }

    assert.equal(offset, text.length);
  }
});

test("không tách câu hoặc nhóm hội thoại khi chưa có dòng trống", () => {
  const text = "Một. Hai!\n— Xin chào.\n— Chào bạn.";

  assert.deepEqual(
    splitParagraphs(text).map((part) => part.sourceText),
    [text],
  );
});

test("bản Trung được căn theo vị trí và từ chối khác số đoạn", () => {
  const result = buildSegments("Một\n\nHai", "一\r\n\r\n二");

  assert.deepEqual(
    result.map((part) => part.position),
    [1, 2],
  );

  assert.equal(
    result.map((part) => part.originalChinese).join(""),
    "一\r\n\r\n二",
  );

  assert.throws(() => buildSegments("Một\n\nHai", "一"), {
    code: "SEGMENT_ALIGNMENT_MISMATCH",
  });
});

test("giới hạn số segment và không tạo segment chỉ chứa whitespace", () => {
  assert.deepEqual(splitParagraphs(" \r\n\t\r\n"), []);

  assert.throws(() => buildSegments(" \n", null), {
    code: "EMPTY_CHAPTER",
  });

  assert.throws(() => buildSegments(Array(5001).fill("x").join("\n\n"), null), {
    code: "TOO_MANY_SEGMENTS",
  });
});

test("UTF-8 lỗi bị từ chối; BOM và byte hợp lệ không bị mất", () => {
  const buffer = Buffer.from("\uFEFF你好\r\n\r\nXin chào 😀", "utf8");

  assert.deepEqual(Buffer.from(decodeText(buffer), "utf8"), buffer);

  assert.throws(() => decodeText(Buffer.from([0xc3, 0x28])), {
    code: "INVALID_UTF8",
  });
});

test("schema giữ nguyên văn bản và từ chối dữ liệu không lưu chính xác được", () => {
  const text = "  Một\r\n\r\nHai  ";

  assert.equal(textSchema.parse(text), text);

  for (const invalid of [" ", "x\0y", "\uD800", "\uDC00"]) {
    assert.equal(textSchema.safeParse(invalid).success, false);
  }

  assert.equal(
    createChapterSchema.safeParse({
      title: "A",
      number: "1",
      sourceText: "A",
    }).success,
    false,
  );

  assert.deepEqual(
    updateNovelSchema.parse({
      title: "Mới",
    }),
    {
      title: "Mới",
    },
  );
});

test("JSON chương lớn hơn 128 KB vẫn qua parser dành cho nội dung", async (t) => {
  const f = await fixture(t);
  const sourceText = "a".repeat(150000);

  const res = await fetch(f.url, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      number: 1,
      title: "A",
      sourceText,
    }),
  });

  assert.equal(res.status, 201);

  assert.equal(f.captured()?.[1].sourceText, sourceText);
});

test("multipart đi qua validation và lưu đúng văn bản sau decode", async (t) => {
  const f = await fixture(t);
  const text = "\uFEFF  Một\r\n\r\nHai 😀  ";

  const res = await fetch(`${f.url}/import`, {
    method: "POST",
    body: form(Buffer.from(text)),
  });

  assert.equal(res.status, 201);

  assert.equal(f.captured()?.[1].sourceText, text);

  assert.equal(
    f
      .captured()?.[2]
      .map((part) => part.sourceText)
      .join(""),
    text,
  );
});

test("import từ chối extension sai, UTF-8 lỗi và file vượt giới hạn", async (t) => {
  const f = await fixture(t);

  const cases = [
    [form(Buffer.from("A"), "chapter.exe"), 415, "UNSUPPORTED_FILE"],

    [form(new Uint8Array([0xc3, 0x28])), 422, "INVALID_UTF8"],

    [
      form(new Uint8Array(2 * 1024 * 1024 + 1).fill(65)),
      413,
      "LIMIT_FILE_SIZE",
    ],
  ] as const;

  for (const [body, status, code] of cases) {
    const res = await fetch(`${f.url}/import`, {
      method: "POST",
      body,
    });

    assert.equal(res.status, status);

    assert.equal((await res.json()).error.code, code);
  }

  assert.equal(f.captured(), undefined);
});

test("alignment sai bị từ chối trước khi gọi repository", async (t) => {
  const f = await fixture(t);

  const res = await fetch(f.url, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      number: 1,
      title: "A",
      sourceText: "A\n\nB",
      originalChinese: "一",
    }),
  });

  assert.equal(res.status, 422);

  assert.equal((await res.json()).error.code, "SEGMENT_ALIGNMENT_MISMATCH");

  assert.equal(f.captured(), undefined);
});
