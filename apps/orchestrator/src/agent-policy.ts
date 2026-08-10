import type { AgentProvider } from "@dlh/agent-core";
import type { AgentRole, ProviderId } from "@dlh/shared";

export interface ConfiguredLearningSelection {
  role: AgentRole;
  providerId: ProviderId;
  modelId: string;
}

export interface M1LearningPolicy {
  developmentMode?: boolean;
  configurationOnly?: boolean;
}

export interface ResolvedLearningSelection extends ConfiguredLearningSelection {
  provider: AgentProvider;
}

export function m1LearningProviderBlockReason(
  providerId: ProviderId,
  policy: M1LearningPolicy = {},
): string | undefined {
  if (providerId !== "mock") {
    return `Learning provider ${providerId} is blocked by M1 policy`;
  }
  if (
    policy.developmentMode !== true &&
    policy.configurationOnly !== true &&
    process.env.NODE_ENV !== "development" &&
    process.env.NODE_ENV !== "test"
  ) {
    return "Mock learning provider is disabled outside explicit development or test mode";
  }
  return undefined;
}

export function assertM1LearningSelection(
  selection: ConfiguredLearningSelection,
  policy: M1LearningPolicy = {},
): asserts selection is ConfiguredLearningSelection & { providerId: "mock" } {
  const blockReason = m1LearningProviderBlockReason(
    selection.providerId,
    policy,
  );
  if (blockReason) throw new Error(`${blockReason} for role ${selection.role}`);
}

export async function validateM1LearningSelections(
  providers: Record<ProviderId, AgentProvider>,
  selections: readonly ConfiguredLearningSelection[],
  policy: M1LearningPolicy = {},
): Promise<void> {
  for (const selection of selections) {
    assertM1LearningSelection(selection, policy);
  }

  const provider = providers.mock;
  if (provider.id !== "mock") {
    throw new Error("Configured Mock learning provider is invalid");
  }
  const models = await provider.listModels().catch(() => {
    throw new Error("Models are unavailable for provider mock");
  });
  const availableModels = new Set(
    models
      .filter((model) => model.providerId === "mock" && model.available)
      .map((model) => model.id),
  );

  for (const selection of selections) {
    if (!availableModels.has(selection.modelId)) {
      throw new Error(
        `Model ${selection.modelId} is unavailable for provider mock`,
      );
    }
  }
}

export async function resolveM1LearningSelection(
  providers: Record<ProviderId, AgentProvider>,
  selection: ConfiguredLearningSelection,
  policy: M1LearningPolicy = {},
): Promise<ResolvedLearningSelection> {
  await validateM1LearningSelections(providers, [selection], policy);
  return { ...selection, provider: providers.mock };
}
