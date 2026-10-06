// Shared helpers for the Lovable AI Gateway Responses endpoint (/v1/responses).
//
// Why this exists: function tools must be sent through /v1/responses (the
// chat-completions endpoint on this gateway serves text generation only), and the
// gateway is stateless — every call must resend the whole input with store:false.
// Two or more edge functions import this, so it lives in _shared.
const RESPONSES_URL = "https://ai.gateway.lovable.dev/v1/responses";

/** Chat-completions style tool declaration, as the app's functions already declare them. */
export type ChatTool = {
  type: string;
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
};

export type ResponsesInputItem = Record<string, unknown>;

export function toResponsesTool(tool: ChatTool) {
  return {
    type: "function",
    name: tool.function.name,
    description: tool.function.description ?? "",
    parameters: tool.function.parameters ?? { type: "object", properties: {} },
  };
}

function normalizeToolChoice(choice: unknown): unknown {
  if (choice && typeof choice === "object") {
    const c = choice as Record<string, any>;
    if (c.function?.name) return { type: "function", name: c.function.name };
    if (c.type === "function" && c.name) return { type: "function", name: c.name };
  }
  return choice ?? "auto";
}

/** A user turn. `input_text` parts belong only on user/system/developer items. */
export function userTextItem(text: string): ResponsesInputItem {
  return { role: "user", content: [{ type: "input_text", text }] };
}

/** An assistant turn replayed from persisted text (never `input_text` on assistant items). */
export function assistantTextItem(text: string): ResponsesInputItem {
  return { role: "assistant", content: [{ type: "output_text", text }] };
}

/** A tool result. It must be preceded in `input` by the matching `function_call` item. */
export function functionCallOutputItem(callId: string, output: string): ResponsesInputItem {
  return { type: "function_call_output", call_id: callId, output };
}

export interface ResponsesCallOptions {
  apiKey: string;
  model: string;
  instructions: string;
  input: ResponsesInputItem[];
  tools?: ChatTool[];
  toolChoice?: unknown;
  stream?: boolean;
  effort?: "low" | "medium" | "high";
}

/**
 * Builds and sends a Responses request. `store: false` is mandatory on every call
 * (the gateway never persists), and reasoning is requested with its encrypted
 * content so the next step can resend the item inline instead of by id.
 */
export function responsesRequest(opts: ResponsesCallOptions): Promise<Response> {
  const body: Record<string, unknown> = {
    model: opts.model,
    instructions: opts.instructions,
    input: opts.input,
    store: false,
    reasoning: { effort: opts.effort ?? "low" },
    include: ["reasoning.encrypted_content"],
    stream: opts.stream ?? false,
  };
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map(toResponsesTool);
    body.tool_choice = normalizeToolChoice(opts.toolChoice);
  }
  return fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** Tool calls the model asked for, in the order the API returned them. */
export function extractFunctionCalls(json: unknown): Array<{ name: string; arguments: string; callId: string }> {
  const items = Array.isArray((json as any)?.output) ? (json as any).output : [];
  return items
    .filter((item: any) => item?.type === "function_call")
    .map((item: any) => ({
      name: typeof item.name === "string" ? item.name : "",
      arguments: typeof item.arguments === "string" ? item.arguments : "{}",
      callId: item.call_id ?? item.id ?? "",
    }));
}

export function extractFirstFunctionCall(json: unknown) {
  return extractFunctionCalls(json)[0] ?? null;
}

/**
 * Replays the reasoning and function_call items of a response verbatim, in order,
 * so the next step can pair every `function_call_output` with its `function_call`.
 */
export function appendResponseItems(input: ResponsesInputItem[], json: unknown): void {
  const items = Array.isArray((json as any)?.output) ? (json as any).output : [];
  for (const item of items) {
    if (item && (item.type === "reasoning" || item.type === "function_call")) input.push(item);
  }
}
