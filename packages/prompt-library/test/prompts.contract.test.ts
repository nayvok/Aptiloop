import { AgentRoleSchema } from "@aptiloop/shared";
import { describe, expect, it } from "vitest";

import {
  getLatestPrompt,
  getLatestWorkflowPrompt,
  getPrompt,
  listPromptVersions,
  promptDefinitions,
  PromptDefinitionSchema,
} from "../src/index.js";

describe("versioned prompt contracts", () => {
  it("contains one agent prompt per role plus the required workflow prompts", () => {
    expect(promptDefinitions).toHaveLength(11);
    expect(new Set(promptDefinitions.map((prompt) => prompt.role))).toEqual(
      new Set(AgentRoleSchema.options),
    );
    for (const prompt of promptDefinitions) {
      expect(PromptDefinitionSchema.safeParse(prompt).success).toBe(true);
      expect(getLatestWorkflowPrompt(prompt.id)).toBe(prompt);
      if (prompt.id === prompt.role) {
        expect(listPromptVersions(prompt.role)).toEqual(["v1.1.0"]);
        expect(getPrompt(prompt.role, "v1.1.0")).toBe(prompt);
        expect(getLatestPrompt(prompt.role)).toBe(prompt);
      }
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
      expect(prompt.systemPrompt).toContain("DEPTH LEVEL");
      expect(prompt.systemPrompt).toContain(
        "Always respond to the learner in Russian",
      );
      expect(prompt.systemPrompt).toContain("STRUCTURED OUTPUT SCHEMA");
      expect(prompt.contextPolicy).toBeTruthy();
      expect(prompt.structuredOutputSchema).toBeTruthy();
    }
  });

  it("keeps generation prompts away from protected answers and learner solutions", () => {
    expect(getLatestPrompt("teacher").contextPolicy).toContain(
      "Never receive the protected reference answer",
    );
    expect(getLatestPrompt("interviewer").contextPolicy).toContain(
      "no rubric/reference answer",
    );
    expect(
      getLatestWorkflowPrompt("exercise-generator").systemPrompt,
    ).toContain("Do not emit the implementation");
    expect(
      getLatestWorkflowPrompt("curriculum-reviewer").systemPrompt,
    ).toContain("Do not publish");
    expect(getLatestPrompt("course-designer").systemPrompt).toContain(
      "Do not apply, publish, install",
    );
  });

  it("keeps reviewer read-only", () => {
    const prompt = getLatestPrompt("reviewer").systemPrompt;
    expect(prompt).toContain("Never apply patches");
    expect(prompt).toContain("without modifying the workspace");
  });
});
