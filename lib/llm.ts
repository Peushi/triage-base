
import OpenAI from "openai";

export const llm = new OpenAI({
  baseURL: process.env.LLM_BASE_URL,
  apiKey: process.env.LLM_API_KEY,
});

export const STRUCTURED_OUTPUT_MODE =
  process.env.LLM_STRUCTURED_OUTPUT ?? "prompt";
