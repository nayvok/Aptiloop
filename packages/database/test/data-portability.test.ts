import { createHash } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, type TestContext } from "vitest";

import {
  createPortableDataBundle,
  parsePortableDataBundleFile,
  restorePortableDataBundle,
} from "../src/data-portability.js";
import { migrateDatabase, openDatabase } from "../src/database.js";
import {
  databaseLogicalSha256,
  databaseSchemaSha256,
} from "../src/private-data-inventory.js";
import { createLearningRepository } from "../src/repository.js";

const roots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function createActiveDatabase(projectRoot: string): string {
  const databasePath = path.join(
    projectRoot,
    ".data",
    "dev-learning-harness.sqlite",
  );
  const connection = openDatabase(databasePath);
  try {
    migrateDatabase(connection);
    connection.sqlite
      .prepare(
        `INSERT INTO topics
          (id, slug, title, description, created_at, updated_at)
         VALUES ('portable-topic', 'portable-topic', 'Portable topic',
                 'Preserved learner data', 1, 1)`,
      )
      .run();
  } finally {
    connection.close();
  }
  return databasePath;
}

function sha256(candidate: string): string {
  return createHash("sha256").update(readFileSync(candidate)).digest("hex");
}

function rewriteBundleManifest(
  bundle: Buffer,
  mutate: (manifest: Record<string, unknown>) => void,
  payload?: Buffer,
): Buffer {
  const magicBytes = Buffer.byteLength("APTILOOP-DATA\u0000", "ascii");
  const manifestBytes = bundle.readUInt32BE(magicBytes);
  const manifestStart = magicBytes + 4;
  const payloadStart = manifestStart + manifestBytes;
  const manifest = JSON.parse(
    bundle.subarray(manifestStart, payloadStart).toString("utf8"),
  ) as Record<string, unknown>;
  mutate(manifest);
  const encoded = Buffer.from(JSON.stringify(manifest), "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(encoded.length, 0);
  return Buffer.concat([
    bundle.subarray(0, magicBytes),
    length,
    encoded,
    payload ?? bundle.subarray(payloadStart),
  ]);
}

function payloadManifest(candidate: string) {
  const bytes = readFileSync(candidate);
  const connection = openDatabase(candidate, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    return {
      bytes,
      manifest: {
        kind: "sqlite",
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        logicalSha256: databaseLogicalSha256(connection.sqlite),
        schemaSha256: databaseSchemaSha256(connection.sqlite),
      },
    };
  } finally {
    connection.close();
  }
}

function tryCreateHardLink(
  context: TestContext,
  target: string,
  linkPath: string,
): boolean {
  try {
    linkSync(target, linkPath);
    return true;
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? (error as NodeJS.ErrnoException).code
        : undefined;
    if (
      ["EACCES", "EINVAL", "ENOSYS", "ENOTSUP", "EPERM"].includes(code ?? "")
    ) {
      return context.skip("Hard links are not supported on this platform");
    }
    throw error;
  }
}

afterEach(() => {
  while (roots.length) {
    const root = roots.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("portable local data", () => {
  it("round-trips a healthy current database into a fresh installation", async () => {
    const sourceRoot = temporaryRoot("aptiloop-portable-source-");
    createActiveDatabase(sourceRoot);

    const exported = await createPortableDataBundle({
      projectRoot: sourceRoot,
      now: new Date("2026-08-12T12:34:56.000Z"),
    });

    expect(exported.bundlePath).toBe(
      path.join(
        sourceRoot,
        ".data",
        "portable-exports",
        "aptiloop-data-2026-08-12T12-34-56-000Z.aptiloop-data",
      ),
    );
    expect(exported.manifest.excludes).toContain("provider-credentials");
    expect(exported.manifest.excludes).toContain("absolute-local-paths");
    expect(exported.manifest.sanitizationPolicy).toBe(
      "aptiloop-portable-profile-v1",
    );
    expect(parsePortableDataBundleFile(exported.bundlePath).manifest).toEqual(
      exported.manifest,
    );

    const restoreRoot = temporaryRoot("aptiloop-portable-restore-");
    const restored = await restorePortableDataBundle({
      projectRoot: restoreRoot,
      sourcePath: exported.bundlePath,
    });
    const connection = openDatabase(restored.activeDatabasePath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      expect(
        connection.sqlite
          .prepare("SELECT title FROM topics WHERE id = 'portable-topic'")
          .get(),
      ).toEqual({ title: "Portable topic" });
    } finally {
      connection.close();
    }
  });

  it("sanitizes capability state, credentials references, and device paths", async () => {
    const projectRoot = temporaryRoot("aptiloop-portable-sanitize-");
    const databasePath = createActiveDatabase(projectRoot);
    const sentinels = {
      settingsPath: `C:/private/${"settings-secret-".repeat(300)}`,
      providerSession: `provider-session-${"secret-".repeat(500)}`,
      legacyEndpoint: `https://legacy-${"private-".repeat(300)}.example/v1`,
      legacyOptions: `legacy-options-${"credential-".repeat(1_000)}`,
      credentialRef: `credential-ref-${"private-".repeat(20)}`,
      endpointProfile: `endpoint-profile-${"private-".repeat(20)}`,
      managedBaseUrl: `https://managed-${"private-".repeat(300)}.example/v1`,
      observedCapabilities: `observed-${"private-".repeat(100)}`,
      rawToolEvent: `raw-tool-${"private-".repeat(1_000)}`,
      rawEvent: `raw-event-${"private-".repeat(1_000)}`,
      rawReview: `raw-review-${"private-".repeat(1_000)}`,
      attemptWorkspace: `C:/private/${"attempt-workspace-".repeat(300)}`,
      attemptBaseline: `C:/private/${"attempt-baseline-".repeat(300)}`,
      templateWorkspace: `C:/private/${"template-workspace-".repeat(300)}/workspaces/exercises/portable-exercise`,
    };
    const connection = openDatabase(databasePath);
    try {
      const repository = createLearningRepository(connection, {
        now: () => 10,
      });
      await repository.setSettings([
        ["workspaceRoot", sentinels.settingsPath],
        ["zedExecutable", "C:/private/zed.exe"],
        ["unexpectedLocalPath", "C:/private/other"],
        [
          "providerHubManagedConnections",
          {
            version: 1,
            connections: [
              {
                connectionId: "conn:test",
                catalogId: "custom-openai-compatible",
                displayName: "External provider",
                baseUrl: sentinels.managedBaseUrl,
                modelIds: ["test-model"],
              },
            ],
          },
        ],
      ]);
      connection.sqlite
        .prepare(
          `INSERT INTO curriculum_days
            (id, slug, week_number, day_number, title, summary,
             estimated_minutes, goals_json, sources_json, created_at, updated_at)
           VALUES ('portable-day', 'portable-day', 1, 1, 'Portable day',
                   'Portable day', 1, '[]', '[]', 1, 1)`,
        )
        .run();
      connection.sqlite
        .prepare(
          `INSERT INTO exercises
            (id, day_id, slug, title, prompt, difficulty, estimated_minutes,
             workspace_path, constraints_json, criteria_json,
             allowed_operations_json, active, created_at, updated_at)
           VALUES ('portable-exercise', 'portable-day', 'portable-exercise',
                   'Portable exercise', 'Prompt', 'easy', 1, ?, '[]', '[]',
                   '[]', 1, 1, 1)`,
        )
        .run(sentinels.templateWorkspace);
      connection.sqlite
        .prepare(
          `INSERT INTO learning_sessions
            (id, day_id, status, current_step, started_at, completed_at, updated_at)
           VALUES ('portable-session', 'portable-day', 'completed', 'done',
                   1, 2, 2)`,
        )
        .run();
      connection.sqlite
        .prepare(
          `INSERT INTO exercise_attempts
            (id, session_id, exercise_id, status, workspace_path,
              baseline_path, baseline_hash, started_at, completed_at, updated_at)
            VALUES ('portable-attempt', 'portable-session', 'portable-exercise',
                    'completed', ?, ?, 'baseline', 1, 2, 2)`,
        )
        .run(sentinels.attemptWorkspace, sentinels.attemptBaseline);
      connection.sqlite
        .prepare(
          `INSERT INTO agent_conversations
            (id, role, provider_id, model_id, provider_session_id,
             status, created_at, updated_at)
           VALUES ('portable-conversation', 'teacher', 'pi', 'test-model',
                    ?, 'active', 1, 1)`,
        )
        .run(sentinels.providerSession);
      connection.sqlite
        .prepare(
          `INSERT INTO provider_configurations
            (provider_id, enabled, endpoint, teacher_model_id,
             reviewer_model_id, interviewer_model_id, options_json,
             updated_at)
            VALUES ('portable-provider', 1, ?, NULL, NULL, NULL, ?, 1)`,
        )
        .run(
          sentinels.legacyEndpoint,
          JSON.stringify({ token: sentinels.legacyOptions }),
        );
      connection.sqlite
        .prepare(
          `INSERT INTO provider_hub_connections
            (connection_id, adapter_id, provider_type, display_name,
             credential_ref, endpoint_profile_id, enabled, external, state,
             observed_capabilities_json, last_checked_at, created_at, updated_at)
           VALUES ('conn:portable-secret', 'pi', 'openai-compatible',
                   'Portable secret', ?, ?, 1, 1, 'connected', ?,
                   '2026-08-12T00:00:00.000Z', 1, 1)`,
        )
        .run(
          sentinels.credentialRef,
          sentinels.endpointProfile,
          JSON.stringify({ payload: sentinels.observedCapabilities }),
        );
    } finally {
      connection.close();
    }

    const exported = await createPortableDataBundle({
      projectRoot,
      testHooks: {
        afterSnapshot: (snapshotPath) => {
          const snapshot = openDatabase(snapshotPath);
          try {
            snapshot.sqlite
              .prepare(
                `INSERT INTO agent_messages
                  (id, conversation_id, role, content, tool_events_json,
                   raw_event_json, status, sequence, created_at)
                 VALUES ('portable-message', 'portable-conversation',
                         'assistant', 'Sanitized message', ?, ?, 'completed',
                         1, 1)`,
              )
              .run(
                JSON.stringify([{ payload: sentinels.rawToolEvent }]),
                JSON.stringify({ payload: sentinels.rawEvent }),
              );
            snapshot.sqlite
              .prepare(
                `INSERT INTO reviews
                  (id, session_id, exercise_attempt_id, provider_id, model_id,
                   status, result_json, raw_response, created_at, completed_at)
                  VALUES ('portable-review', 'portable-session',
                          'portable-attempt', 'pi', 'test-model', 'passed',
                          NULL, ?, 1, 2)`,
              )
              .run(sentinels.rawReview);
          } finally {
            snapshot.close();
          }
        },
      },
    });
    const bundleBytes = readFileSync(exported.bundlePath);
    for (const sentinel of Object.values(sentinels)) {
      expect(bundleBytes.includes(Buffer.from(sentinel))).toBe(false);
    }
    const restoreRoot = temporaryRoot("aptiloop-portable-sanitize-restore-");
    const restored = await restorePortableDataBundle({
      projectRoot: restoreRoot,
      sourcePath: exported.bundlePath,
    });
    const portable = openDatabase(restored.activeDatabasePath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      expect(
        portable.sqlite
          .prepare(
            "SELECT provider_session_id AS providerSessionId FROM agent_conversations WHERE id = 'portable-conversation'",
          )
          .get(),
      ).toEqual({ providerSessionId: null });
      expect(
        portable.sqlite
          .prepare(
            "SELECT options_json AS optionsJson FROM provider_configurations WHERE provider_id = 'mock'",
          )
          .get(),
      ).toEqual(undefined);
      expect(
        portable.sqlite
          .prepare(
            "SELECT options_json AS optionsJson FROM provider_configurations WHERE provider_id = 'portable-provider'",
          )
          .get(),
      ).toEqual({ optionsJson: "{}" });
      expect(
        portable.sqlite
          .prepare(
            "SELECT key FROM application_settings WHERE key IN ('workspaceRoot','zedExecutable','unexpectedLocalPath')",
          )
          .all(),
      ).toEqual([]);
      const settings = portable.sqlite
        .prepare(
          "SELECT value_json AS valueJson FROM application_settings WHERE key = 'providerHubManagedConnections'",
        )
        .get() as { valueJson: string };
      expect(JSON.parse(settings.valueJson)).toMatchObject({
        connections: [{ baseUrl: null }],
      });
    } finally {
      portable.close();
    }
    expect(JSON.stringify(exported.manifest)).not.toContain(
      sentinels.providerSession,
    );
  });

  it("ports only relative trusted exercise templates and rejects residual structured device paths", async () => {
    const projectRoot = temporaryRoot("aptiloop-portable-path-policy-");
    const databasePath = createActiveDatabase(projectRoot);
    const portableTemplate = "workspaces/exercises/portable-template";
    const absoluteTemplate = path.join(projectRoot, portableTemplate);
    const structuredPath = `C:/private/${"structured-path-".repeat(200)}`;
    const connection = openDatabase(databasePath);
    try {
      connection.sqlite
        .prepare(
          `INSERT INTO curriculum_days
            (id, slug, week_number, day_number, title, summary,
             estimated_minutes, goals_json, sources_json, created_at, updated_at)
           VALUES ('portable-day', 'portable-day', 1, 1, 'Portable day',
                   'Portable day', 1, '[]', '[]', 1, 1)`,
        )
        .run();
      connection.sqlite
        .prepare(
          `INSERT INTO exercises
            (id, day_id, slug, title, prompt, difficulty, estimated_minutes,
             workspace_path, constraints_json, criteria_json,
             allowed_operations_json, active, created_at, updated_at)
           VALUES ('portable-exercise', 'portable-day', 'portable-exercise',
                   'Portable exercise', 'Prompt', 'easy', 1, ?, '[]', '[]',
                   '[]', 1, 1, 1)`,
        )
        .run(absoluteTemplate);
      connection.sqlite
        .prepare(
          `INSERT INTO course_pack_quarantine
            (id, source_bytes_hash, validator_version, report_json, created_at)
           VALUES ('portable-quarantine', ?, 'v1', ?, 1)`,
        )
        .run("a".repeat(64), JSON.stringify({ path: structuredPath }));
    } finally {
      connection.close();
    }

    await expect(createPortableDataBundle({ projectRoot })).rejects.toThrow(
      /device path in course_pack_quarantine\.report_json/iu,
    );

    const cleanRoot = temporaryRoot("aptiloop-portable-path-clean-");
    const cleanDatabasePath = createActiveDatabase(cleanRoot);
    const clean = openDatabase(cleanDatabasePath);
    try {
      clean.sqlite
        .prepare(
          `INSERT INTO curriculum_days
            (id, slug, week_number, day_number, title, summary,
             estimated_minutes, goals_json, sources_json, created_at, updated_at)
           VALUES ('portable-day', 'portable-day', 1, 1, 'Portable day',
                   'Portable day', 1, '[]', '[]', 1, 1)`,
        )
        .run();
      clean.sqlite
        .prepare(
          `INSERT INTO exercises
            (id, day_id, slug, title, prompt, difficulty, estimated_minutes,
             workspace_path, constraints_json, criteria_json,
             allowed_operations_json, active, created_at, updated_at)
           VALUES ('portable-exercise', 'portable-day', 'portable-exercise',
                   'Portable exercise', 'Prompt', 'easy', 1, ?, '[]', '[]',
                   '[]', 1, 1, 1)`,
        )
        .run(path.join(cleanRoot, portableTemplate));
    } finally {
      clean.close();
    }
    const exported = await createPortableDataBundle({ projectRoot: cleanRoot });
    const restored = await restorePortableDataBundle({
      projectRoot: temporaryRoot("aptiloop-portable-path-restore-"),
      sourcePath: exported.bundlePath,
    });
    const portable = openDatabase(restored.activeDatabasePath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      expect(
        portable.sqlite
          .prepare(
            "SELECT workspace_path AS workspacePath FROM exercises WHERE id = ?",
          )
          .get("portable-exercise"),
      ).toEqual({ workspacePath: portableTemplate });
      expect(portable.sqlite.prepare("PRAGMA freelist_count").get()).toEqual({
        freelist_count: 0,
      });
    } finally {
      portable.close();
    }
    expect(
      readFileSync(exported.bundlePath).includes(Buffer.from(absoluteTemplate)),
    ).toBe(false);
  });

  it("rejects arbitrary absolute paths under nested path keys without treating URLs as paths", async () => {
    const rejectedPaths = [
      "/custom/private/state",
      "/Users/yan/private/state",
      "/Applications/Aptiloop/private",
      "\\Windows\\Temp\\private",
      "\\\\server\\share\\private",
      "file:///private/state",
    ];
    for (const [index, rejectedPath] of rejectedPaths.entries()) {
      const projectRoot = temporaryRoot(`aptiloop-path-family-${index}-`);
      const databasePath = createActiveDatabase(projectRoot);
      const connection = openDatabase(databasePath);
      try {
        connection.sqlite
          .prepare(
            `INSERT INTO course_pack_quarantine
              (id, source_bytes_hash, validator_version, report_json, created_at)
             VALUES (?, ?, 'v1', ?, 1)`,
          )
          .run(
            `path-family-${index}`,
            `path-family-${index}`,
            JSON.stringify({ nested: { workspacePath: rejectedPath } }),
          );
      } finally {
        connection.close();
      }
      await expect(createPortableDataBundle({ projectRoot })).rejects.toThrow(
        /device path in course_pack_quarantine\.report_json/iu,
      );
    }

    const allowedRoot = temporaryRoot("aptiloop-path-url-");
    const allowedDatabasePath = createActiveDatabase(allowedRoot);
    const allowed = openDatabase(allowedDatabasePath);
    try {
      allowed.sqlite
        .prepare(
          `INSERT INTO course_pack_quarantine
            (id, source_bytes_hash, validator_version, report_json, created_at)
           VALUES ('path-url', 'path-url', 'v1', ?, 1)`,
        )
        .run(
          JSON.stringify({
            documentationUrl: "https://example.test/v1",
            apiRoute: "/v1",
            protocolRelativeUrl: "//cdn.example.test/image.png",
            modelId: "provider/model-id",
          }),
        );
    } finally {
      allowed.close();
    }
    await expect(
      createPortableDataBundle({ projectRoot: allowedRoot }),
    ).resolves.toMatchObject({
      manifest: { sanitizationPolicy: "aptiloop-portable-profile-v1" },
    });
  });

  it("removes provider turn metadata from the compact rebuilt payload", async () => {
    const projectRoot = temporaryRoot("aptiloop-portable-turn-metadata-");
    const databasePath = createActiveDatabase(projectRoot);
    const metadataSentinel = `turn-metadata-${"private-".repeat(1_000)}`;
    const connection = openDatabase(databasePath);
    try {
      connection.sqlite
        .prepare(
          `INSERT INTO provider_hub_connections
            (connection_id, adapter_id, provider_type, display_name,
             credential_ref, endpoint_profile_id, enabled, external, state,
             observed_capabilities_json, last_checked_at, created_at, updated_at)
           VALUES ('conn:metadata', 'pi', 'openai', 'Metadata provider',
                   NULL, NULL, 0, 1, 'disabled', NULL, NULL, 1, 1)`,
        )
        .run();
      connection.sqlite
        .prepare(
          `INSERT INTO provider_turn_provenance
            (operation_id, connection_id, provider_type, adapter_id, model_id,
             role, tool_policy_id, capability_observed_at,
             disclosure_operation_id, status, failure_code, metadata_json,
             created_at, completed_at)
           VALUES ('operation:metadata', 'conn:metadata', 'openai', 'pi',
                   'model', 'tutor', 'policy:tutor', NULL, NULL, 'completed',
                   NULL, ?, '2026-08-12T00:00:00.000Z',
                   '2026-08-12T00:00:01.000Z')`,
        )
        .run(JSON.stringify({ payload: metadataSentinel }));
    } finally {
      connection.close();
    }

    const exported = await createPortableDataBundle({ projectRoot });
    expect(
      readFileSync(exported.bundlePath).includes(Buffer.from(metadataSentinel)),
    ).toBe(false);
    const restored = await restorePortableDataBundle({
      projectRoot: temporaryRoot("aptiloop-portable-turn-metadata-restore-"),
      sourcePath: exported.bundlePath,
    });
    const portable = openDatabase(restored.activeDatabasePath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      expect(
        portable.sqlite
          .prepare(
            `SELECT metadata_json AS metadataJson
             FROM provider_turn_provenance
             WHERE operation_id = 'operation:metadata'`,
          )
          .get(),
      ).toEqual({ metadataJson: null });
    } finally {
      portable.close();
    }
  });

  it("refuses overwrite on export and restore without changing existing bytes", async () => {
    const projectRoot = temporaryRoot("aptiloop-portable-no-overwrite-");
    createActiveDatabase(projectRoot);
    const exported = await createPortableDataBundle({
      projectRoot,
      destinationPath: "fixed.aptiloop-data",
    });
    const bundleHash = sha256(exported.bundlePath);
    await expect(
      createPortableDataBundle({
        projectRoot,
        destinationPath: "fixed.aptiloop-data",
      }),
    ).rejects.toThrow("Refusing to replace");
    expect(sha256(exported.bundlePath)).toBe(bundleHash);

    const restoreRoot = temporaryRoot("aptiloop-portable-existing-");
    const existingPath = createActiveDatabase(restoreRoot);
    const existingHash = sha256(existingPath);
    await expect(
      restorePortableDataBundle({
        projectRoot: restoreRoot,
        sourcePath: exported.bundlePath,
      }),
    ).rejects.toThrow("Restore is create-only");
    expect(sha256(existingPath)).toBe(existingHash);
  });

  it("rejects tampered, linked, and wrong-schema bundles", async (context) => {
    const projectRoot = temporaryRoot("aptiloop-portable-invalid-");
    createActiveDatabase(projectRoot);
    const exported = await createPortableDataBundle({ projectRoot });
    const original = readFileSync(exported.bundlePath);

    const tampered = path.join(projectRoot, "tampered.aptiloop-data");
    const changed = Buffer.from(original);
    const finalByte = changed.at(-1);
    if (finalByte === undefined) throw new Error("Bundle fixture is empty");
    changed[changed.length - 1] = finalByte ^ 0xff;
    writeFileSync(tampered, changed, { flag: "wx" });
    const restoreRoot = temporaryRoot("aptiloop-portable-tampered-");
    await expect(
      restorePortableDataBundle({
        projectRoot: restoreRoot,
        sourcePath: tampered,
      }),
    ).rejects.toThrow("SHA-256");
    expect(
      existsSync(
        path.join(restoreRoot, ".data", "dev-learning-harness.sqlite"),
      ),
    ).toBe(false);

    const wrongPolicy = path.join(projectRoot, "wrong-policy.aptiloop-data");
    writeFileSync(
      wrongPolicy,
      rewriteBundleManifest(original, (manifest) => {
        manifest.sanitizationPolicy = "attacker-defined-policy";
      }),
      { flag: "wx" },
    );
    await expect(
      restorePortableDataBundle({
        projectRoot: temporaryRoot("aptiloop-portable-wrong-policy-"),
        sourcePath: wrongPolicy,
      }),
    ).rejects.toThrow(/manifest header is invalid/iu);

    const parsedOriginal = parsePortableDataBundleFile(exported.bundlePath);
    const forgedPayloadPath = path.join(projectRoot, "forged-payload.sqlite");
    writeFileSync(
      forgedPayloadPath,
      original.subarray(parsedOriginal.payloadOffset),
      { flag: "wx" },
    );
    const forgedPayloadConnection = openDatabase(forgedPayloadPath);
    try {
      forgedPayloadConnection.sqlite
        .prepare(
          `INSERT INTO provider_configurations
            (provider_id, enabled, endpoint, teacher_model_id,
             reviewer_model_id, interviewer_model_id, options_json, updated_at)
           VALUES ('forged-provider', 1, 'https://attacker.example/v1',
                   NULL, NULL, NULL, '{"token":"forged-secret"}', 1)`,
        )
        .run();
      forgedPayloadConnection.sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      forgedPayloadConnection.sqlite.exec("PRAGMA journal_mode = DELETE");
      forgedPayloadConnection.sqlite.exec("VACUUM");
    } finally {
      forgedPayloadConnection.close();
    }
    const forged = payloadManifest(forgedPayloadPath);
    const selfConsistent = path.join(
      projectRoot,
      "self-consistent-forged.aptiloop-data",
    );
    writeFileSync(
      selfConsistent,
      rewriteBundleManifest(
        original,
        (manifest) => {
          const payload = manifest.payload;
          if (
            !payload ||
            typeof payload !== "object" ||
            Array.isArray(payload)
          ) {
            throw new Error("Portable test manifest payload is invalid");
          }
          Object.assign(payload, forged.manifest);
        },
        forged.bytes,
      ),
      { flag: "wx" },
    );
    const selfConsistentRestoreRoot = temporaryRoot(
      "aptiloop-portable-self-consistent-",
    );
    await expect(
      restorePortableDataBundle({
        projectRoot: selfConsistentRestoreRoot,
        sourcePath: selfConsistent,
      }),
    ).rejects.toThrow(/portable database policy validation failed/iu);
    expect(
      existsSync(
        path.join(
          selfConsistentRestoreRoot,
          ".data",
          "dev-learning-harness.sqlite",
        ),
      ),
    ).toBe(false);

    const linked = path.join(projectRoot, "linked.aptiloop-data");
    if (!tryCreateHardLink(context, exported.bundlePath, linked)) return;
    await expect(
      restorePortableDataBundle({
        projectRoot: temporaryRoot("aptiloop-portable-linked-"),
        sourcePath: linked,
      }),
    ).rejects.toThrow(/without links|one regular file/u);
  });
});
