
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomInt, randomUUID } from "node:crypto";
import { TriageSchema, type TriageResult } from "../../../lib/schema";
import {
  PROMPT_VERSION,
  TRIAGE_SYSTEM_PROMPT,
  buildTriageUserPrompt,
} from "../../../lib/prompt";
import { STRUCTURED_OUTPUT_MODE, llm } from "../../../lib/llm";
import { classifyWithDecisionModel } from "../../../lib/decision-model";
import {
  saveSmokeRun,
  type SmokeRun,
} from "../../../lib/smoke-test-history";

type Dataset = "labelled" | "unlabelled";
type Strategy = "llm" | "dm" | "dm+llm";

type Ticket = {
  ticket_id: string;
  subject?: string;
  body?: string;
  category?: string;
  priority?: string;
};

type TestResult = {
  ticketId: string;
  subject: string;
  prediction: TriageResult;
  expected: {
    category: string;
    priority: string;
  } | null;
  categoryMatch: boolean | null;
  priorityMatch: boolean | null;
  latencyMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

function redactSensitiveText(text: string): string {
  return text
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[REDACTED_EMAIL]",
    )
    .replace(
      /\b(?:\+?\d[\d ().-]{7,}\d)\b/g,
      "[REDACTED_PHONE]",
    )
    .replace(
      /\b(?:sk-vsr-|nvapi-)[A-Za-z0-9_-]+\b/g,
      "[REDACTED_KEY]",
    )
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]");
}

async function predictWithLlm(ticketText: string): Promise<{
  prediction: TriageResult;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}> {
  const start = performance.now();

  const model = process.env.LLM_MODEL;

  if (!model) {
    throw new Error("LLM_MODEL is missing from .env.local.");
  }

  const completion = await llm.chat.completions.create({
    model,
    max_tokens: 300,
    reasoning_effort: "low",
    messages: [
      { role: "system", content: TRIAGE_SYSTEM_PROMPT },
      { role: "user", content: buildTriageUserPrompt(ticketText) },
    ],
    ...(STRUCTURED_OUTPUT_MODE === "json_schema"
      ? {
          response_format: {
            type: "json_schema" as const,
            json_schema: {
              name: "support_triage",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  category: {
                    type: "string",
                    enum: [
                      "billing",
                      "technical_bug",
                      "account",
                      "feature_request",
                    ],
                  },
                  priority: {
                    type: "string",
                    enum: ["low", "medium", "high"],
                  },
                  summary: { type: "string" },
                  suggested_action: { type: "string" },
                },
                required: [
                  "category",
                  "priority",
                  "summary",
                  "suggested_action",
                ],
                additionalProperties: false,
              },
            },
          },
        }
      : {}),
  });

  const latencyMs = Math.round(performance.now() - start);
  const raw = completion.choices[0]?.message?.content;

  if (!raw) {
    throw new Error("The LLM returned an empty response.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The LLM returned invalid JSON.");
  }

  const validation = TriageSchema.safeParse(parsed);

  if (!validation.success) {
    throw new Error("The LLM response did not match the triage schema.");
  }

  console.log(`Triage prompt version: ${PROMPT_VERSION}`);

  return {
    prediction: validation.data,
    model,
    latencyMs,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
  };
}

function makeDmSummary(
  category: TriageResult["category"],
  subject: string,
): Pick<TriageResult, "summary" | "suggested_action"> {
  const summaries = {
    billing: "The ticket concerns a billing or payment issue.",
    technical_bug: "The ticket reports a technical problem.",
    account: "The ticket concerns an account or access issue.",
    feature_request: "The ticket requests a feature or product improvement.",
  };

  const actions = {
    billing:
      "Review the billing records and investigate the reported payment issue.",
    technical_bug:
      "Reproduce the issue, inspect relevant logs, and investigate a fix.",
    account:
      "Verify the account securely and investigate the access issue.",
    feature_request:
      "Record the request and evaluate it against product priorities.",
  };

  return {
    summary: subject.trim() || summaries[category],
    suggested_action: actions[category],
  };
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null) {
    return Response.json(
      { error: "Request body must be an object." },
      { status: 400 },
    );
  }

  const input = body as Record<string, unknown>;
  const datasetInput = input.dataset;
  const strategyInput = input.strategy ?? "dm";
  const sampleSizeInput = input.sampleSize;

  if (
    datasetInput !== "labelled" &&
    datasetInput !== "unlabelled"
  ) {
    return Response.json(
      { error: "Choose a valid dataset." },
      { status: 400 },
    );
  }

  const dataset: Dataset = datasetInput;

  if (
    strategyInput !== "llm" &&
    strategyInput !== "dm" &&
    strategyInput !== "dm+llm"
  ) {
    return Response.json(
      { error: "Choose llm, dm, or dm+llm strategy." },
      { status: 400 },
    );
  }

  const strategy: Strategy = strategyInput;

  if (
    typeof sampleSizeInput !== "number" ||
    !Number.isInteger(sampleSizeInput) ||
    sampleSizeInput < 1 ||
    sampleSizeInput > (dataset === "labelled" ? 100 : 500)
  ) {
    return Response.json(
      {
        error: `Sample size must be between 1 and ${
          dataset === "labelled" ? 100 : 500
        } for this dataset.`,
      },
      { status: 400 },
    );
  }

  const sampleSize = sampleSizeInput;

  const filename =
    dataset === "labelled"
      ? "support_tickets_100_labelled.json"
      : "support_tickets_500.json";

  try {
    const filePath = path.join(process.cwd(), "data", filename);
    const parsedTickets: unknown = JSON.parse(
      await readFile(filePath, "utf8"),
    );

    if (!Array.isArray(parsedTickets)) {
      return Response.json(
        { error: "The selected dataset is not a valid array." },
        { status: 400 },
      );
    }

    const tickets = parsedTickets as Ticket[];

    if (sampleSize > tickets.length) {
      return Response.json(
        { error: "The selected dataset is invalid or too small." },
        { status: 400 },
      );
    }

    // Select a random sample without replacement.
    const remaining = [...tickets];
    const sample: Ticket[] = [];

    for (let i = 0; i < sampleSize; i++) {
      const index = randomInt(remaining.length);
      sample.push(remaining[index]);
      remaining.splice(index, 1);
    }

    const results: TestResult[] = [];

    let actualModel =
      strategy === "dm"
        ? "vllm-sr/d3-flash"
        : process.env.LLM_MODEL ?? "unknown-llm";

    for (const ticket of sample) {
      const subject = ticket.subject?.trim() ?? "";

      const ticketText = redactSensitiveText(
        `Subject: ${subject}\nTicket: ${ticket.body ?? ""}`,
      );

      const start = performance.now();

      let prediction: TriageResult;
      let inputTokens = 0;
      let outputTokens = 0;
      let latencyMs = 0;

      if (strategy === "llm") {
        const llmResult = await predictWithLlm(ticketText);

        prediction = llmResult.prediction;
        inputTokens = llmResult.inputTokens;
        outputTokens = llmResult.outputTokens;
        latencyMs = llmResult.latencyMs;
        actualModel = llmResult.model;
      } else {
        const dmResult = await classifyWithDecisionModel(ticketText);

        inputTokens += dmResult.inputTokens;
        outputTokens += dmResult.outputTokens;
        latencyMs += dmResult.latencyMs;
        actualModel = dmResult.model;

        if (strategy === "dm+llm") {
          const llmResult = await predictWithLlm(ticketText);

          inputTokens += llmResult.inputTokens;
          outputTokens += llmResult.outputTokens;
          latencyMs += llmResult.latencyMs;

          prediction = {
            ...llmResult.prediction,
            category: dmResult.category,
            priority: dmResult.priority,
          };

          actualModel = `${dmResult.model} + ${llmResult.model}`;
        } else {
          prediction = {
            category: dmResult.category,
            priority: dmResult.priority,
            ...makeDmSummary(dmResult.category, subject),
          };
        }
      }

      if (latencyMs === 0) {
        latencyMs = Math.round(performance.now() - start);
      }

      const isLabelled =
        dataset === "labelled" &&
        typeof ticket.category === "string" &&
        typeof ticket.priority === "string";

      results.push({
        ticketId: ticket.ticket_id,
        subject: subject || "Untitled support ticket",
        prediction: TriageSchema.parse(prediction),
        expected: isLabelled
          ? {
              category: ticket.category!,
              priority: ticket.priority!,
            }
          : null,
        categoryMatch: isLabelled
          ? prediction.category === ticket.category
          : null,
        priorityMatch: isLabelled
          ? prediction.priority === ticket.priority
          : null,
        latencyMs,
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
      });
    }

    const labelledResults = results.filter(
      (result) => result.expected !== null,
    );

    const categoryCorrect = labelledResults.filter(
      (result) => result.categoryMatch === true,
    ).length;

    const priorityCorrect = labelledResults.filter(
      (result) => result.priorityMatch === true,
    ).length;

    const accuracy = {
      category: labelledResults.length
        ? categoryCorrect / labelledResults.length
        : null,
      priority: labelledResults.length
        ? priorityCorrect / labelledResults.length
        : null,
    };

    const categoryCounts = {
      billing: 0,
      technical_bug: 0,
      account: 0,
      feature_request: 0,
    };

    const priorityCounts = {
      low: 0,
      medium: 0,
      high: 0,
    };

    for (const result of results) {
      categoryCounts[result.prediction.category]++;
      priorityCounts[result.prediction.priority]++;
    }

    const totalInputTokens = results.reduce(
      (sum, result) => sum + result.usage.inputTokens,
      0,
    );

    const totalOutputTokens = results.reduce(
      (sum, result) => sum + result.usage.outputTokens,
      0,
    );

    const averageLatencyMs = Math.round(
      results.reduce((sum, result) => sum + result.latencyMs, 0) /
        results.length,
    );

    const run: SmokeRun = {
      runId: randomUUID(),
      createdAt: new Date().toISOString(),
      dataset,
      sampleSize: results.length,
      categoryAccuracy: accuracy.category,
      priorityAccuracy: accuracy.priority,
      categoryMismatches: labelledResults.length
        ? labelledResults.length - categoryCorrect
        : null,
      priorityMismatches: labelledResults.length
        ? labelledResults.length - priorityCorrect
        : null,
      categoryCounts,
      priorityCounts,
      averageLatencyMs,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      estimatedCostUsd: null,
      model: actualModel,
      strategy,
      mode: "live",
    };

    await saveSmokeRun(run);

    return Response.json({
      mode: "live",
      strategy,
      model: actualModel,
      dataset,
      sampleSize: results.length,
      accuracy,
      results,
      runId: run.runId,
      note:
        strategy === "dm"
          ? "Decision 3.0 supplied category and priority; summary and action are deterministic templates."
          : strategy === "dm+llm"
            ? "Decision 3.0 supplied category and priority; the LLM supplied the summary and suggested action."
            : "The NVIDIA LLM supplied the full triage prediction.",
    });
  } catch (error) {
    console.error("Smoke test failed:", error);

    const message =
      error instanceof Error ? error.message : "Unknown error.";

    return Response.json(
      { error: `Smoke test failed: ${message}` },
      { status: 502 },
    );
  }
}
