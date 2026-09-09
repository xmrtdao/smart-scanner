const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";
const MODEL = "openai/gpt-6-astra";

type ContentBlock =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string };

export async function askAstraJson<T>(args: {
  instructions: string;
  content: ContentBlock[];
  schemaName: string;
  schema: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
}): Promise<T> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("AI is not configured yet.");

  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
    },
    body: JSON.stringify({
      model: MODEL,
      instructions: args.instructions,
      input: [{ role: "user", content: args.content }],
      reasoning: { effort: args.effort ?? "low" },
      text: {
        format: {
          type: "json_schema",
          name: args.schemaName,
          strict: true,
          schema: args.schema,
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("Too many requests right now — wait a moment and try again.");
    if (res.status === 402) throw new Error("AI credits are used up. Add credits to keep scanning.");
    throw new Error(`AI request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };

  const text =
    data.output_text ??
    data.output
      ?.flatMap((o) => o.content ?? [])
      .map((c) => c.text ?? "")
      .join("") ??
    "";

  if (!text.trim()) throw new Error("The AI returned an empty response. Try again.");
  return JSON.parse(text) as T;
}
