import { AgentRoleSchema } from "@dlh/shared";
import { describe, expect, it } from "vitest";

import {
  getLatestPrompt,
  getPrompt,
  listPromptVersions,
  promptDefinitions,
  PromptDefinitionSchema,
} from "../src/index.js";

describe("versioned prompt contracts", () => {
  it("contains exactly one valid v1 prompt for every agent role", () => {
    expect(promptDefinitions).toHaveLength(8);
    expect(new Set(promptDefinitions.map((prompt) => prompt.role))).toEqual(
      new Set(AgentRoleSchema.options),
    );
    for (const prompt of promptDefinitions) {
      expect(PromptDefinitionSchema.safeParse(prompt).success).toBe(true);
      expect(listPromptVersions(prompt.role)).toEqual(["v1.0.0"]);
      expect(getPrompt(prompt.role, "v1.0.0")).toBe(prompt);
      expect(getLatestPrompt(prompt.role)).toBe(prompt);
    }
  });

  it("keeps non-negotiable safety clauses in every prompt", () => {
    for (const prompt of promptDefinitions) {
      expect(prompt.systemPrompt).toContain("Never invent facts");
      expect(prompt.systemPrompt).toContain(
        "Do not do the learner's assigned work",
      );
      expect(prompt.systemPrompt).toContain("ALLOWED BEHAVIOR");
      expect(prompt.systemPrompt).toContain("FORBIDDEN BEHAVIOR");
      expect(prompt.systemPrompt).toContain("RESULT FORMAT");
      expect(prompt.systemPrompt).toContain("HONESTY AND CONTEXT");
    }
  });

  it("keeps reviewer read-only", () => {
    const prompt = getLatestPrompt("reviewer").systemPrompt;
    expect(prompt).toContain("Never apply patches");
    expect(prompt).toContain("without modifying the workspace");
  });
});
