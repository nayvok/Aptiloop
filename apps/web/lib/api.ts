export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
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
    } | null;
    throw new ApiError(
      body?.error ?? `Request failed (${response.status})`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

export async function* streamAgent(
  body: Record<string, unknown>,
  signal?: AbortSignal,
): AsyncGenerator<{
  type: string;
  content?: string;
  message?: string;
  name?: string;
}> {
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
    throw new ApiError(`Stream failed (${response.status})`, response.status);
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
        yield JSON.parse(line.slice(5).trim()) as {
          type: string;
          content?: string;
          message?: string;
          name?: string;
        };
      }
    }

    if (done) break;
  }
}
