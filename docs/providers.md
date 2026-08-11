# AI providers

**Document status:** **Implemented baseline** — the Core Alpha M6 Provider Hub and Settings connection workflow are evidenced in the current repository.

## Operating policy

The orchestrator owns every connection, credential reference, exact model selection, role profile, capability check, disclosure decision, and provider turn. Browser learning requests contain role and entity intent only; they cannot override a provider, model, endpoint, credential, or tool policy. A failed or unavailable real provider remains an explicit error and never becomes Mock. Mock is limited to tests, CI, and explicit development composition.

## Supported connections

The Settings → Connections catalog exposes only reviewed Pi-backed adapters:

| Connection                     | Authentication                               | Notes                                                                                                                     |
| ------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| OpenAI API                     | API key                                      | Built-in endpoint and model catalog.                                                                                      |
| OpenAI Codex subscription      | Provider-owned subscription sign-in          | Recommended overall for strong general quality without separate API billing.                                              |
| Anthropic API                  | API key                                      | Built-in endpoint and model catalog.                                                                                      |
| Claude subscription            | Provider-owned subscription sign-in          | Uses the reviewed Anthropic auth flow.                                                                                    |
| NVIDIA NIM                     | `NVIDIA_API_KEY`                             | Built-in NVIDIA model catalog; account limits and pricing remain provider-owned.                                          |
| OpenCode Zen                   | `OPENCODE_API_KEY`                           | Recommended free starting point because the reviewed catalog includes free model IDs; availability and limits may change. |
| Google Gemini                  | `GEMINI_API_KEY`                             | Built-in endpoint and model catalog.                                                                                      |
| OpenRouter                     | `OPENROUTER_API_KEY`                         | Built-in endpoint and model catalog.                                                                                      |
| DeepSeek                       | `DEEPSEEK_API_KEY`                           | Built-in endpoint and model catalog.                                                                                      |
| Mistral                        | `MISTRAL_API_KEY`                            | Built-in endpoint and model catalog.                                                                                      |
| Groq                           | `GROQ_API_KEY`                               | Built-in endpoint and model catalog.                                                                                      |
| GitHub Copilot subscription    | Provider-owned subscription sign-in          | Uses the reviewed Copilot auth flow.                                                                                      |
| Custom OpenAI-compatible HTTPS | API key, exact base URL, exact model IDs     | Explicitly configured public HTTPS endpoint only; see the restrictions below.                                             |
| Ollama                         | No credential, loopback URL, exact model IDs | Recommended for privacy because model traffic stays on this computer.                                                     |
| LM Studio                      | No credential, loopback URL, exact model IDs | Local OpenAI-compatible server.                                                                                           |

“Free” describes a provider/model offer, not an Aptiloop guarantee. Providers control account eligibility, quotas, retention, regional availability, pricing, and model removal. Aptiloop performs no cost-based routing and never silently changes a selected model.

## Connect and assign a model

1. Open **Settings → Connections → Add connection**.
2. Choose one server-owned catalog entry and give the connection a local display name.
3. For an API-key provider, enter the key. For a subscription provider, create the connection and complete the provider-owned sign-in prompts. For Ollama or LM Studio, enter the loopback URL and the exact installed model IDs.
4. Verify the connection state and observed models. `connected` means an authenticated request was observed; configured credentials alone remain `degraded` until that observation.
5. In **AI role profiles**, select the connection and one exact available model independently for Course Designer, Tutor, Evaluator, and Reviewer, then save all four profiles.

A connection can serve several roles. Disabling a connection preserves history but makes dependent roles explicitly unavailable. Switching a role creates a new server-owned profile decision; it never rewrites prior turn provenance.

## Custom OpenAI-compatible HTTPS boundary

The custom adapter is an explicit advanced connection, not automatic provider discovery. It accepts:

- an `https:` URL with a public DNS hostname;
- the default TLS port only;
- no URL username, password, query, or fragment;
- a path ending in `/v1`;
- one or more exact model IDs supplied by the user.

Literal IP addresses, single-label names, loopback/private-style host suffixes, non-HTTPS URLs, and embedded URL credentials are rejected. Course Packs and learning routes cannot provide or change this endpoint. The endpoint is still external: every private Course/learner/source disclosure requires the same exact destination-, role-, model-, scope-, payload-hash-, and expiry-bound user approval as a built-in external provider.

Use Ollama or LM Studio for loopback endpoints. Do not expose a local model server on the network merely to make it look like a custom external provider.

## Credentials and privacy

API keys and subscription tokens are stored in the app-owned local `.data/provider-credentials.json` credential file, scoped by connection ID, written atomically, and requested with owner-only POSIX file permissions where the platform supports them. They are never stored in SQLite, returned by settings APIs, included in Course Packs, prompts, role profiles, logs, model output, or browser-readable payloads. Replacing or signing out a credential is an explicit settings mutation.

External provider turns remain blocked until the UI shows the exact destination and data categories and the user approves the operation-scoped disclosure that is consumed once. The Provider Hub persists only bounded final content when product behavior requires it plus secret-free terminal provenance. General provider tool arguments/results and raw provider events are not persistence or browser contracts.

## Failure and recovery

- `authentication-required`: set/replace the API key or complete subscription sign-in.
- `model-unavailable`: choose an exact currently observed model; Aptiloop does not choose another one.
- `connection-disabled` or `provider-unavailable`: enable or repair the named connection.
- `capability-missing`: choose a model that satisfies the role's observed requirements.
- `disclosure-required` or `disclosure-mismatch`: inspect and approve the exact new disclosure; prior approval is not broadened or reused.
- timeout, cancellation, budget, invalid-output, and provider errors terminate the turn without a successful deterministic learning fact.

## Legacy adapters

The Codex app-server and old OpenCode sidecar adapters remain historical migration boundaries and are blocked from learning roles. `npm start` launches Aptiloop only. Installed CLIs, sidecar health, or ambient credentials do not authorize a learning turn. The active OpenCode Zen connection uses the constrained pinned Pi adapter, not the legacy sidecar.

Current provider evidence ownership is defined by the [Provider Hub architecture](architecture/provider-hub.md) and recorded by dated audits. The [2026-08-12 hardening audit](audits/2026-08-12-ui-ux-runtime-hardening.md) distinguishes the historical 2026-08-10 authenticated OpenCode Zen smoke from the absence of a fresh smoke for implementation `b542b32`.
