import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";

import { createApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createLlmClient } from "../src/modules/llm/llm.client.js";
import { LlmService } from "../src/modules/llm/llm.service.js";

type Mode = "ok" | "unloaded" | "empty" | "timeout" | "auth" | "no-models";

// Dùng HTTP server giả để kiểm tra cả SDK thay vì giả lập logic phân loại lỗi.
async function fixture(t: TestContext, mode: Mode = "ok", dbDown = false) {
  let calls = 0;
  let received: Record<string, unknown> = {};

  const upstream = createServer(async (req, res) => {
    calls++;

    res.setHeader("Content-Type", "application/json");

    if (mode === "timeout") {
      return;
    }

    if (mode === "auth") {
      res.writeHead(401).end(
        JSON.stringify({
          error: {
            message: "private upstream detail",
          },
        }),
      );

      return;
    }

    if (req.url === "/v1/models") {
      res.end(
        JSON.stringify({
          object: "list",
          data:
            mode === "no-models"
              ? []
              : [
                  {
                    id: "local-model",
                    object: "model",
                  },
                ],
        }),
      );

      return;
    }

    let raw = "";

    for await (const chunk of req) {
      raw += chunk.toString();
    }

    received = JSON.parse(raw);

    if (mode === "unloaded") {
      res.writeHead(400).end(
        JSON.stringify({
          error: {
            message: "No model loaded; private detail",
          },
        }),
      );

      return;
    }

    res.end(
      JSON.stringify({
        id: "probe",
        object: "chat.completion",
        created: 0,
        model: "local-model",

        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: mode === "empty" ? "" : "Xin chào",
            },
            finish_reason: "length",
          },
        ],

        usage: {
          prompt_tokens: 5,
          completion_tokens: 3,
          total_tokens: 8,
        },
      }),
    );
  });

  const upstreamURL = await listen(t, upstream);

  const client = createLlmClient(`${upstreamURL}/v1`, "lm-studio", 100);

  const llm = new LlmService(client, "local-model");

  const app = createApp({
    llm,
    webOrigin: "http://localhost:5173",

    checkDatabase: async () => {
      if (dbDown) {
        throw new Error("private DB credentials");
      }
    },
  });

  const apiURL = await listen(t, createServer(app));

  return {
    apiURL,
    upstream,
    llm,
    calls: () => calls,
    received: () => received,
  };
}

// Cấp cổng ngẫu nhiên và dọn socket để test timeout không làm treo tiến trình.
async function listen(t: TestContext, server: Server) {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  t.after(async () => {
    if (!server.listening) {
      return;
    }

    server.closeAllConnections();

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  const address = server.address() as AddressInfo;

  return `http://127.0.0.1:${address.port}`;
}

// Gửi request thật để xác minh schema, middleware và response cùng hoạt động.
function send(url: string, body: unknown) {
  return fetch(`${url}/api/llm/test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

test("health kiểm tra DB và không gọi LM Studio", async (t) => {
  const f = await fixture(t);

  const res = await fetch(`${f.apiURL}/api/health`);

  assert.equal(res.status, 200);
  assert.equal((await res.json()).data.database, "up");
  assert.equal(f.calls(), 0);
});

test("DB mất kết nối trả 503, không lộ thông tin nội bộ", async (t) => {
  const f = await fixture(t, "ok", true);

  const res = await fetch(`${f.apiURL}/api/health`);

  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, "DATABASE_UNAVAILABLE");
});

test("liệt kê model; danh sách trống vẫn là response hợp lệ", async (t) => {
  const f = await fixture(t);

  const res = await fetch(`${f.apiURL}/api/llm/models`);

  assert.deepEqual((await res.json()).data, [{ id: "local-model" }]);

  const empty = await fixture(t, "no-models");

  const emptyRes = await fetch(`${empty.apiURL}/api/llm/models`);

  assert.deepEqual((await emptyRes.json()).data, []);
});

test("prompt đi qua SDK, giữ model/params và báo kết quả bị cắt", async (t) => {
  const f = await fixture(t);

  const res = await send(f.apiURL, {
    model: "chosen-model",
    prompt: "Hello",
    systemPrompt: "Dịch",
    maxTokens: 20,
  });

  assert.equal(res.status, 200);

  const body = await res.json();

  assert.equal(body.data.content, "Xin chào");
  assert.equal(body.data.truncated, true);

  assert.equal(f.received().model, "chosen-model");
  assert.equal(f.received().max_tokens, 20);
  assert.equal(f.received().stream, false);

  assert.deepEqual(f.received().messages, [
    { role: "system", content: "Dịch" },
    { role: "user", content: "Hello" },
  ]);
});

test("schema từ chối prompt rỗng, sai kiểu và field ngoài hợp đồng", async (t) => {
  const f = await fixture(t);

  const invalidBodies = [
    { prompt: " " },
    { prompt: "Hi", maxTokens: "10" },
    { prompt: "Hi", baseURL: "http://other" },
  ];

  for (const body of invalidBodies) {
    const res = await send(f.apiURL, body);

    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, "VALIDATION_ERROR");
  }

  assert.equal(f.calls(), 0);
});

test("JSON sai và body quá lớn có mã lỗi ổn định", async (t) => {
  const f = await fixture(t);

  const cases = [
    ["{", 400, "INVALID_JSON"],
    [
      JSON.stringify({
        prompt: "x".repeat(140000),
      }),
      413,
      "BODY_TOO_LARGE",
    ],
  ] as const;

  for (const [body, status, code] of cases) {
    const res = await fetch(`${f.apiURL}/api/llm/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    });

    assert.equal(res.status, status);
    assert.equal((await res.json()).error.code, code);
  }
});

test("model chưa load/không hợp lệ được trả lỗi có kiểm soát", async (t) => {
  const f = await fixture(t, "unloaded");

  const res = await send(f.apiURL, {
    prompt: "Hi",
  });

  assert.equal(res.status, 502);

  const body = await res.json();

  assert.equal(body.error.code, "LLM_REQUEST_REJECTED");

  assert.equal(body.error.details.upstreamStatus, 400);

  assert.ok(!JSON.stringify(body).includes("private detail"));
});

test("API key sai và nội dung rỗng được phân loại", async (t) => {
  const cases = [
    ["auth", "LLM_AUTH_ERROR"],
    ["empty", "LLM_EMPTY_RESPONSE"],
  ] as const;

  for (const [mode, code] of cases) {
    const f = await fixture(t, mode);

    const res = await send(f.apiURL, {
      prompt: "Hi",
    });

    assert.equal(res.status, 502);
    assert.equal((await res.json()).error.code, code);
  }
});

test("timeout không retry và luôn giải phóng khóa inference", async (t) => {
  const f = await fixture(t, "timeout");

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await send(f.apiURL, {
      prompt: "Hi",
    });

    assert.equal(res.status, 504);
    assert.equal((await res.json()).error.code, "LLM_TIMEOUT");
  }

  assert.equal(f.calls(), 2);
});

test("server LM Studio tắt trả 503", async (t) => {
  const f = await fixture(t);

  await new Promise<void>((resolve) => {
    f.upstream.close(() => resolve());
  });

  const res = await send(f.apiURL, {
    prompt: "Hi",
  });

  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, "LLM_UNREACHABLE");
});

test("thiếu model bị từ chối trước khi gọi upstream", async (t) => {
  const f = await fixture(t);

  const llm = new LlmService(
    createLlmClient("http://127.0.0.1:1/v1", "x", 100),
    "",
  );

  await assert.rejects(
    llm.test({
      prompt: "Hi",
      temperature: 0.2,
      maxTokens: 20,
    }),
    { code: "MODEL_REQUIRED" },
  );

  assert.equal(f.calls(), 0);
});

test("chặn inference đồng thời và giải phóng khóa sau hủy", async (t) => {
  const f = await fixture(t, "timeout");

  const input = {
    prompt: "Hi",
    temperature: 0.2,
    maxTokens: 20,
  };

  const abort = new AbortController();

  const first = assert.rejects(f.llm.test(input, abort.signal), {
    code: "LLM_CANCELLED",
  });

  await assert.rejects(f.llm.test(input), { code: "LLM_BUSY" });

  abort.abort();

  await first;

  await assert.rejects(f.llm.test(input), { code: "LLM_TIMEOUT" });
});

test("env sai chỉ báo tên biến và không lộ secret", () => {
  assert.throws(
    () =>
      loadEnv({
        DATABASE_URL: "private-secret",
        LLM_BASE_URL: "wrong",
      }),

    (error: unknown) => {
      assert.ok(error instanceof Error);

      assert.ok(error.message.includes("DATABASE_URL"));

      assert.ok(!error.message.includes("private-secret"));

      return true;
    },
  );
});
