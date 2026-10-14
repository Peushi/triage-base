
import { llm } from "../../../lib/llm";

type HistoryMessage = {
  role: "user" | "assistant";
  text: string;
};

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
    !("message" in body) ||
    typeof body.message !== "string" ||
    body.message.trim() === ""
  ) {
    return Response.json(
      { error: "Please provide a non-empty message string." },
      { status: 400 }
    );
  }

  let history: HistoryMessage[] = [];

  if ("history" in body && body.history !== undefined) {
    if (
      !Array.isArray(body.history) ||
      !body.history.every(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          "role" in item &&
          (item.role === "user" || item.role === "assistant") &&
          "text" in item &&
          typeof item.text === "string"
      )
    ) {
      return Response.json(
        { error: "Invalid conversation history." },
        { status: 400 }
      );
    }

    history = body.history;
  }

  try {
    const completion = await llm.chat.completions.create({
      model: process.env.LLM_MODEL!,
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant. Answer clearly and concisely.",
        },
        ...history.map((item) => ({
          role: item.role,
          content: item.text,
        })),
        {
          role: "user",
          content: body.message,
        },
      ],
    });

    return Response.json({
      answer: completion.choices[0]?.message?.content ?? "",
    });
  } catch (error) {
    console.error("LLM API error:", error);

    return Response.json(
      { error: "Failed to get a response from the AI." },
      { status: 502 }
    );
  }
}
