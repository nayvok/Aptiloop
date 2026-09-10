import {
  validateLoopbackHttpOrigin,
  validateOrchestratorUrl,
} from "../../../orchestrator-url";

const ALLOWED_METHODS: Readonly<Record<string, true>> = {
  GET: true,
  HEAD: true,
  POST: true,
  PUT: true,
  PATCH: true,
  DELETE: true,
  OPTIONS: true,
};
const HOP_BY_HOP_HEADERS: Readonly<Record<string, true>> = {
  connection: true,
  "keep-alive": true,
  "proxy-authenticate": true,
  "proxy-authorization": true,
  te: true,
  trailer: true,
  "transfer-encoding": true,
  upgrade: true,
  "content-length": true,
};
const FORWARDED_REQUEST_HEADERS: Readonly<Record<string, true>> = {
  accept: true,
  "accept-encoding": true,
  "accept-language": true,
  "cache-control": true,
  "content-type": true,
  "content-disposition": true,
  "if-match": true,
  "if-none-match": true,
  origin: true,
  "user-agent": true,
  "x-aptiloop-client": true,
};
const FORWARDED_RESPONSE_HEADERS: Readonly<Record<string, true>> = {
  "cache-control": true,
  "content-disposition": true,
  "content-type": true,
  etag: true,
  "last-modified": true,
  location: true,
  "retry-after": true,
  vary: true,
  "x-content-type-options": true,
};

function orchestratorOrigin(): string {
  return validateOrchestratorUrl(process.env);
}

function configuredWebOrigin(request: Request): string {
  const configured = process.env.WEB_ORIGIN;
  return configured
    ? validateLoopbackHttpOrigin(configured, "WEB_ORIGIN")
    : new URL(request.url).origin;
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origin === configuredWebOrigin(request);
}

function requestHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (
      name !== "x-aptiloop-client" &&
      FORWARDED_REQUEST_HEADERS[name] &&
      !HOP_BY_HOP_HEADERS[name]
    )
      headers.set(name, value);
  }
  headers.set("x-aptiloop-client", "web");
  return headers;
}

function responseHeaders(response: Response): Headers {
  const headers = new Headers();
  for (const [name, value] of response.headers) {
    if (FORWARDED_RESPONSE_HEADERS[name] && !HOP_BY_HOP_HEADERS[name])
      headers.set(name, value);
  }
  return headers;
}

async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  if (!ALLOWED_METHODS[request.method])
    return Response.json(
      { error: "Method not allowed" },
      {
        status: 405,
        headers: { Allow: Object.keys(ALLOWED_METHODS).join(", ") },
      },
    );
  if (!isSameOrigin(request))
    return Response.json(
      { error: "Cross-origin API requests are not allowed" },
      { status: 403 },
    );
  const { path: segments } = await context.params;
  if (
    !Array.isArray(segments) ||
    segments.length === 0 ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  )
    return Response.json({ error: "Invalid API path" }, { status: 400 });
  const upstream = new URL(
    `/api/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`,
    `${orchestratorOrigin()}/`,
  );
  upstream.search = new URL(request.url).search;
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: requestHeaders(request),
    redirect: "manual",
    signal: request.signal,
  };
  if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
    init.body = request.body;
    init.duplex = "half";
  }
  let response: Response;
  try {
    response = await fetch(upstream, init);
  } catch {
    return Response.json(
      { error: "Orchestrator is unavailable" },
      { status: 503 },
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders(response),
  });
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
