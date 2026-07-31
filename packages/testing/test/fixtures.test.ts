import {
  AgentEventSchema,
  AgentSessionSchema,
  ProviderStatusSchema,
  ReviewResultSchema,
} from "@dlh/shared";
import { describe, expect, it } from "vitest";

import {
  createAgentEventFixture,
  createAgentSessionFixture,
  createProviderStatusFixture,
  createReviewResultFixture,
} from "../src/index.js";

describe("test fixtures", () => {
  it("builds contract-valid deterministic defaults", () => {
    expect(() =>
      ProviderStatusSchema.parse(createProviderStatusFixture()),
    ).not.toThrow();
    expect(() =>
      AgentSessionSchema.parse(createAgentSessionFixture()),
    ).not.toThrow();
    expect(() =>
      AgentEventSchema.parse(createAgentEventFixture()),
    ).not.toThrow();
    expect(() =>
      ReviewResultSchema.parse(createReviewResultFixture()),
    ).not.toThrow();
  });
});
