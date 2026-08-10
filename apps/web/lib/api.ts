import { z } from "zod";

export const BrowserAgentEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("message.delta"),
      turnId: z.string().min(1),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("message.completed"),
      turnId: z.string().min(1),
      content: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      turnId: z.string().min(1),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("session.completed"),
      turnId: z.string().min(1),
      reason: z.enum(["completed", "failed", "cancelled"]),
    })
    .strict(),
]);

export type BrowserAgentEvent = z.infer<typeof BrowserAgentEventSchema>;

export function parseBrowserAgentEvent(data: string): BrowserAgentEvent | null {
  try {
    const result = BrowserAgentEventSchema.safeParse(JSON.parse(data));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly failure?: {
      code: string;
      retryable: boolean;
      messageKey: string;
      diagnosticId: string;
      recoveryAction: string | null;
    },
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-DLH-Client": "web",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      failure?: ConstructorParameters<typeof ApiError>[2];
    } | null;
    throw new ApiError(
      body?.error ?? `Request failed (${response.status})`,
      response.status,
      body?.failure,
    );
  }

  return (await response.json()) as T;
}

export async function* streamAgent(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): AsyncGenerator<BrowserAgentEvent> {
  const response = await fetch("/api/agent/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DLH-Client": "web",
    },
    body: JSON.stringify(body),
    signal: signal ?? null,
  });

  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      failure?: ConstructorParameters<typeof ApiError>[2];
    } | null;
    throw new ApiError(
      body?.error ?? `Stream failed (${response.status})`,
      response.status,
      body?.failure,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame
        .split("\n")
        .find((candidate) => candidate.startsWith("data:"));
      if (line) {
        const event = parseBrowserAgentEvent(line.slice(5).trim());
        if (!event) {
          throw new ApiError("Agent stream returned an invalid event", 502);
        }
        yield event;
      }
    }

    if (done) break;
  }
}
