
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomInt } from "node:crypto";
import { TriageSchema } from "../../../lib/schema";

type Dataset = "labelled" | "unlabelled";

type Ticket = {
  ticket_id: string;
  subject?: string;
  body?: string;
  category?: string;
  priority?: string;
};

function mockPrediction(ticket: Ticket) {
  // Placeholder predictions for testing the smoke test runner.
  // These are NOT real model predictions.
  const subject = ticket.subject?.trim() ?? "";
  const text = `${subject} ${ticket.body ?? ""}`.toLowerCase();

  let category: "billing" | "technical_bug" | "account" | "feature_request";
  let priority: "low" | "medium" | "high";

  if (/refund|invoice|charged|billing|payment/.test(text)) {
    category = "billing";
    priority = "medium";
  } else if (/password|login|account|sign in/.test(text)) {
    category = "account";
    priority = "medium";
  } else if (/feature|would like|please add|suggestion/.test(text)) {
    category = "feature_request";
    priority = "low";
  } else {
    category = "technical_bug";
    priority = "low";
  }

  return {
    category,
    priority,
    summary: subject || "Support ticket requiring review",
    suggested_action:
      category === "billing"
        ? "Review the customer's billing details."
        : category === "account"
          ? "Review the customer's account issue."
          : category === "feature_request"
            ? "Review the feature request."
            : "Investigate the reported issue.",
  };
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("dataset" in body) ||
    (body.dataset !== "labelled" && body.dataset !== "unlabelled") ||
    !("sampleSize" in body) ||
    typeof body.sampleSize !== "number" ||
    !Number.isInteger(body.sampleSize) ||
    body.sampleSize < 1 ||
    body.sampleSize > 500
  ) {
    return Response.json(
      {
        error:
          "Choose a valid dataset and a sample size between 1 and 500.",
      },
      { status: 400 },
    );
  }

  const dataset = body.dataset as Dataset;
  const filename =
    dataset === "labelled"
      ? "support_tickets_100_labelled.json"
      : "support_tickets_500.json";

  try {
    const filePath = path.join(process.cwd(), "data", filename);
    const file = await readFile(filePath, "utf8");
    const tickets = JSON.parse(file) as Ticket[];

    if (!Array.isArray(tickets)) {
      return Response.json(
        { error: "The selected dataset has an invalid format." },
        { status: 500 },
      );
    }

    if (body.sampleSize > tickets.length) {
      return Response.json(
        {
          error: `This dataset contains only ${tickets.length} tickets.`,
        },
        { status: 400 },
      );
    }

    // Select a random sample without replacement.
    const remaining = [...tickets];
    const sample: Ticket[] = [];

    for (let i = 0; i < body.sampleSize; i++) {
      const index = randomInt(remaining.length);
      sample.push(remaining[index]);
      remaining.splice(index, 1);
    }

    const results = sample.map((ticket) => {
      const prediction = TriageSchema.parse(mockPrediction(ticket));

      const isLabelled =
        dataset === "labelled" &&
        typeof ticket.category === "string" &&
        typeof ticket.priority === "string";

      return {
        ticketId: ticket.ticket_id,
        subject: ticket.subject?.trim() || "Untitled support ticket",
        prediction,
        expected: isLabelled
          ? {
              category: ticket.category,
              priority: ticket.priority,
            }
          : null,
        categoryMatch: isLabelled
          ? prediction.category === ticket.category
          : null,
        priorityMatch: isLabelled
          ? prediction.priority === ticket.priority
          : null,
        latencyMs: 0,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
        },
      };
    });

    const labelledResults = results.filter(
      (result) => result.expected !== null,
    );

    const categoryCorrect = labelledResults.filter(
      (result) => result.categoryMatch === true,
    ).length;

    const priorityCorrect = labelledResults.filter(
      (result) => result.priorityMatch === true,
    ).length;

    return Response.json({
      mode: "mock",
      dataset,
      sampleSize: results.length,
      accuracy: {
        category:
          labelledResults.length > 0
            ? categoryCorrect / labelledResults.length
            : null,
        priority:
          labelledResults.length > 0
            ? priorityCorrect / labelledResults.length
            : null,
      },
      results,
      note: "Mock predictions only. These are not real model accuracy results.",
    });
  } catch (error) {
    console.error("Smoke test failed:", error);

    return Response.json(
      { error: "Could not load or process the smoke test dataset." },
      { status: 500 },
    );
  }
}
