import { describe, expect, it } from "vitest";

import {
  HttpRequestAdmission,
  resolveHttpResourceLimits,
  responseWithRelease,
} from "../src/http-resource-admission.js";

describe("HTTP resource admission", () => {
  it("rejects invalid or internally inconsistent budgets", () => {
    expect(() => resolveHttpResourceLimits({ maxRequestBodyBytes: 0 })).toThrow(
      "maxRequestBodyBytes",
    );
    expect(() =>
      resolveHttpResourceLimits({
        maxConcurrentRequests: 1,
        maxConcurrentStreams: 2,
      }),
    ).toThrow("maxConcurrentStreams must not exceed maxConcurrentRequests");
    expect(() =>
      resolveHttpResourceLimits({ retryAfterSeconds: Number.NaN }),
    ).toThrow("retryAfterSeconds");
  });

  it("maintains a separate stream budget", () => {
    const admission = new HttpRequestAdmission(
      resolveHttpResourceLimits({
        maxConcurrentRequests: 2,
        maxConcurrentStreams: 1,
      }),
    );
    const releaseStream = admission.tryAcquire("stream");
    expect(releaseStream).not.toBeNull();
    expect(admission.tryAcquire("stream")).toBeNull();
    const releaseRequest = admission.tryAcquire("request");
    expect(releaseRequest).not.toBeNull();
    expect(admission.tryAcquire("request")).toBeNull();
    releaseStream?.();
    releaseRequest?.();
    expect(admission.tryAcquire("stream")).not.toBeNull();
  });

  it("rejects new work during shutdown and drains only after active work exits", async () => {
    const admission = new HttpRequestAdmission(resolveHttpResourceLimits());
    const release = admission.tryAcquire("request");
    expect(release).not.toBeNull();

    admission.beginShutdown();
    expect(admission.tryAcquire("request")).toBeNull();
    let drained = false;
    const drain = admission.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);

    release?.();
    await drain;
    expect(drained).toBe(true);
  });

  it("fails closed when active HTTP work does not drain before timeout", async () => {
    const admission = new HttpRequestAdmission(resolveHttpResourceLimits());
    const release = admission.tryAcquire("request");
    admission.beginShutdown();

    await expect(admission.drain(10)).rejects.toThrow(
      "Active HTTP request shutdown timed out",
    );
    expect(admission.tryAcquire("request")).toBeNull();
    release?.();
    await expect(admission.drain(10)).resolves.toBeUndefined();
  });

  it("releases a streamed response after complete consumption", async () => {
    let releases = 0;
    const response = responseWithRelease(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("bounded"));
            controller.close();
          },
        }),
      ),
      () => {
        releases += 1;
      },
    );
    expect(await response.text()).toBe("bounded");
    expect(releases).toBe(1);
  });

  it("releases a streamed response when the consumer cancels", async () => {
    let releases = 0;
    const response = responseWithRelease(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.enqueue(new Uint8Array([1]));
          },
        }),
      ),
      () => {
        releases += 1;
      },
    );
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(releases).toBe(1);
  });
});
