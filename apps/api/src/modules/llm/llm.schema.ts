import { z } from "zod";

export const testLlmSchema = z.strictObject({
  model: z.string().trim().min(1).max(300).optional(),

  prompt: z.string().trim().min(1).max(16000),

  systemPrompt: z.string().trim().min(1).max(4000).optional(),

  temperature: z.number().min(0).max(2).default(0.2),

  maxTokens: z.number().int().min(1).max(1024).default(256),
});

export type TestLlmInput = z.infer<typeof testLlmSchema>;
