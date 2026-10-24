
import { z } from "zod";

const CategorySchema = z.enum([
  "billing",
  "technical_bug",
  "account",
  "feature_request",
]);

const PrioritySchema = z.enum(["low", "medium", "high"]);

const DecisionResponseSchema = z.object({
  model: z.string().optional(),
  answers: z.object({
    category: z.object({ choice: z.string() }),
    priority: z.object({ choice: z.string() }),
  }),
  usage: z.object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
  }).optional(),
});

export type DecisionClassification = {
  category: z.infer<typeof CategorySchema>;
  priority: z.infer<typeof PrioritySchema>;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
};

export async function classifyWithDecisionModel(
  ticketText: string,
): Promise<DecisionClassification> {
  const apiKey = process.env.DECISION_API_KEY;

  if (!apiKey) {
    throw new Error("DECISION_API_KEY is missing from .env.local.");
  }

  const start = performance.now();

  const response = await fetch(
    "https://decision.vllm-sr.ai/v1/systemone",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "vllm-sr/d3-flash",
        state: ticketText,
        questions: {
          category: {
            type: "choice",
            instructions: "Which category best describes this support ticket?",
            criteria: {
              billing: "Payments, invoices, charges, refunds, or subscriptions",
              technical_bug: "A software malfunction, error, or broken feature",
              account: "Login, password, profile, or account access",
              feature_request: "A request for a new capability or improvement",
            },
          },
          priority: {
            type: "choice",
            instructions: "What is the appropriate support priority?",
            criteria: {
              low: "Minor issue, little impact, or a reasonable workaround",
              medium: "Normal issue affecting a user or a limited group",
              high: "Critical outage, security concern, or major business impact",
            },
          },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("Decision 3.0 request failed:", response.status, detail);
    throw new Error(`Decision 3.0 returned HTTP ${response.status}.`);
  }

  const raw: unknown = await response.json();
  const parsed = DecisionResponseSchema.safeParse(raw);

  if (!parsed.success) {
    throw new Error("Decision 3.0 returned an unexpected response format.");
  }

  const category = CategorySchema.safeParse(
    parsed.data.answers.category.choice,
  );
  const priority = PrioritySchema.safeParse(
    parsed.data.answers.priority.choice,
  );

  if (!category.success || !priority.success) {
    throw new Error("Decision 3.0 returned an unsupported category or priority.");
  }

  return {
    category: category.data,
    priority: priority.data,
    model: parsed.data.model ?? "vllm-sr/d3-flash",
    latencyMs: Math.round(performance.now() - start),
    inputTokens: parsed.data.usage?.input_tokens ?? 0,
    outputTokens: parsed.data.usage?.output_tokens ?? 0,
  };
}
