const KIBIBYTE = 1_024;
const DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MILLISECONDS = 5_000;

export const DEFAULT_HTTP_RESOURCE_LIMITS = Object.freeze({
  maxRequestBodyBytes: 1_024 * KIBIBYTE,
  maxConcurrentRequests: 16,
  maxConcurrentStreams: 4,
  retryAfterSeconds: 1,
});

export interface HttpResourceLimits {
  readonly maxRequestBodyBytes: number;
  readonly maxConcurrentRequests: number;
  readonly maxConcurrentStreams: number;
  readonly retryAfterSeconds: number;
}

export type HttpResourceLimitOverrides = Partial<HttpResourceLimits>;
export type HttpRequestClass = "request" | "stream";

const trackedResponseWork = new WeakMap<Response, Promise<void>>();

const limitKeys = new Set<keyof HttpResourceLimits>([
  "maxRequestBodyBytes",
  "maxConcurrentRequests",
  "maxConcurrentStreams",
  "retryAfterSeconds",
]);

export function resolveHttpResourceLimits(
  overrides: HttpResourceLimitOverrides = {},
): HttpResourceLimits {
  for (const key of Object.keys(overrides)) {
    if (!limitKeys.has(key as keyof HttpResourceLimits)) {
      throw new Error(`Unknown HTTP resource limit: ${key}`);
    }
  }

  const limits = { ...DEFAULT_HTTP_RESOURCE_LIMITS, ...overrides };
  assertIntegerInRange(
    "maxRequestBodyBytes",
    limits.maxRequestBodyBytes,
    KIBIBYTE,
    8 * 1_024 * KIBIBYTE,
  );
  assertIntegerInRange(
    "maxConcurrentRequests",
    limits.maxConcurrentRequests,
    1,
    256,
  );
  assertIntegerInRange(
    "maxConcurrentStreams",
    limits.maxConcurrentStreams,
    1,
    32,
  );
  if (limits.maxConcurrentStreams > limits.maxConcurrentRequests) {
    throw new Error(
      "maxConcurrentStreams must not exceed maxConcurrentRequests",
    );
  }
  assertIntegerInRange("retryAfterSeconds", limits.retryAfterSeconds, 1, 60);
  return Object.freeze(limits);
}

export class HttpRequestAdmission {
  readonly #limits: HttpResourceLimits;
  #activeRequests = 0;
  #activeStreams = 0;
  #shuttingDown = false;
  #drainWaiters = new Set<() => void>();

  constructor(limits: HttpResourceLimits) {
    this.#limits = limits;
  }

  tryAcquire(requestClass: HttpRequestClass): (() => void) | null {
    if (
      this.#shuttingDown ||
      this.#activeRequests >= this.#limits.maxConcurrentRequests ||
      (requestClass === "stream" &&
        this.#activeStreams >= this.#limits.maxConcurrentStreams)
    ) {
      return null;
    }

    this.#activeRequests += 1;
    if (requestClass === "stream") this.#activeStreams += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#activeRequests -= 1;
      if (requestClass === "stream") this.#activeStreams -= 1;
      if (this.#activeRequests === 0) {
        for (const resolve of this.#drainWaiters) resolve();
        this.#drainWaiters.clear();
      }
    };
  }

  beginShutdown(): void {
    this.#shuttingDown = true;
  }

  async drain(
    timeoutMilliseconds = DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MILLISECONDS,
  ): Promise<void> {
    this.beginShutdown();
    if (this.#activeRequests === 0) return;
    if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1) {
      throw new Error(
        "HTTP admission drain timeout must be a positive integer",
      );
    }

    let resolveDrained!: () => void;
    const drained = new Promise<void>((resolve) => {
      resolveDrained = resolve;
    });
    this.#drainWaiters.add(resolveDrained);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Active HTTP request shutdown timed out")),
        timeoutMilliseconds,
      );
      timer.unref();
    });
    try {
      await Promise.race([drained, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
      this.#drainWaiters.delete(resolveDrained);
    }
  }
}

export class RequestBodyAdmissionError extends Error {
  readonly status: 400 | 413;

  constructor(status: 400 | 413, message: string) {
    super(message);
    this.name = "RequestBodyAdmissionError";
    this.status = status;
  }
}

export function assertBoundedContentLength(
  request: Request,
  maxBytes: number,
  tooLargeMessage = `Request body exceeds ${maxBytes} bytes`,
): number | null {
  const value = request.headers.get("Content-Length");
  if (value === null) return null;
  if (!/^(0|[1-9]\d*)$/u.test(value)) {
    throw new RequestBodyAdmissionError(400, "Content-Length is invalid");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RequestBodyAdmissionError(400, "Content-Length is invalid");
  }
  if (parsed > maxBytes) {
    throw new RequestBodyAdmissionError(413, tooLargeMessage);
  }
  return parsed;
}

export async function readBoundedRequestBody(
  request: Request,
  maxBytes: number,
  tooLargeMessage = `Request body exceeds ${maxBytes} bytes`,
): Promise<Uint8Array> {
  const declaredLength = assertBoundedContentLength(
    request,
    maxBytes,
    tooLargeMessage,
  );
  if (request.body === null) {
    if (declaredLength !== null && declaredLength !== 0) {
      throw new RequestBodyAdmissionError(400, "Content-Length is invalid");
    }
    return new Uint8Array();
  }

  const chunks: Uint8Array[] = [];
  const reader = request.body.getReader();
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (length + chunk.value.byteLength > maxBytes) {
        await reader.cancel();
        throw new RequestBodyAdmissionError(413, tooLargeMessage);
      }
      chunks.push(chunk.value);
      length += chunk.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  if (declaredLength !== null && declaredLength !== length) {
    throw new RequestBodyAdmissionError(400, "Content-Length is invalid");
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function requestWithReplayedBody(
  request: Request,
  body: Uint8Array,
): Request {
  return new Request(request, {
    body,
    signal: request.signal,
  });
}

export function responseWithRelease(
  response: Response,
  release: () => void,
): Response {
  if (response.body === null) {
    release();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          release();
          controller.close();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        release();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        release();
      }
    },
  });
  return new Response(body, response);
}

export function responseWithTrackedWork(
  response: Response,
  work: Promise<void>,
): Response {
  trackedResponseWork.set(response, work);
  return response;
}

export function trackedWorkForResponse(
  response: Response,
): Promise<void> | undefined {
  return trackedResponseWork.get(response);
}

function assertIntegerInRange(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be a safe integer from ${minimum} through ${maximum}`,
    );
  }
}
