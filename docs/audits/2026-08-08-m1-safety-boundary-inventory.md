# M1 Safety-Boundary and Private-Data Inventory

**Date:** 2026-08-08  
**Status:** Accepted **Implemented baseline** as of 2026-08-09 after independent review and the refreshed local integrated gate.

This report contains paths, sizes, counts, migration IDs, and health results only. It contains no learner content, provider payload, raw review text, or secret value. The initial inventory did not migrate, seed, checkpoint, attach, normalize, delete, redact, merge, or select a database. After the owner-approved disposition, the active-only preflight created the one approved backup recorded below; the source and all quarantined artifacts remained unchanged.

## Containment baseline

The accepted M1 implementation keeps the runnable v2 learning vertical while reducing authority:

- the orchestrator permits Mock for Teacher, Reviewer, Interviewer, Curator, and Codex Expert only in explicit development/test mode; unset or misspelled runtime mode fails closed, and Codex/OpenCode remain installed legacy adapter boundaries but are policy-blocked for learning;
- provider/model selection is server-owned, browser request bodies cannot override it, provider failure never silently substitutes Mock, and readiness endpoints report blocked providers without activating their adapters;
- `npm start` starts Aptiloop only and no longer starts an OpenCode sidecar;
- Codex app-server children receive an explicit environment allowlist; unrelated database, OpenCode, and GitHub secrets are excluded;
- OpenCode normalization discards provider tool inputs and outputs, retaining only bounded lifecycle identity; focused provider evidence supplied by Main is 17/17 Codex and 34/34 OpenCode tests passing;
- browser-facing agent events are allowlisted and correlate through an app-owned opaque turn UUID rather than provider session/protocol IDs;
- `LearningRepository.addMessage` no longer accepts raw/tool fields and inserts `tool_events_json='[]'` plus `raw_event_json=NULL`; new reviews write `raw_response=NULL`;
- legacy v1 learning mutations return 410 before parsing or repository writes; historical reads remain available and the v2 vertical remains the supported mutation path;
- direct mode accepts only `127.0.0.1`, `::1`, or `localhost`; the explicit Compose mode alone permits an internal `0.0.0.0` bind while host publications remain `127.0.0.1:3000` and `127.0.0.1:8787`;
- every `/api/*` response is `Cache-Control: no-store`; mutation request-shape controls remain exact Origin, `X-DLH-Client=web`, and JSON media type. These controls are not authentication.
- `.data/dev-learning-harness.sqlite` is the sole direct runtime and writable CLI target; alternate candidates are rejected before opening, the Compose exception is exactly `/data/dev-learning-harness.sqlite`, and disposable files require explicit test mode;

Final local acceptance evidence on 2026-08-09 includes successful `npm ci`; a refreshed `npm run verify` covering formatting, 12/12 workspace lint and typecheck tasks, 656 fast tests, and 12/12 builds; a 30/30 ownership/lock suite covering transient-heartbeat recovery, persistent ownership-loss termination, authenticated dead-run scavenging, and preservation of live or ambiguous service processes; two consecutive lock-serialized E2E runs at 4/4, with the first removing the retained authenticated, stale, proven-dead run root; active and approved-backup private-data re-inventory with SQLite integrity `ok`, coherent session ownership, zero foreign-key violations, and zero non-empty tool/raw rows; dependency audit policy; CycloneDX generation; and a 1440×900 loopback Settings smoke with server-owned read-only provider state and persisted theme mutation/restoration. Independent security and correctness re-reviews closed every reported M1 blocker. The fixed E2E loopback ports fail closed if occupied and do not provide parallel port isolation. The committed GitHub workflow was not run by this local session and is not claimed green.

## Read-only SQLite inventory

The initial inventory observed six live database families and eleven pre-existing application-managed backup files. Every inspected family returned SQLite integrity `ok` and zero foreign-key violations. WAL/SHM are listed as family members, not treated as independent databases.

| Candidate family                                      | Sidecars                      | Migration markers | Safe logical summary                                    | 2026-08-08 disposition                       |
| ----------------------------------------------------- | ----------------------------- | ----------------- | ------------------------------------------------------- | -------------------------------------------- |
| `.data/dev-learning-harness.sqlite`                   | WAL and SHM present           | `0000`–`0005`     | 2 sessions, 2 active; 0 messages; 0 reviews/raw reviews | **Active runtime candidate**                 |
| `data/dev-learning-harness.sqlite`                    | zero-byte WAL and SHM present | `0000` only       | 1 session, 1 active; 0 messages                         | Quarantined unchanged until M2               |
| `packages/database/.data/dev-learning-harness.sqlite` | WAL and SHM present           | `0000`–`0003`     | 0 sessions; 0 messages                                  | Quarantined unchanged until M2               |
| `.data/zed-check.sqlite`                              | WAL and SHM present           | `0000`–`0005`     | 0 messages                                              | Quarantined unchanged until M2               |
| `.data/zed-check-2.sqlite`                            | WAL and SHM present           | `0000`–`0005`     | 0 messages                                              | Quarantined unchanged until M2               |
| `.data/m0-baseline/baseline.sqlite`                   | zero-byte WAL and SHM present | `0000`–`0005`     | 1 session, 1 active; 0 messages                         | Protected and quarantined unchanged until M2 |

Ten backups are under `.data/backups/` and one is under `.data/m0-baseline/backups/`. All eleven are preserved in place and quarantined from runtime, restore, and approved-backup use until M2 reconciliation. Ten use the historical root backup directory; the nested M0 baseline backup and its parent family must remain unchanged.

Two historical backups contain agent-message rows: one has three rows and six total `tool_events_json` bytes, and one has two rows and four bytes. Every one of those five values is the safe empty array `[]`; all other inspected backups have zero message rows. Across all six live families and eleven backups, the observed logical counts are:

- non-empty or invalid `tool_events_json` rows: **0**;
- non-null `raw_event_json` rows: **0**;
- non-null `reviews.raw_response` rows observed in the active candidate: **0**.

These are logical SQL results, not a claim that sensitive bytes are absent from free pages, deleted cells, WAL frames, SHM, filesystem snapshots, external copies, or storage-media history. Consequently no cleanup migration was added and no historical SQLite artifact was changed. A byte-level absence claim remains unproven.

## Approved owner disposition

The repository owner approved this conservative disposition on 2026-08-08:

1. `.data/dev-learning-harness.sqlite` is the only active runtime candidate.
2. The other five candidate families and all eleven existing application-managed backups remain unchanged and quarantined from runtime, restore, and approved-backup use until M2 reconciliation.
3. There is no deletion, redaction, merge, automatic newest-file selection, or migration of those candidates in M1.
4. `.data/m0-baseline/` is protected unchanged.
5. A new verified backup may be created only from the active candidate, only after the read-only inventory preflight, and only under `.data/approved-backups/`. Existing `.data/backups/` files do not become approved merely because their SQLite health checks pass.

## Approved backup evidence

After all application writers were stopped, the active-only preflight first created `.data/approved-backups/pre-m2-2026-08-08T120700Z.sqlite`. That non-overwriting backup is 1,409,024 bytes with SHA-256 `b518e49bc5723cec3fdcec4023ca345283cb949de42bd8a90d4e0572af1b5b12`. A second owner-approved final-M1 capture created `.data/approved-backups/2026-08-09T10-37-00Z-m1-active.sqlite`; it is 1,417,216 bytes with SHA-256 `721ef8d9396de56140d5509cb484c3ff21a393ddf7d2c4c96f3f7da29ca7b874` and logical SHA-256 `4bc439a2e99e572a4b68b10cd0f2ccd6d7b90a704d9c669139a9525f7bffccbe`. Re-inventory reported stable source families, SQLite integrity `ok`, zero foreign-key violations, exactly migrations `0000`–`0005`, coherent legacy compatibility with one non-legacy active session, zero agent-message raw/tool payload rows, and zero raw review rows. The eleven pre-existing backups remain quarantined; only the two separately created files under `.data/approved-backups/` are approved M1 point-in-time copies.

## Dependency and CI evidence

Two supported `npm audit fix` runs updated the lock without force, overrides, or downgrade. Relevant locked production versions are Hono 4.13.1, Next 16.3.0, Next's PostCSS 8.5.23, Sharp 0.35.3, and nanoid 3.3.18. Fresh evidence supplied by Main reports:

- `npm audit --omit=dev --json`: zero vulnerabilities;
- full `npm audit --json`: one low, development-only transitive advisory, esbuild `GHSA-g7r4-m6w7-qqqr` at `node_modules/tsup/node_modules/esbuild` 0.27.7, fixed in `>=0.28.1`;
- tsup 8.5.1 currently declares esbuild `^0.27.0`, so supported audit fixes did not move that nested copy.

The low graph-dev-only finding is present in the installed tree shipped by the orchestrator image; it is reported, not waived, and is not an owner exception. There is no unapproved shipped installed-tree High/Critical advisory in the observed full audit. The tightened policy blocks any such full-report object while counting production overlap only once.

`.github/workflows/ci.yml` is now the committed Node 24/npm 11 workspace gate. Its supply-chain job runs first, archives full and production audit JSON plus a classified summary, generates a CycloneDX npm SBOM, and uploads the reports even if a later gate fails. The policy classifies graph scope for reporting but blocks High/Critical findings across the full installed tree because that tree is copied into the orchestrator image. Dependent jobs enforce `npm ci`, `format:check`, lint, typecheck, fast tests, build, a repository-pinned Playwright Chromium install, and an explicit `test:e2e`. The refreshed local audit-policy and SBOM gates passed on 2026-08-09. Committing and reproducing the commands locally is not evidence that a hosted GitHub run passed.

## Exact operator commands

Stop or quiesce application writers before inventory or backup. Inventory accepts only explicit roots or database paths and writes JSON to stdout:

```sh
npm run db:inventory -- --db .data/dev-learning-harness.sqlite
npm run db:inventory -- --root .data --root data --root packages/database/.data
```

The first command is the required active-candidate preflight. The second is the broader reconciliation inventory and includes recognized SQLite mains, WAL/SHM families, and backups recursively without following symlinks. Inspection runs against disposable family copies; source hashes, sizes, and modification times are compared before and after. A changed, unhealthy, or unreadable family makes the command fail closed.

Create a new, non-existing approved backup only after the active preflight succeeds:

```sh
npm run db:backup -- --source .data/dev-learning-harness.sqlite --destination .data/approved-backups/pre-m2-2026-08-08T120000Z.sqlite
```

The command rejects every other source, rejects destinations outside `.data/approved-backups/`, requires the migration ledger plus complete `agent_messages` and `reviews` schemas, repeats the read-only health/private-payload preflight, and then uses the verified non-overwriting SQLite backup primitive. Choose a new destination filename for every run.

Reproduce supply-chain reports locally without changing dependencies:

```sh
npm run audit:policy -- --output-dir .verify/supply-chain
npm run sbom -- --output .verify/supply-chain/sbom.cdx.json
```

Run the complete repository gate from the root when runtime validation is authorized:

```sh
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run test:fast
npm run test:e2e
npm run build
```

## Rollback and recovery notes

M1 adds no schema migration and does not mutate existing user databases. The approved backups are verified non-overwriting copies, so there is no source-data rollback for the persistence seam, inventory command, or backup creation. Reverting application code must not rewrite the safe rows already produced. CI can be reverted independently without touching data.

If approved backup creation fails, preserve the active source unchanged and quarantine the incomplete new destination for diagnosis; never substitute an existing quarantined backup. After a future committed data migration, rollback is a whole-file restore from a verified, explicitly approved pre-migration backup while writers are stopped, followed by integrity, foreign-key, migration-marker, and private-payload inventory checks. None of the eleven quarantined pre-M1 backups is an approved restore source; the verified `pre-m2-2026-08-08T120700Z.sqlite` and `2026-08-09T10-37-00Z-m1-active.sqlite` copies are the approved M1 point-in-time sources.
