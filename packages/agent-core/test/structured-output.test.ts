import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  parseReviewResult,
  parseStructuredOutput,
  StructuredOutputError,
} from "../src/structured-output.js";

describe("parseStructuredOutput", () => {
  const schema = z.object({ value: z.number().int() });

  it("accepts fenced JSON", async () => {
    await expect(
      parseStructuredOutput(schema, '```json\n{"value": 2}\n```'),
    ).resolves.toEqual({ value: 2 });
  });

  it("performs at most one repair", async () => {
    const repair = vi.fn(async () => '{"value": 3}');
    await expect(
      parseStructuredOutput(schema, "not json", { repair }),
    ).resolves.toEqual({ value: 3 });
    expect(repair).toHaveBeenCalledOnce();
  });

  it("preserves raw diagnostic output after a failed repair", async () => {
    const promise = parseStructuredOutput(schema, "bad original", {
      repair: async () => "bad repair",
    });
    await expect(promise).rejects.toMatchObject({
      raw: "bad original",
      repairedRaw: "bad repair",
    });
  });

  it("validates reviewer semantics through the dedicated helper", async () => {
    const raw = JSON.stringify({
      status: "changes_requested",
      summary: "Needs work",
      findings: [],
      strengths: [],
      suggestedMasteryChanges: [],
    });
    await expect(parseReviewResult(raw)).rejects.toBeInstanceOf(
      StructuredOutputError,
    );
  });
});
