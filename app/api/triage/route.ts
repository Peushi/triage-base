
import { llm, STRUCTURED_OUTPUT_MODE } from "../../../lib/llm";
import {
  PROMPT_VERSION,
  TRIAGE_SYSTEM_PROMPT,
  buildTriageUserPrompt,
} from "../../../lib/prompt";
import { TriageSchema } from "../../../lib/schema";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body." },
      { status: 400 }
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("ticket" in body) ||
    typeof body.ticket !== "string" ||
    body.ticket.trim() === ""
  ) {
    return Response.json(
      { error: "Please provide a non-empty ticket string." },
      { status: 400 }
    );
  }

  if (
    STRUCTURED_OUTPUT_MODE !== "prompt" &&
    STRUCTURED_OUTPUT_MODE !== "json_schema"
  ) {
    return Response.json(
      { error: "Invalid structured output configuration." },
      { status: 500 }
    );
  }

  try {
    const messages = [
      { role: "system" as const, content: TRIAGE_SYSTEM_PROMPT },
      { role: "user" as const, content: buildTriageUserPrompt(body.ticket) },
    ];

    const completion = await llm.chat.completions.create({
      model: process.env.LLM_MODEL!,
      messages,
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

    const raw = completion.choices[0]?.message?.content;

    if (!raw) {
      return Response.json(
        { error: "The AI returned an empty response." },
        { status: 502 }
      );
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      return Response.json(
        { error: "The AI returned invalid JSON." },
        { status: 502 }
      );
    }

    const validation = TriageSchema.safeParse(parsed);

    if (!validation.success) {
      console.error("Triage validation failed:", validation.error.issues);

      return Response.json(
        { error: "The AI response did not match the triage schema." },
        { status: 502 }
      );
    }

    console.log(`Triage prompt version: ${PROMPT_VERSION}`);

    return Response.json(validation.data);
  } catch (error) {
    console.error("Triage LLM API error:", error);

    return Response.json(
      { error: "Failed to triage the support ticket." },
      { status: 502 }
    );
  }
}
