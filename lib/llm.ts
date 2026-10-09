import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: process.env.LLM_BASE_URL,
  apiKey: process.env.LLM_API_KEY
}); 

export const llm = openai;