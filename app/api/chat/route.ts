import { llm } from "../../../lib/llm";

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

  try {
    const completion = await llm.chat.completions.create({
      model: process.env.LLM_MODEL!,
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant. Answer clearly and concisely.",
        },
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