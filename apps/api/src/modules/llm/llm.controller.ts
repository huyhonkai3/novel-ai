import type { Request, Response } from "express";
import { testLlmSchema } from "./llm.schema.js";
import type { LlmService } from "./llm.service.js";

export class LlmController {
  constructor(private readonly service: LlmService) {}

  // Lấy model ID để người dùng chọn chính xác thay vì đoán tên file GGUF.
  models = async (_req: Request, res: Response) => {
    const data = await this.service.listModels();

    res.json({
      success: true,
      data,
    });
  };

  //   Hủy HTTP request upstream khi client ngắt kết nối để giảm inference dư thừa.
  test = async (req: Request, res: Response) => {
    const input = testLlmSchema.parse(req.body);
    const abort = new AbortController();

    const onClose = () => {
      // close cũng xảy ra sau khi response hoàn tất bình thường.
      if (!res.writableEnded) {
        abort.abort();
      }
    };

    res.once("close", onClose);

    try {
      const data = await this.service.test(input, abort.signal);

      if (!res.destroyed) {
        res.json({
          success: true,
          data,
        });
      }
    } finally {
      res.off("close", onClose);
    }
  };
}
