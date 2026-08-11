import {
  AptiloopAiRoleSchema,
  AptiloopToolNameSchema,
  ToolPolicySchema,
  type AptiloopAiRole,
  type AptiloopToolName,
  type ToolPolicy,
} from "@aptiloop/shared";
import type { z } from "zod";

import { ProviderHubError } from "./provider-hub.js";

export interface AptiloopToolContext {
  readonly operationId: string;
  readonly role: AptiloopAiRole;
  readonly courseId?: string;
  readonly revisionId?: string;
  readonly activityId?: string;
  readonly learningSessionId?: string;
}

export interface AptiloopTypedToolDefinition<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> {
  readonly name: AptiloopToolName;
  readonly input: TInput;
  readonly output: TOutput;
  readonly execute: {
    bivarianceHack(
      input: z.output<TInput>,
      context: AptiloopToolContext,
      signal?: AbortSignal,
    ): Promise<z.input<TOutput>>;
  }["bivarianceHack"];
}

export class AptiloopTypedToolHost {
  readonly #definitions = new Map<
    AptiloopToolName,
    AptiloopTypedToolDefinition
  >();
  readonly #policies: ReadonlyMap<string, ToolPolicy>;

  constructor(
    definitions: readonly AptiloopTypedToolDefinition[],
    policies: readonly ToolPolicy[],
  ) {
    for (const definition of definitions) {
      const name = AptiloopToolNameSchema.parse(definition.name);
      if (this.#definitions.has(name)) {
        throw new Error(`Duplicate Aptiloop tool: ${name}`);
      }
      this.#definitions.set(name, definition);
    }
    const parsedPolicies = policies.map((policy) =>
      ToolPolicySchema.parse(policy),
    );
    this.#policies = new Map(
      parsedPolicies.map((policy) => [policy.toolPolicyId, policy]),
    );
    if (this.#policies.size !== parsedPolicies.length) {
      throw new Error("Duplicate Aptiloop tool policy");
    }
  }

  listAllowedTools(
    role: AptiloopAiRole,
    toolPolicyId: string,
  ): AptiloopToolName[] {
    const policy = this.#resolvePolicy(role, toolPolicyId);
    return policy.allowedTools.filter((name) => this.#definitions.has(name));
  }

  async execute(input: {
    readonly role: AptiloopAiRole;
    readonly toolPolicyId: string;
    readonly toolName: AptiloopToolName;
    readonly arguments: unknown;
    readonly context: AptiloopToolContext;
    readonly signal?: AbortSignal;
  }): Promise<unknown> {
    const role = AptiloopAiRoleSchema.parse(input.role);
    const toolName = AptiloopToolNameSchema.parse(input.toolName);
    const policy = this.#resolvePolicy(role, input.toolPolicyId);
    if (!policy.allowedTools.includes(toolName)) {
      throw new ProviderHubError(
        "tool_policy_unavailable",
        `Tool ${toolName} is denied for ${role}`,
      );
    }
    const definition = this.#definitions.get(toolName);
    if (!definition) {
      throw new ProviderHubError(
        "tool_policy_unavailable",
        `Tool ${toolName} is not installed`,
      );
    }
    if (input.context.role !== role) {
      throw new ProviderHubError(
        "tool_policy_unavailable",
        "Tool execution role scope does not match the resolved role",
      );
    }
    input.signal?.throwIfAborted();
    const parsedArguments = definition.input.safeParse(input.arguments);
    if (!parsedArguments.success) {
      throw new ProviderHubError(
        "invalid_output",
        `Tool ${toolName} arguments failed strict validation`,
      );
    }
    const rawOutput = await definition.execute(
      parsedArguments.data,
      input.context,
      input.signal,
    );
    const parsedOutput = definition.output.safeParse(rawOutput);
    if (!parsedOutput.success) {
      throw new ProviderHubError(
        "invalid_output",
        `Tool ${toolName} output failed strict validation`,
      );
    }
    return parsedOutput.data;
  }

  #resolvePolicy(role: AptiloopAiRole, toolPolicyId: string): ToolPolicy {
    const policy = this.#policies.get(toolPolicyId);
    if (!policy || policy.role !== role) {
      throw new ProviderHubError(
        "tool_policy_unavailable",
        `Tool policy ${toolPolicyId} is unavailable for ${role}`,
      );
    }
    return policy;
  }
}

export const CORE_TOOL_POLICIES = [
  {
    toolPolicyId: "apt.role.course-designer.v2",
    role: "course-designer",
    allowedTools: [
      "course.readDraftSlice",
      "course.readApprovedSources",
      "course.proposeDraftPatch",
      "knowledge.readCapsule",
    ],
  },
  {
    toolPolicyId: "apt.role.tutor.v1",
    role: "tutor",
    allowedTools: [
      "lesson.readLearnerSafeContext",
      "lesson.submitTutorMessage",
      "knowledge.readSnapshotSlice",
    ],
  },
  {
    toolPolicyId: "apt.role.evaluator.v1",
    role: "evaluator",
    allowedTools: [
      "evaluation.readAttemptBundle",
      "evaluation.submitTypedResult",
    ],
  },
  {
    toolPolicyId: "apt.role.reviewer.v1",
    role: "reviewer",
    allowedTools: ["review.readBundle", "review.submitResult"],
  },
] as const satisfies readonly ToolPolicy[];
