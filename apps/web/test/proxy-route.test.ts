import http from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/[...path]/route";

describe("API proxy configured origin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts configured browser origin for internal Next URL and rejects aliases", async () => {
    const requests: string[] = [];
    const fixture = http.createServer((request, response) => {
      requests.push(`${request.method} ${request.url}`);
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            method: request.method,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      fixture.listen(0, "127.0.0.1", resolve),
    );
    const address = fixture.address();
    if (!address || typeof address === "string")
      throw new Error("fixture did not expose a port");

    try {
      vi.stubEnv("WEB_ORIGIN", "http://127.0.0.1:43123");
      vi.stubEnv("ORCHESTRATOR_URL", `http://127.0.0.1:${address.port}`);
      const internalUrl = "http://localhost:43123/api/proof/upload?proof=1";
      const accepted = await POST(
        new Request(internalUrl, {
          method: "POST",
          headers: {
            Origin: "http://127.0.0.1:43123",
            "content-type": "text/plain",
          },
          body: "proxy-payload",
        }),
        { params: Promise.resolve({ path: ["proof", "upload"] }) },
      );
      expect(accepted.status).toBe(200);
      await expect(accepted.json()).resolves.toEqual({
        method: "POST",
        body: "proxy-payload",
      });

      const alias = await POST(
        new Request(internalUrl, {
          method: "POST",
          headers: { Origin: "http://localhost:43123" },
          body: "blocked",
        }),
        { params: Promise.resolve({ path: ["proof", "upload"] }) },
      );
      const crossOrigin = await POST(
        new Request(internalUrl, {
          method: "POST",
          headers: { Origin: "http://evil.example" },
          body: "blocked",
        }),
        { params: Promise.resolve({ path: ["proof", "upload"] }) },
      );
      expect(alias.status).toBe(403);
      expect(crossOrigin.status).toBe(403);
      expect(requests).toEqual(["POST /api/proof/upload?proof=1"]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        fixture.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
