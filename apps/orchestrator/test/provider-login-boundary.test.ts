import { describe, expect, it } from "vitest";

import {
  normalizeProviderLoginAnswer,
  normalizeProviderLoginEvent,
  normalizeProviderLoginPrompt,
} from "../src/provider-management.js";

const promptId = "88a6558f-d070-478e-adbc-18678089cb43";
const githubPrompt = {
  type: "text",
  message: "GitHub Enterprise URL/domain (blank for github.com)",
  placeholder: "company.ghe.com",
} as const;
const openAiPrompt = {
  type: "select",
  message: "Select OpenAI Codex login method:",
  options: [
    { id: "browser", label: "Browser login (default)" },
    { id: "device_code", label: "Device code login (headless)" },
  ],
} as const;

describe("provider login boundary", () => {
  it("maps the exact GitHub prompt to the optional app-owned prompt", () => {
    const prompt = normalizeProviderLoginPrompt(
      "github-copilot-subscription",
      promptId,
      githubPrompt,
    );

    expect(prompt).toEqual({
      promptId,
      kind: "github-enterprise-domain",
      type: "text",
      optional: true,
      options: [],
    });
    expect(JSON.stringify(prompt)).not.toContain(githubPrompt.message);
    expect(JSON.stringify(prompt)).not.toContain(githubPrompt.placeholder);
    expect(normalizeProviderLoginAnswer(prompt, "")).toBe("");
    expect(normalizeProviderLoginAnswer(prompt, "   ")).toBe("");
  });

  it.each([
    "github.example.com",
    "localhost",
    "127.0.0.1",
    "https://github.example.com",
    "enterprise",
  ])("rejects the nonblank GitHub enterprise answer %j", (answer) => {
    const prompt = normalizeProviderLoginPrompt(
      "github-copilot-subscription",
      promptId,
      githubPrompt,
    );

    expect(() => normalizeProviderLoginAnswer(prompt, answer)).toThrow(
      "GitHub Enterprise sign-in is not supported by the current endpoint policy",
    );
  });

  it("maps the exact OpenAI prompt to finite app-owned choices", () => {
    const prompt = normalizeProviderLoginPrompt(
      "openai-subscription",
      promptId,
      openAiPrompt,
    );

    expect(prompt).toEqual({
      promptId,
      kind: "openai-codex-login-method",
      type: "select",
      optional: false,
      options: ["browser", "device_code"],
    });
    expect(JSON.stringify(prompt)).not.toContain("Browser login (default)");
    expect(JSON.stringify(prompt)).not.toContain(
      "Device code login (headless)",
    );
    expect(normalizeProviderLoginAnswer(prompt, "browser")).toBe("browser");
    expect(normalizeProviderLoginAnswer(prompt, "device_code")).toBe(
      "device_code",
    );
  });

  it.each(["", "   ", "forged", "Browser", "device-code"])(
    "rejects the invalid OpenAI choice %j",
    (answer) => {
      const prompt = normalizeProviderLoginPrompt(
        "openai-subscription",
        promptId,
        openAiPrompt,
      );

      expect(() => normalizeProviderLoginAnswer(prompt, answer)).toThrow();
    },
  );

  const promptDriftCases = [
    {
      name: "changed GitHub message",
      catalogId: "github-copilot-subscription",
      prompt: { ...githubPrompt, message: "Enter an enterprise domain" },
    },
    {
      name: "changed GitHub placeholder",
      catalogId: "github-copilot-subscription",
      prompt: { ...githubPrompt, placeholder: "github.example.com" },
    },
    {
      name: "changed OpenAI message",
      catalogId: "openai-subscription",
      prompt: { ...openAiPrompt, message: "Choose a login method" },
    },
    {
      name: "changed OpenAI label",
      catalogId: "openai-subscription",
      prompt: {
        ...openAiPrompt,
        options: [
          { id: "browser", label: "Browser sign-in" },
          openAiPrompt.options[1],
        ],
      },
    },
    {
      name: "OpenAI option description",
      catalogId: "openai-subscription",
      prompt: {
        ...openAiPrompt,
        options: [
          { ...openAiPrompt.options[0], description: "Provider copy" },
          openAiPrompt.options[1],
        ],
      },
    },
    {
      name: "reordered OpenAI options",
      catalogId: "openai-subscription",
      prompt: {
        ...openAiPrompt,
        options: [openAiPrompt.options[1], openAiPrompt.options[0]],
      },
    },
    {
      name: "cross-provider prompt",
      catalogId: "anthropic-subscription",
      prompt: openAiPrompt,
    },
  ] satisfies ReadonlyArray<{
    name: string;
    catalogId: Parameters<typeof normalizeProviderLoginPrompt>[0];
    prompt: Parameters<typeof normalizeProviderLoginPrompt>[2];
  }>;

  it.each(promptDriftCases)("rejects $name", ({ catalogId, prompt }) => {
    expect(() =>
      normalizeProviderLoginPrompt(catalogId, promptId, prompt),
    ).toThrow("Provider produced an unsupported sign-in prompt");
  });

  it("discards raw provider event copy", () => {
    const info = normalizeProviderLoginEvent("openai-subscription", {
      type: "info",
      message: "raw provider message with a secret",
      links: [
        {
          label: "raw provider label",
          url: "https://untrusted.example/sign-in",
        },
      ],
    });
    const progress = normalizeProviderLoginEvent("openai-subscription", {
      type: "progress",
      message: "raw provider progress",
    });

    expect(info).toEqual({ type: "progress" });
    expect(progress).toEqual({ type: "progress" });
    expect(JSON.stringify([info, progress])).not.toMatch(/raw provider/u);
  });

  it("accepts only app-allowlisted OpenAI and GitHub login URLs", () => {
    expect(
      normalizeProviderLoginEvent("openai-subscription", {
        type: "auth_url",
        url: "https://auth.openai.com/oauth/authorize?state=opaque",
        instructions: "raw provider instructions",
      }),
    ).toEqual({
      type: "auth_url",
      url: "https://auth.openai.com/oauth/authorize?state=opaque",
    });
    expect(
      normalizeProviderLoginEvent("openai-subscription", {
        type: "device_code",
        userCode: "OPENAI-CODE",
        verificationUri: "https://auth.openai.com/codex/device",
      }),
    ).toEqual({
      type: "device_code",
      userCode: "OPENAI-CODE",
      verificationUri: "https://auth.openai.com/codex/device",
    });
    expect(
      normalizeProviderLoginEvent("github-copilot-subscription", {
        type: "device_code",
        userCode: "GITHUB-CODE",
        verificationUri: "https://github.com/login/device",
      }),
    ).toEqual({
      type: "device_code",
      userCode: "GITHUB-CODE",
      verificationUri: "https://github.com/login/device",
    });
  });

  const rejectedUrlEvents = [
    {
      name: "alternate OpenAI host",
      catalogId: "openai-subscription",
      event: {
        type: "auth_url",
        url: "https://auth.openai.com.attacker.example/oauth/authorize",
      },
    },
    {
      name: "OpenAI HTTP URL",
      catalogId: "openai-subscription",
      event: {
        type: "auth_url",
        url: "http://auth.openai.com/oauth/authorize",
      },
    },
    {
      name: "OpenAI wrong auth path",
      catalogId: "openai-subscription",
      event: {
        type: "auth_url",
        url: "https://auth.openai.com/oauth/token?state=opaque",
      },
    },
    {
      name: "OpenAI auth fragment",
      catalogId: "openai-subscription",
      event: {
        type: "auth_url",
        url: "https://auth.openai.com/oauth/authorize?state=opaque#secret",
      },
    },
    {
      name: "OpenAI device query",
      catalogId: "openai-subscription",
      event: {
        type: "device_code",
        userCode: "CODE",
        verificationUri: "https://auth.openai.com/codex/device?next=evil",
      },
    },
    {
      name: "alternate GitHub host",
      catalogId: "github-copilot-subscription",
      event: {
        type: "device_code",
        userCode: "CODE",
        verificationUri: "https://github.com.attacker.example/login/device",
      },
    },
    {
      name: "GitHub HTTP URL",
      catalogId: "github-copilot-subscription",
      event: {
        type: "device_code",
        userCode: "CODE",
        verificationUri: "http://github.com/login/device",
      },
    },
    {
      name: "GitHub auth URL event",
      catalogId: "github-copilot-subscription",
      event: { type: "auth_url", url: "https://github.com/login/device" },
    },
    {
      name: "GitHub device fragment",
      catalogId: "github-copilot-subscription",
      event: {
        type: "device_code",
        userCode: "CODE",
        verificationUri: "https://github.com/login/device#secret",
      },
    },
  ] satisfies ReadonlyArray<{
    name: string;
    catalogId: Parameters<typeof normalizeProviderLoginEvent>[0];
    event: Parameters<typeof normalizeProviderLoginEvent>[1];
  }>;

  it.each(rejectedUrlEvents)("rejects $name", ({ catalogId, event }) => {
    expect(() => normalizeProviderLoginEvent(catalogId, event)).toThrow(
      "Provider returned an unsupported sign-in URL",
    );
  });

  it("bounds and trims the device code", () => {
    const maxCode = "A".repeat(128);
    expect(
      normalizeProviderLoginEvent("github-copilot-subscription", {
        type: "device_code",
        userCode: ` ${maxCode} `,
        verificationUri: "https://github.com/login/device",
      }),
    ).toMatchObject({ userCode: maxCode });

    for (const userCode of ["", "   ", "A".repeat(129)]) {
      expect(() =>
        normalizeProviderLoginEvent("github-copilot-subscription", {
          type: "device_code",
          userCode,
          verificationUri: "https://github.com/login/device",
        }),
      ).toThrow("Provider returned an invalid device code");
    }
  });
});
