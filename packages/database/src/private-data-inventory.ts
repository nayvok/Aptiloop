import { createHash, type Hash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeSync,
  type BigIntStats,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { DatabaseSync } from "node:sqlite";

import { SessionSnapshotSchema } from "@dlh/shared";

const currentSessionSnapshotSchemaVersion = 2;
const strictSessionSnapshotSchema = SessionSnapshotSchema.strict();

function canonicalizeSnapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeSnapshotValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalizeSnapshotValue(child)]),
    );
  }
  return value;
}
type QuarantinedSessionSourceTable =
  "curriculum_versions" | "curriculum_days_v2" | "session_snapshots";

function matchesCurrentSourceRowHash(
  sqlite: DatabaseSync,
  table: QuarantinedSessionSourceTable,
  id: string,
  expectedHash: unknown,
): boolean {
  if (
    typeof expectedHash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(expectedHash)
  ) {
    return false;
  }
  const row = sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as
    Record<string, unknown> | undefined;
  if (row === undefined) return false;
  const hash = createHash("sha256")
    .update(JSON.stringify(canonicalizeSnapshotValue(row)))
    .digest("hex");
  return hash === expectedHash;
}

export interface PrivateDataInventoryInput {
  roots?: readonly string[];
  databasePaths?: readonly string[];
}

export interface InventoryFileMetadata {
  present: boolean;
  bytes: number;
  modifiedAtMs: number;
  sha256: string | null;
}

export interface LogicalAgentMessageCounts {
  tablePresent: boolean;
  schemaCompatible: boolean;
  rows: number;
  toolEventBytes: number | null;
  nonEmptyToolEventRows: number | null;
  invalidToolEventRows: number | null;
  rawEventBytes: number | null;
  rawEventRows: number | null;
  invalidRawEventRows: number | null;
}

export interface LogicalReviewCounts {
  tablePresent: boolean;
  schemaCompatible: boolean;
  rows: number;
  rawResponseBytes: number | null;
  rawResponseRows: number | null;
}
export interface LogicalSessionSnapshotInventory {
  tablePresent: boolean;
  schemaCompatible: boolean;
  rows: number;
  storedContentHashRows: number | null;
  snapshotJsonBytes: number | null;
  contentHashInventorySha256: string | null;
  snapshotBytesInventorySha256: string | null;
}
export interface MigrationLedgerInventory {
  tablePresent: boolean;
  schemaCompatible: boolean;
  count: number;
  ids: string[];
}

export interface M2TableInventory {
  tablePresent: boolean;
  schemaCompatible: boolean;
  rows: number;
}

export interface M2CourseInventory extends M2TableInventory {
  activeRevisionRows: number | null;
  missingActiveRevisionRows: number | null;
}
export interface M2SourceSnapshotInventory extends M2TableInventory {
  contentRows: number | null;
  contentBytes: number | null;
  fullRetentionRows: number | null;
  extractRetentionRows: number | null;
  metadataOnlyRows: number | null;
  invalidRetentionRows: number | null;
  retentionMismatchRows: number | null;
  contentHashInventorySha256: string | null;
}

export interface M2PrivatePayloadInventory {
  inspected: boolean;
  activityRows: number | null;
  activityPayloadBytes: number | null;
  protectedMaterialBytes: number | null;
  sourceContentRows: number | null;
  sourceContentBytes: number | null;
  capsuleRows: number | null;
  capsulePayloadBytes: number | null;
  evidenceRows: number | null;
  evidencePayloadBytes: number | null;
  evidenceProvenanceBytes: number | null;
  reviewItemRows: number | null;
  reviewItemPayloadBytes: number | null;
  totalBytes: number | null;
}

export interface M2CourseRevisionInventory extends M2TableInventory {
  draftRows: number | null;
  publishedRows: number | null;
  archivedRows: number | null;
  acceptedContentHashRows: number | null;
  contentHashInventorySha256: string | null;
}

export interface M2SessionContextInventory extends M2TableInventory {
  activeSessionRows: number | null;
  activeSessionsWithContextRows: number | null;
  activeSessionsMissingContextRows: number | null;
  quarantinedActiveSessionsMissingContextRows: number | null;
  unaccountedActiveSessionsMissingContextRows: number | null;
  quarantinedActiveSessionSourceHashMismatchRows: number | null;
  snapshotMismatchRows: number | null;
  snapshotBytesHashMissingRows: number | null;
  snapshotBytesHashMismatchRows: number | null;
  snapshotStrictParseMismatchRows: number | null;
  snapshotSchemaVersionMismatchRows: number | null;
  snapshotEmbeddedIdentityMismatchRows: number | null;
  snapshotEmbeddedContentHashMismatchRows: number | null;
  snapshotCanonicalCoreHashMismatchRows: number | null;
}

export interface M2EvidenceInventory extends M2TableInventory {
  recallAttemptRows: number | null;
  quizAnswerRows: number | null;
  codeReadingAttemptRows: number | null;
  summaryRows: number | null;
  invalidTypeRows: number | null;
}

export interface M2MigrationRunInventory extends M2TableInventory {
  m2V1Rows: number | null;
  m2V2Rows: number | null;
  correctionSourceDatabaseDigest: string | null;
  correctionApprovedBackupLogicalSha256: string | null;
  correctionApprovedBackupSha256: string | null;
  correctionApprovedBackupPathHash: string | null;
  m2V3Rows: number | null;
  hardeningSourceDatabaseDigest: string | null;
  hardeningApprovedBackupLogicalSha256: string | null;
  hardeningApprovedBackupSha256: string | null;
  hardeningApprovedBackupPathHash: string | null;
  m2V4Rows: number | null;
  quarantineImmutabilitySourceDatabaseDigest: string | null;
  quarantineImmutabilityApprovedBackupLogicalSha256: string | null;
  quarantineImmutabilityApprovedBackupSha256: string | null;
  quarantineImmutabilityApprovedBackupPathHash: string | null;
  sourceRowCount: number | null;
  mappedRows: number | null;
  quarantinedRows: number | null;
  intentionallyUnmappedRows: number | null;
  reconciled: boolean;
  sourceDatabaseDigest: string | null;
  approvedBackupLogicalSha256: string | null;
  approvedBackupSha256: string | null;
  approvedBackupPathHash: string | null;
}

export interface M2ProvenanceInventory extends M2TableInventory {
  m2V1Rows: number | null;
  mappedRows: number | null;
  quarantinedRows: number | null;
  intentionallyUnmappedRows: number | null;
  invalidStatusRows: number | null;
  quarantinedRevisionSourceHashMismatchRows: number | null;
}

export interface M2QuarantineInventory extends M2TableInventory {
  m2V1Rows: number | null;
  unresolvedRows: number | null;
  invalidResolutionRows: number | null;
  distinctReasonCount: number | null;
}

export interface M2OrphanInventory {
  inspected: boolean;
  total: number | null;
  revisionScopeRows: number | null;
  revisionParentRows: number | null;
  courseActiveRevisionRows: number | null;
  sectionScopeRows: number | null;
  lessonScopeRows: number | null;
  lessonPrerequisiteScopeRows: number | null;
  activityScopeRows: number | null;
  activityPrerequisiteScopeRows: number | null;
  sourceSnapshotScopeRows: number | null;
  sourceSnapshotSupersedesScopeRows: number | null;
  knowledgeCapsuleScopeRows: number | null;
  knowledgeCapsuleSourceScopeRows: number | null;
  adaptationBranchScopeRows: number | null;
  sessionContextScopeRows: number | null;
  evidenceScopeRows: number | null;
  reviewItemScopeRows: number | null;
  provenanceRunRows: number | null;
  quarantineProvenanceRows: number | null;
}

export interface M2FoundationInventory {
  present: boolean;
  complete: boolean;
  expectedTableCount: number;
  presentTableCount: number;
  incompatibleTableCount: number;
  tables: Record<string, M2TableInventory>;
  courses: M2CourseInventory;
  revisions: M2CourseRevisionInventory;
  sourceSnapshots: M2SourceSnapshotInventory;
  privatePayloads: M2PrivatePayloadInventory;
  sessionContexts: M2SessionContextInventory;
  evidence: M2EvidenceInventory;
  runs: M2MigrationRunInventory;
  provenance: M2ProvenanceInventory;
  quarantine: M2QuarantineInventory;
  orphans: M2OrphanInventory;
}

export interface LegacyCompatibilityHealth {
  readonly coherent: boolean;
  readonly activeSessionCount: number;
  readonly nonLegacyActiveSessionCount: number;
}

export interface DatabaseInventoryHealth {
  opened: true;
  journalMode: string;
  logicalSha256: string;
  schemaSha256: string;
  userVersion: number;
  integrityOk: boolean;
  integrityResultCount: number;
  foreignKeyViolationCount: number;
  migrations: MigrationLedgerInventory;
  agentMessages: LogicalAgentMessageCounts;
  legacyCompatibility: LegacyCompatibilityHealth;
  reviews: LogicalReviewCounts;
  sessionSnapshots: LogicalSessionSnapshotInventory;
  m2: M2FoundationInventory;
}

export interface DatabaseInventoryFailure {
  opened: false;
  error: {
    name: string;
    code: string | null;
  };
}

export interface PrivateDataInventoryCandidate {
  id: string;
  origins: string[];
  classification: "database" | "backup";
  pathHash: string;
  family: {
    main: InventoryFileMetadata;
    wal: InventoryFileMetadata;
    shm: InventoryFileMetadata;
    journal: InventoryFileMetadata;
  };
  sourceStable: boolean;
  health: DatabaseInventoryHealth | DatabaseInventoryFailure;
}

export interface PrivateDataInventory {
  schemaVersion: 1;
  input: {
    rootIds: string[];
    explicitDatabaseIds: string[];
  };
  candidateCount: number;
  candidates: PrivateDataInventoryCandidate[];
}

interface CandidateSeed {
  path: string;
  trustedRoot: string;
  origins: Set<string>;
}

const databaseFilePattern = /\.(?:sqlite3?|db3?)$/i;
const databaseSidecarPattern = /^(.*\.(?:sqlite3?|db3?))-(?:wal|shm|journal)$/i;
const safeMigrationIdPattern = /^\d{4}_[a-z0-9_]{1,80}$/;
const expectedAgentMessageColumns = [
  "id",
  "conversation_id",
  "role",
  "content",
  "tool_events_json",
  "raw_event_json",
  "status",
  "sequence",
  "idempotency_key",
  "created_at",
] as const;
const expectedReviewColumns = [
  "id",
  "session_id",
  "exercise_attempt_id",
  "provider_id",
  "model_id",
  "status",
  "result_json",
  "raw_response",
  "created_at",
  "completed_at",
] as const;
const expectedSessionSnapshotColumns = [
  "id",
  "session_id",
  "schema_version",
  "curriculum_id",
  "curriculum_version_id",
  "curriculum_day_id",
  "content_hash",
  "snapshot_json",
  "created_at",
] as const;
const expectedMigrationColumns = ["id", "applied_at"] as const;
const m2ExpectedTableColumns = {
  courses: [
    "id",
    "stable_id",
    "slug",
    "title",
    "description",
    "primary_locale",
    "active_revision_id",
    "created_at",
    "updated_at",
  ],
  course_revisions: [
    "id",
    "course_id",
    "revision_number",
    "parent_revision_id",
    "branch_kind",
    "status",
    "title",
    "description",
    "content_hash",
    "based_on_content_hash",
    "created_at",
    "published_at",
    "archived_at",
    "updated_at",
  ],
  course_sections: [
    "id",
    "course_id",
    "revision_id",
    "stable_id",
    "order_index",
    "title",
    "description",
    "created_at",
    "updated_at",
  ],
  course_lessons: [
    "id",
    "course_id",
    "revision_id",
    "section_id",
    "stable_id",
    "order_index",
    "title",
    "description",
    "goal",
    "estimated_minutes",
    "expected_outcomes_json",
    "depth_level",
    "out_of_scope_json",
    "topics_json",
    "created_at",
    "updated_at",
  ],
  course_lesson_prerequisites: [
    "course_id",
    "revision_id",
    "lesson_id",
    "prerequisite_lesson_id",
  ],
  course_activities: [
    "id",
    "course_id",
    "revision_id",
    "lesson_id",
    "stable_id",
    "activity_type",
    "order_index",
    "title",
    "description",
    "estimated_minutes",
    "required",
    "objectives_json",
    "checklist_json",
    "sources_json",
    "questions_json",
    "misconceptions_json",
    "capability_ids_json",
    "completion_criteria_json",
    "payload_json",
    "protected_material_json",
    "depth_level",
    "created_at",
    "updated_at",
  ],
  course_activity_prerequisites: [
    "course_id",
    "revision_id",
    "lesson_id",
    "activity_id",
    "prerequisite_activity_id",
  ],
  source_snapshots: [
    "id",
    "course_id",
    "revision_id",
    "source_authority_id",
    "canonical_url",
    "retrieved_at",
    "retrieval_method",
    "media_type",
    "locale",
    "content_hash",
    "title",
    "author_publisher",
    "published_or_updated_at",
    "attribution",
    "license_spdx",
    "terms_url",
    "content",
    "locator_map_json",
    "retention_mode",
    "supersedes_snapshot_id",
    "created_at",
  ],
  knowledge_capsules: [
    "id",
    "schema_version",
    "course_id",
    "revision_id",
    "knowledge_node_ids_json",
    "primary_locale",
    "claims_json",
    "citations_json",
    "conflicts_json",
    "created_by",
    "validation_hash",
    "created_at",
  ],
  knowledge_capsule_sources: [
    "course_id",
    "revision_id",
    "capsule_id",
    "source_snapshot_id",
  ],
  adaptation_branches: [
    "id",
    "course_id",
    "owner",
    "base_revision_id",
    "head_revision_id",
    "status",
    "created_at",
    "updated_at",
  ],
  session_course_contexts: [
    "session_id",
    "course_id",
    "revision_id",
    "lesson_id",
    "session_snapshot_id",
    "snapshot_hash",
    "snapshot_bytes_hash",
    "created_at",
  ],
  evidence_facts: [
    "id",
    "schema_version",
    "operation_id",
    "course_id",
    "revision_id",
    "lesson_id",
    "session_id",
    "activity_id",
    "evidence_type",
    "question_id",
    "correctness",
    "occurred_at",
    "recorded_at",
    "payload_json",
    "provenance_json",
  ],
  review_items: [
    "id",
    "course_id",
    "revision_id",
    "source_evidence_id",
    "kind",
    "status",
    "due_at",
    "payload_json",
    "scheduler_version",
    "created_at",
  ],
  migration_runs: [
    "id",
    "transform_version",
    "source_database_digest",
    "source_rows_digest",
    "approved_backup_logical_sha256",
    "approved_backup_sha256",
    "approved_backup_path_hash",
    "status",
    "source_row_count",
    "mapped_count",
    "quarantined_count",
    "intentionally_unmapped_count",
    "started_at",
    "completed_at",
  ],
  migration_provenance: [
    "id",
    "run_id",
    "source_database_digest",
    "source_table",
    "source_primary_key",
    "source_row_hash",
    "target_entity_type",
    "target_id",
    "transform_version",
    "status",
    "reason_code",
    "diagnostic",
    "created_at",
  ],
  migration_quarantine: [
    "id",
    "provenance_id",
    "run_id",
    "source_table",
    "source_primary_key",
    "source_row_hash",
    "candidate_course_id",
    "candidate_revision_id",
    "candidate_lesson_id",
    "candidate_activity_id",
    "reason_code",
    "diagnostic",
    "resolution_status",
    "created_at",
  ],
} as const;
type M2TableName = keyof typeof m2ExpectedTableColumns;
const m2TableNames = Object.keys(m2ExpectedTableColumns) as M2TableName[];
const inspectableInventoryTables: Readonly<Record<string, true>> = {
  __dlh_migrations: true,
  agent_messages: true,
  reviews: true,
  session_snapshots: true,
};
const countableInventoryTables: Readonly<Record<string, true>> = {
  agent_messages: true,
  reviews: true,
  session_snapshots: true,
};

export function inventoryPrivateData(
  input: PrivateDataInventoryInput,
): PrivateDataInventory {
  const roots = canonicalizeInputs(input.roots ?? []);
  const explicitDatabases = canonicalizeInputs(input.databasePaths ?? []);
  if (!roots.length && !explicitDatabases.length) {
    throw new Error("At least one explicit root or database path is required");
  }

  const candidates = new Map<string, CandidateSeed>();
  const rootIds = roots.map((root) => `root-${shortHash(root)}`);
  roots.forEach((root, index) => {
    assertSafeInventoryDirectory(root, root, true);
    collectRootCandidates(root, rootIds[index] ?? "root", candidates);
  });

  const explicitDatabaseIds = explicitDatabases.map(
    (path) => `database-${shortHash(path)}`,
  );
  explicitDatabases.forEach((path, index) => {
    const mainPath = toMainDatabasePath(path);
    if (!mainPath) {
      throw new Error(`Explicit path is not a SQLite database family: ${path}`);
    }
    addCandidate(
      candidates,
      mainPath,
      dirname(mainPath),
      `${explicitDatabaseIds[index] ?? "database"}:${basename(mainPath)}`,
    );
  });

  const inventoryCandidates = [...candidates.values()]
    .sort((left, right) => comparePaths(left.path, right.path))
    .map(inspectCandidate);

  return {
    schemaVersion: 1,
    input: { rootIds, explicitDatabaseIds },
    candidateCount: inventoryCandidates.length,
    candidates: inventoryCandidates,
  };
}

export function inventoryHasBlockingHealth(
  inventory: PrivateDataInventory,
): boolean {
  return (
    inventory.candidateCount === 0 ||
    inventory.candidates.some(
      (candidate) =>
        !candidate.sourceStable ||
        !candidate.health.opened ||
        !candidate.health.integrityOk ||
        candidate.health.foreignKeyViolationCount > 0 ||
        (candidate.health.m2.present &&
          (!candidate.health.m2.complete ||
            !candidate.health.m2.runs.reconciled ||
            candidate.health.m2.runs.sourceDatabaseDigest === null ||
            candidate.health.m2.runs.approvedBackupLogicalSha256 !==
              candidate.health.m2.runs.sourceDatabaseDigest ||
            candidate.health.m2.runs.approvedBackupSha256 === null ||
            candidate.health.m2.runs.approvedBackupPathHash === null ||
            candidate.health.m2.orphans.total !== 0 ||
            candidate.health.m2.sessionContexts
              .unaccountedActiveSessionsMissingContextRows !== 0 ||
            candidate.health.m2.sessionContexts.snapshotMismatchRows !== 0 ||
            candidate.health.m2.sessionContexts
              .snapshotStrictParseMismatchRows !== 0 ||
            candidate.health.m2.sessionContexts
              .snapshotSchemaVersionMismatchRows !== 0 ||
            candidate.health.m2.sessionContexts
              .snapshotEmbeddedIdentityMismatchRows !== 0 ||
            candidate.health.m2.sessionContexts
              .snapshotEmbeddedContentHashMismatchRows !== 0 ||
            candidate.health.m2.sessionContexts
              .snapshotCanonicalCoreHashMismatchRows !== 0 ||
            candidate.health.m2.sessionContexts.snapshotBytesHashMissingRows !==
              0 ||
            candidate.health.m2.sessionContexts
              .snapshotBytesHashMismatchRows !== 0 ||
            candidate.health.m2.evidence.invalidTypeRows !== 0 ||
            candidate.health.m2.sourceSnapshots.invalidRetentionRows !== 0 ||
            candidate.health.m2.sourceSnapshots.retentionMismatchRows !== 0 ||
            candidate.health.m2.sourceSnapshots.contentHashInventorySha256 ===
              null ||
            !candidate.health.m2.privatePayloads.inspected)),
    )
  );
}

function canonicalizeInputs(paths: readonly string[]): string[] {
  const lexical = new Map<string, string>();
  for (const inputPath of paths) {
    const resolvedPath = resolve(inputPath);
    lexical.set(pathKey(resolvedPath), resolvedPath);
  }
  return [...lexical.values()].sort(comparePaths);
}

function collectRootCandidates(
  root: string,
  rootId: string,
  candidates: Map<string, CandidateSeed>,
): void {
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    if (!directory) continue;
    if (!assertSafeInventoryDirectory(directory, root, directory === root)) {
      continue;
    }
    const entries = readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const linkedMain = toMainDatabasePath(entryPath);
        if (linkedMain) {
          const relativePath = relative(root, linkedMain).replaceAll("\\", "/");
          addCandidate(
            candidates,
            linkedMain,
            root,
            `${rootId}:${relativePath}`,
          );
        }
        continue;
      }
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      const mainPath = toMainDatabasePath(entryPath);
      if (!mainPath) continue;
      const relativePath = relative(root, mainPath).replaceAll("\\", "/");
      addCandidate(candidates, mainPath, root, `${rootId}:${relativePath}`);
    }
  }
}

function toMainDatabasePath(path: string): string | null {
  const sidecarMatch = path.match(databaseSidecarPattern);
  if (sidecarMatch?.[1]) return resolve(sidecarMatch[1]);
  return databaseFilePattern.test(path) ? resolve(path) : null;
}

function addCandidate(
  candidates: Map<string, CandidateSeed>,
  candidatePath: string,
  trustedRoot: string,
  origin: string,
): void {
  const resolvedPath = resolve(candidatePath);
  const key = pathKey(resolvedPath);
  const existing = candidates.get(key);
  if (existing) {
    existing.origins.add(origin);
    return;
  }
  candidates.set(key, {
    path: resolvedPath,
    trustedRoot: resolve(trustedRoot),
    origins: new Set([origin]),
  });
}

interface InventoryFileIdentity {
  readonly device: bigint;
  readonly inode: bigint;
  readonly birthtimeNs: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
}

interface InventoryFileFingerprint {
  readonly metadata: InventoryFileMetadata;
  readonly identity: InventoryFileIdentity | null;
}

interface InventoryFamilyPaths {
  readonly main: string;
  readonly wal: string;
  readonly shm: string;
  readonly journal: string;
}

interface InventoryFamilyFingerprint {
  readonly family: PrivateDataInventoryCandidate["family"];
  readonly files: {
    readonly main: InventoryFileFingerprint;
    readonly wal: InventoryFileFingerprint;
    readonly shm: InventoryFileFingerprint;
    readonly journal: InventoryFileFingerprint;
  };
}

function inspectCandidate(seed: CandidateSeed): PrivateDataInventoryCandidate {
  const familyPaths: InventoryFamilyPaths = {
    main: seed.path,
    wal: `${seed.path}-wal`,
    shm: `${seed.path}-shm`,
    journal: `${seed.path}-journal`,
  };
  let before: InventoryFamilyFingerprint;
  try {
    before = fingerprintFamily(familyPaths, seed.trustedRoot);
  } catch (error) {
    return failedInventoryCandidate(
      seed,
      presenceOnlyFamily(familyPaths),
      error,
    );
  }

  let health: DatabaseInventoryHealth | DatabaseInventoryFailure;
  if (!before.family.main.present || before.files.main.identity === null) {
    health = {
      opened: false,
      error: { name: "MissingDatabaseFile", code: "SQLITE_MAIN_MISSING" },
    };
  } else {
    const snapshotDirectory = mkdtempSync(
      join(tmpdir(), "aptiloop-private-data-inventory-"),
    );
    const snapshotMain = join(snapshotDirectory, "candidate.sqlite");
    try {
      copyVerifiedInventoryFile(
        familyPaths.main,
        snapshotMain,
        before.files.main,
        seed.trustedRoot,
      );
      for (const suffix of ["wal", "shm", "journal"] as const) {
        const fingerprint = before.files[suffix];
        if (!fingerprint.metadata.present) continue;
        copyVerifiedInventoryFile(
          familyPaths[suffix],
          `${snapshotMain}-${suffix}`,
          fingerprint,
          seed.trustedRoot,
        );
      }
      health = inspectSnapshot(snapshotMain);
    } catch (error) {
      health = { opened: false, error: safeError(error) };
    } finally {
      rmSync(snapshotDirectory, { recursive: true, force: true });
    }
  }

  let sourceStable: boolean;
  try {
    const after = fingerprintFamily(familyPaths, seed.trustedRoot);
    sourceStable = sameFamily(before, after);
  } catch {
    sourceStable = false;
  }
  return {
    id: `sqlite-${shortHash(seed.path)}`,
    origins: [...seed.origins].sort((left, right) => left.localeCompare(right)),
    classification: isBackupPath(seed.path) ? "backup" : "database",
    pathHash: sha256(seed.path),
    family: before.family,
    sourceStable,
    health,
  };
}

function failedInventoryCandidate(
  seed: CandidateSeed,
  family: PrivateDataInventoryCandidate["family"],
  error: unknown,
): PrivateDataInventoryCandidate {
  return {
    id: `sqlite-${shortHash(seed.path)}`,
    origins: [...seed.origins].sort((left, right) => left.localeCompare(right)),
    classification: isBackupPath(seed.path) ? "backup" : "database",
    pathHash: sha256(seed.path),
    family,
    sourceStable: false,
    health: { opened: false, error: safeError(error) },
  };
}

function inspectSnapshot(
  snapshotMain: string,
): DatabaseInventoryHealth | DatabaseInventoryFailure {
  let sqlite: DatabaseSync | undefined;
  try {
    sqlite = new DatabaseSync(snapshotMain, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      timeout: 5_000,
    });
    return inspectOpenedDatabaseHealth(sqlite);
  } catch (error) {
    return { opened: false, error: safeError(error) };
  } finally {
    sqlite?.close();
  }
}

export function inspectOpenedDatabaseHealth(
  sqlite: DatabaseSync,
): DatabaseInventoryHealth {
  const journal = sqlite.prepare("PRAGMA journal_mode").get() as
    { journal_mode?: unknown } | undefined;
  const userVersion = sqlite.prepare("PRAGMA user_version").get() as
    { user_version?: unknown } | undefined;
  const integrityRows = sqlite.prepare("PRAGMA integrity_check").all() as Array<
    Record<string, unknown>
  >;
  const integrityValues = integrityRows.map((row) =>
    String(Object.values(row)[0] ?? ""),
  );
  const foreignKeyViolationCount = sqlite
    .prepare("PRAGMA foreign_key_check")
    .all().length;
  return {
    opened: true,
    logicalSha256: databaseLogicalSha256(sqlite),
    schemaSha256: databaseSchemaSha256(sqlite),
    journalMode: String(journal?.journal_mode ?? "unknown"),
    userVersion: toNumber(userVersion?.user_version),
    integrityOk:
      integrityValues.length === 1 &&
      integrityValues[0]?.toLowerCase() === "ok",
    integrityResultCount: integrityValues.length,
    foreignKeyViolationCount,
    migrations: inspectMigrations(sqlite),
    legacyCompatibility: inspectLegacyCompatibilityHealth(sqlite),
    agentMessages: inspectAgentMessages(sqlite),
    reviews: inspectReviews(sqlite),
    sessionSnapshots: inspectSessionSnapshots(sqlite),
    m2: inspectM2Foundation(sqlite),
  };
}
export function inspectLegacyCompatibilityHealth(
  sqlite: DatabaseSync,
): LegacyCompatibilityHealth {
  try {
    const activeRows = sqlite
      .prepare(
        `SELECT sessions.id AS session_id,
                sessions.curriculum_day_v2_id AS session_day_v2_id,
                snapshots.schema_version AS snapshot_schema_version,
                snapshots.curriculum_version_id AS snapshot_version_id,
                snapshots.curriculum_day_id AS snapshot_day_id,
                versions.id AS existing_version_id
         FROM learning_sessions AS sessions
         LEFT JOIN session_snapshots AS snapshots
           ON snapshots.session_id = sessions.id
         LEFT JOIN curriculum_versions AS versions
           ON versions.id = snapshots.curriculum_version_id
         WHERE sessions.status = 'active'
         ORDER BY sessions.id`,
      )
      .all() as Array<{
      session_id?: unknown;
      session_day_v2_id?: unknown;
      snapshot_schema_version?: unknown;
      snapshot_version_id?: unknown;
      snapshot_day_id?: unknown;
      existing_version_id?: unknown;
    }>;
    const coherentRows = activeRows.every(
      (row) =>
        typeof row.session_id === "string" &&
        typeof row.snapshot_version_id === "string" &&
        row.existing_version_id === row.snapshot_version_id,
    );
    const nonLegacyRows = activeRows.filter(
      (row) => row.snapshot_version_id !== "legacy-v1",
    );
    const coherentNonLegacyRows = nonLegacyRows.every(
      (row) =>
        typeof row.session_day_v2_id === "string" &&
        row.snapshot_day_id === row.session_day_v2_id &&
        toNumber(row.snapshot_schema_version) >= 2,
    );
    const legacySessionIds = new Set(
      activeRows
        .filter((row) => row.snapshot_version_id === "legacy-v1")
        .map((row) => row.session_id),
    );
    const learnerRows = sqlite
      .prepare(
        `SELECT current_learning_session_id
         FROM learner_state
         WHERE id = 'default'`,
      )
      .all() as Array<{ current_learning_session_id?: unknown }>;
    const pointer = learnerRows[0]?.current_learning_session_id;
    const pointerSession =
      typeof pointer === "string"
        ? (sqlite
            .prepare("SELECT status FROM learning_sessions WHERE id = ?")
            .get(pointer) as { status?: unknown } | undefined)
        : undefined;
    const pointerCoherent =
      learnerRows.length === 1 &&
      (nonLegacyRows.length === 1
        ? pointer === nonLegacyRows[0]?.session_id
        : nonLegacyRows.length === 0 &&
          (pointer === null ||
            legacySessionIds.has(pointer) ||
            (typeof pointer === "string" &&
              pointerSession !== undefined &&
              pointerSession.status !== "active")));
    return {
      coherent:
        coherentRows &&
        coherentNonLegacyRows &&
        nonLegacyRows.length <= 1 &&
        pointerCoherent,
      activeSessionCount: activeRows.length,
      nonLegacyActiveSessionCount: nonLegacyRows.length,
    };
  } catch {
    return {
      coherent: false,
      activeSessionCount: 0,
      nonLegacyActiveSessionCount: 0,
    };
  }
}

function inspectMigrations(sqlite: DatabaseSync): MigrationLedgerInventory {
  if (!tableExists(sqlite, "__dlh_migrations")) {
    return {
      tablePresent: false,
      schemaCompatible: false,
      count: 0,
      ids: [],
    };
  }
  const columns = tableColumns(sqlite, "__dlh_migrations");
  const schemaCompatible = expectedMigrationColumns.every((column) =>
    columns.has(column),
  );
  if (!columns.has("id")) {
    return { tablePresent: true, schemaCompatible: false, count: 0, ids: [] };
  }
  const rows = sqlite
    .prepare("SELECT id FROM __dlh_migrations ORDER BY id")
    .all() as Array<{ id?: unknown }>;
  return {
    tablePresent: true,
    schemaCompatible,
    count: rows.length,
    ids: rows.map((row) => sanitizeMigrationId(row.id)),
  };
}

function inspectAgentMessages(sqlite: DatabaseSync): LogicalAgentMessageCounts {
  if (!tableExists(sqlite, "agent_messages")) {
    return emptyAgentMessageCounts(false, 0);
  }
  const columns = tableColumns(sqlite, "agent_messages");
  const rows = countRows(sqlite, "agent_messages");
  if (!columns.has("tool_events_json") || !columns.has("raw_event_json")) {
    return emptyAgentMessageCounts(true, rows);
  }
  const schemaCompatible = expectedAgentMessageColumns.every((column) =>
    columns.has(column),
  );
  const row = sqlite
    .prepare(
      `SELECT
         count(*) AS rows,
         COALESCE(sum(length(CAST(COALESCE(tool_events_json, '') AS BLOB))), 0) AS tool_event_bytes,
         COALESCE(sum(CASE
           WHEN tool_events_json IS NULL THEN 0
           WHEN json_valid(tool_events_json) = 0 THEN 0
           WHEN json_type(tool_events_json) <> 'array' THEN 0
           WHEN json_array_length(tool_events_json) > 0 THEN 1
           ELSE 0
         END), 0) AS nonempty_tool_event_rows,
         COALESCE(sum(CASE
           WHEN tool_events_json IS NULL OR json_valid(tool_events_json) = 0 THEN 1
           WHEN json_type(tool_events_json) <> 'array' THEN 1
           ELSE 0
         END), 0) AS invalid_tool_event_rows,
         COALESCE(sum(length(CAST(COALESCE(raw_event_json, '') AS BLOB))), 0) AS raw_event_bytes,
         COALESCE(sum(CASE WHEN raw_event_json IS NOT NULL THEN 1 ELSE 0 END), 0) AS raw_event_rows,
         COALESCE(sum(CASE
           WHEN raw_event_json IS NOT NULL AND json_valid(raw_event_json) = 0 THEN 1
           ELSE 0
         END), 0) AS invalid_raw_event_rows
       FROM agent_messages`,
    )
    .get() as Record<string, unknown>;
  return {
    tablePresent: true,
    schemaCompatible,
    rows: toNumber(row.rows),
    toolEventBytes: toNumber(row.tool_event_bytes),
    nonEmptyToolEventRows: toNumber(row.nonempty_tool_event_rows),
    invalidToolEventRows: toNumber(row.invalid_tool_event_rows),
    rawEventBytes: toNumber(row.raw_event_bytes),
    rawEventRows: toNumber(row.raw_event_rows),
    invalidRawEventRows: toNumber(row.invalid_raw_event_rows),
  };
}

function inspectReviews(sqlite: DatabaseSync): LogicalReviewCounts {
  if (!tableExists(sqlite, "reviews")) {
    return emptyReviewCounts(false, 0);
  }
  const columns = tableColumns(sqlite, "reviews");
  const rows = countRows(sqlite, "reviews");
  if (!columns.has("raw_response")) {
    return emptyReviewCounts(true, rows);
  }
  const schemaCompatible = expectedReviewColumns.every((column) =>
    columns.has(column),
  );
  const row = sqlite
    .prepare(
      `SELECT
         count(*) AS rows,
         COALESCE(sum(length(CAST(COALESCE(raw_response, '') AS BLOB))), 0) AS raw_response_bytes,
         COALESCE(sum(CASE WHEN raw_response IS NOT NULL THEN 1 ELSE 0 END), 0) AS raw_response_rows
       FROM reviews`,
    )
    .get() as Record<string, unknown>;
  return {
    tablePresent: true,
    schemaCompatible,
    rows: toNumber(row.rows),
    rawResponseBytes: toNumber(row.raw_response_bytes),
    rawResponseRows: toNumber(row.raw_response_rows),
  };
}
function inspectSessionSnapshots(
  sqlite: DatabaseSync,
): LogicalSessionSnapshotInventory {
  if (!tableExists(sqlite, "session_snapshots")) {
    return emptySessionSnapshotInventory(false, 0);
  }
  const columns = tableColumns(sqlite, "session_snapshots");
  const rows = countRows(sqlite, "session_snapshots");
  if (!expectedSessionSnapshotColumns.every((column) => columns.has(column))) {
    return emptySessionSnapshotInventory(true, rows);
  }

  const contentHashDigests: Buffer[] = [];
  const snapshotBytesDigests: Buffer[] = [];
  let storedContentHashRows = 0;
  let snapshotJsonBytes = 0;
  const statement = sqlite.prepare(
    `SELECT id, content_hash, snapshot_json
     FROM session_snapshots`,
  );
  for (const row of statement.iterate() as Iterable<{
    id?: unknown;
    content_hash?: unknown;
    snapshot_json?: unknown;
  }>) {
    if (typeof row.content_hash === "string" && row.content_hash.length > 0) {
      storedContentHashRows += 1;
    }
    if (typeof row.snapshot_json === "string") {
      snapshotJsonBytes += Buffer.byteLength(row.snapshot_json, "utf8");
    } else if (row.snapshot_json instanceof Uint8Array) {
      snapshotJsonBytes += row.snapshot_json.byteLength;
    }
    contentHashDigests.push(logicalRowDigest([row.id, row.content_hash]));
    snapshotBytesDigests.push(
      logicalRowDigest([row.id, logicalRowDigest([row.snapshot_json])]),
    );
  }

  return {
    tablePresent: true,
    schemaCompatible: true,
    rows,
    storedContentHashRows,
    snapshotJsonBytes,
    contentHashInventorySha256: digestInventory(contentHashDigests),
    snapshotBytesInventorySha256: digestInventory(snapshotBytesDigests),
  };
}
function inspectM2Foundation(sqlite: DatabaseSync): M2FoundationInventory {
  const tables: Record<string, M2TableInventory> = {};
  let presentTableCount = 0;
  let incompatibleTableCount = 0;
  for (const tableName of m2TableNames) {
    const summary = inspectM2Table(sqlite, tableName);
    tables[tableName] = summary;
    if (summary.tablePresent) presentTableCount += 1;
    if (summary.tablePresent && !summary.schemaCompatible) {
      incompatibleTableCount += 1;
    }
  }
  const complete =
    presentTableCount === m2TableNames.length && incompatibleTableCount === 0;
  const courses = inspectM2Courses(sqlite, tables.courses!);
  const revisions = inspectM2Revisions(sqlite, tables.course_revisions!);
  const sourceSnapshots = inspectM2SourceSnapshots(
    sqlite,
    tables.source_snapshots!,
  );
  const privatePayloads = inspectM2PrivatePayloads(sqlite, complete);
  const sessionContexts = inspectM2SessionContexts(
    sqlite,
    tables.session_course_contexts!,
  );
  const evidence = inspectM2Evidence(sqlite, tables.evidence_facts!);
  const unverifiedRuns = inspectM2Runs(sqlite, tables.migration_runs!);
  const provenance = inspectM2Provenance(sqlite, tables.migration_provenance!);
  const quarantine = inspectM2Quarantine(
    sqlite,
    tables.migration_quarantine!,
    tables.migration_provenance!,
  );
  const runs: M2MigrationRunInventory = {
    ...unverifiedRuns,
    reconciled:
      complete &&
      unverifiedRuns.m2V1Rows === 1 &&
      unverifiedRuns.sourceRowCount !== null &&
      unverifiedRuns.mappedRows !== null &&
      unverifiedRuns.quarantinedRows !== null &&
      unverifiedRuns.intentionallyUnmappedRows !== null &&
      unverifiedRuns.sourceRowCount === provenance.m2V1Rows &&
      unverifiedRuns.mappedRows === provenance.mappedRows &&
      unverifiedRuns.quarantinedRows === provenance.quarantinedRows &&
      unverifiedRuns.intentionallyUnmappedRows ===
        provenance.intentionallyUnmappedRows &&
      unverifiedRuns.quarantinedRows === quarantine.m2V1Rows &&
      provenance.invalidStatusRows === 0 &&
      quarantine.invalidResolutionRows === 0,
  };
  return {
    present: presentTableCount > 0,
    complete,
    expectedTableCount: m2TableNames.length,
    presentTableCount,
    incompatibleTableCount,
    tables,
    courses,
    revisions,
    sourceSnapshots,
    privatePayloads,
    sessionContexts,
    evidence,
    runs,
    provenance,
    quarantine,
    orphans: inspectM2Orphans(sqlite, complete),
  };
}

function inspectM2Table(
  sqlite: DatabaseSync,
  tableName: M2TableName,
): M2TableInventory {
  if (!tableExists(sqlite, tableName)) {
    return { tablePresent: false, schemaCompatible: false, rows: 0 };
  }
  const columns = tableColumns(sqlite, tableName);
  return {
    tablePresent: true,
    schemaCompatible: m2ExpectedTableColumns[tableName].every((column) =>
      columns.has(column),
    ),
    rows: countRows(sqlite, tableName),
  };
}

function inspectM2Courses(
  sqlite: DatabaseSync,
  table: M2TableInventory,
): M2CourseInventory {
  if (!table.schemaCompatible) {
    return {
      ...table,
      activeRevisionRows: table.tablePresent ? null : 0,
      missingActiveRevisionRows: table.tablePresent ? null : 0,
    };
  }
  const row = sqlite
    .prepare(
      `SELECT
         COALESCE(sum(CASE WHEN active_revision_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS active_revision_rows,
         COALESCE(sum(CASE WHEN active_revision_id IS NULL THEN 1 ELSE 0 END), 0) AS missing_active_revision_rows
       FROM courses`,
    )
    .get() as Record<string, unknown>;
  return {
    ...table,
    activeRevisionRows: toNumber(row.active_revision_rows),
    missingActiveRevisionRows: toNumber(row.missing_active_revision_rows),
  };
}

function inspectM2Revisions(
  sqlite: DatabaseSync,
  table: M2TableInventory,
): M2CourseRevisionInventory {
  if (!table.schemaCompatible) {
    const unavailable = table.tablePresent ? null : 0;
    return {
      ...table,
      draftRows: unavailable,
      publishedRows: unavailable,
      archivedRows: unavailable,
      acceptedContentHashRows: unavailable,
      contentHashInventorySha256: table.tablePresent
        ? null
        : digestInventory([]),
    };
  }
  let draftRows = 0;
  let publishedRows = 0;
  let archivedRows = 0;
  let acceptedContentHashRows = 0;
  const contentHashDigests: Buffer[] = [];
  for (const row of sqlite
    .prepare("SELECT id, status, content_hash FROM course_revisions")
    .iterate() as Iterable<{
    id?: unknown;
    status?: unknown;
    content_hash?: unknown;
  }>) {
    if (row.status === "draft") draftRows += 1;
    if (row.status === "published") publishedRows += 1;
    if (row.status === "archived") archivedRows += 1;
    if (
      row.status !== "draft" &&
      typeof row.content_hash === "string" &&
      row.content_hash.length > 0
    ) {
      acceptedContentHashRows += 1;
    }
    contentHashDigests.push(
      logicalRowDigest([row.id, row.status, row.content_hash]),
    );
  }
  return {
    ...table,
    draftRows,
    publishedRows,
    archivedRows,
    acceptedContentHashRows,
    contentHashInventorySha256: digestInventory(contentHashDigests),
  };
}

function inspectM2SourceSnapshots(
  sqlite: DatabaseSync,
  table: M2TableInventory,
): M2SourceSnapshotInventory {
  if (!table.schemaCompatible) {
    return {
      ...table,
      contentRows: null,
      contentBytes: null,
      fullRetentionRows: null,
      extractRetentionRows: null,
      metadataOnlyRows: null,
      invalidRetentionRows: null,
      retentionMismatchRows: null,
      contentHashInventorySha256: null,
    };
  }
  const row = sqlite
    .prepare(
      `SELECT
       sum(content IS NOT NULL) AS content_rows,
       COALESCE(sum(length(CAST(content AS BLOB))), 0) AS content_bytes,
       sum(retention_mode = 'full') AS full_retention_rows,
       sum(retention_mode = 'extract') AS extract_retention_rows,
       sum(retention_mode = 'metadata-only') AS metadata_only_rows,
       sum(retention_mode NOT IN ('full', 'extract', 'metadata-only')) AS invalid_retention_rows,
       sum((retention_mode = 'metadata-only' AND content IS NOT NULL)
           OR (retention_mode IN ('full', 'extract') AND content IS NULL)) AS retention_mismatch_rows
       FROM source_snapshots`,
    )
    .get() as Record<string, unknown>;
  const contentHashDigests: Buffer[] = [];
  for (const snapshot of sqlite
    .prepare("SELECT id, content_hash FROM source_snapshots ORDER BY id")
    .iterate() as Iterable<{ id?: unknown; content_hash?: unknown }>) {
    contentHashDigests.push(
      logicalRowDigest([snapshot.id ?? null, snapshot.content_hash ?? null]),
    );
  }
  return {
    ...table,
    contentRows: toNumber(row.content_rows),
    contentBytes: toNumber(row.content_bytes),
    fullRetentionRows: toNumber(row.full_retention_rows),
    extractRetentionRows: toNumber(row.extract_retention_rows),
    metadataOnlyRows: toNumber(row.metadata_only_rows),
    invalidRetentionRows: toNumber(row.invalid_retention_rows),
    retentionMismatchRows: toNumber(row.retention_mismatch_rows),
    contentHashInventorySha256: digestInventory(contentHashDigests),
  };
}

function inspectM2PrivatePayloads(
  sqlite: DatabaseSync,
  complete: boolean,
): M2PrivatePayloadInventory {
  if (!complete) {
    return {
      inspected: false,
      activityRows: null,
      activityPayloadBytes: null,
      protectedMaterialBytes: null,
      sourceContentRows: null,
      sourceContentBytes: null,
      capsuleRows: null,
      capsulePayloadBytes: null,
      evidenceRows: null,
      evidencePayloadBytes: null,
      evidenceProvenanceBytes: null,
      reviewItemRows: null,
      reviewItemPayloadBytes: null,
      totalBytes: null,
    };
  }
  const row = sqlite
    .prepare(
      `SELECT
       (SELECT count(*) FROM course_activities) AS activity_rows,
       (SELECT COALESCE(sum(length(CAST(payload_json AS BLOB))), 0) FROM course_activities) AS activity_payload_bytes,
       (SELECT COALESCE(sum(length(CAST(protected_material_json AS BLOB))), 0) FROM course_activities) AS protected_material_bytes,
       (SELECT count(*) FROM source_snapshots WHERE content IS NOT NULL) AS source_content_rows,
       (SELECT COALESCE(sum(length(CAST(content AS BLOB))), 0) FROM source_snapshots) AS source_content_bytes,
       (SELECT count(*) FROM knowledge_capsules) AS capsule_rows,
       (SELECT COALESCE(sum(length(CAST(knowledge_node_ids_json AS BLOB))) + sum(length(CAST(claims_json AS BLOB))) + sum(length(CAST(citations_json AS BLOB))) + sum(length(CAST(conflicts_json AS BLOB))), 0) FROM knowledge_capsules) AS capsule_payload_bytes,
       (SELECT count(*) FROM evidence_facts) AS evidence_rows,
       (SELECT COALESCE(sum(length(CAST(payload_json AS BLOB))), 0) FROM evidence_facts) AS evidence_payload_bytes,
       (SELECT COALESCE(sum(length(CAST(provenance_json AS BLOB))), 0) FROM evidence_facts) AS evidence_provenance_bytes,
       (SELECT count(*) FROM review_items) AS review_item_rows,
       (SELECT COALESCE(sum(length(CAST(payload_json AS BLOB))), 0) FROM review_items) AS review_item_payload_bytes`,
    )
    .get() as Record<string, unknown>;
  const byteCounts = {
    activityPayloadBytes: toNumber(row.activity_payload_bytes),
    protectedMaterialBytes: toNumber(row.protected_material_bytes),
    sourceContentBytes: toNumber(row.source_content_bytes),
    capsulePayloadBytes: toNumber(row.capsule_payload_bytes),
    evidencePayloadBytes: toNumber(row.evidence_payload_bytes),
    evidenceProvenanceBytes: toNumber(row.evidence_provenance_bytes),
    reviewItemPayloadBytes: toNumber(row.review_item_payload_bytes),
  };
  return {
    inspected: true,
    activityRows: toNumber(row.activity_rows),
    sourceContentRows: toNumber(row.source_content_rows),
    capsuleRows: toNumber(row.capsule_rows),
    evidenceRows: toNumber(row.evidence_rows),
    reviewItemRows: toNumber(row.review_item_rows),
    ...byteCounts,
    totalBytes: Object.values(byteCounts).reduce(
      (total, byteCount) => total + byteCount,
      0,
    ),
  };
}

function inspectM2SessionContexts(
  sqlite: DatabaseSync,
  table: M2TableInventory,
): M2SessionContextInventory {
  if (!table.schemaCompatible) {
    const unavailable = table.tablePresent ? null : 0;
    return {
      ...table,
      activeSessionRows: unavailable,
      activeSessionsWithContextRows: unavailable,
      activeSessionsMissingContextRows: unavailable,
      quarantinedActiveSessionsMissingContextRows: unavailable,
      unaccountedActiveSessionsMissingContextRows: unavailable,
      quarantinedActiveSessionSourceHashMismatchRows: unavailable,
      snapshotMismatchRows: unavailable,
      snapshotBytesHashMissingRows: unavailable,
      snapshotBytesHashMismatchRows: unavailable,
      snapshotStrictParseMismatchRows: unavailable,
      snapshotSchemaVersionMismatchRows: unavailable,
      snapshotEmbeddedIdentityMismatchRows: unavailable,
      snapshotEmbeddedContentHashMismatchRows: unavailable,
      snapshotCanonicalCoreHashMismatchRows: unavailable,
    };
  }
  const active = sqlite
    .prepare(
      `SELECT
         count(*) AS active_rows,
         COALESCE(sum(CASE WHEN context.session_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS with_context_rows,
         COALESCE(sum(CASE WHEN context.session_id IS NULL AND EXISTS (
           SELECT 1
           FROM session_snapshots snapshot
           JOIN curriculum_versions revision
             ON revision.id = snapshot.curriculum_version_id
            AND revision.curriculum_id = snapshot.curriculum_id
           JOIN curriculum_days_v2 lesson
             ON lesson.id = snapshot.curriculum_day_id
            AND lesson.version_id = revision.id
           JOIN migration_provenance revision_provenance
             ON revision_provenance.transform_version = 'm2-v1'
            AND revision_provenance.source_table = 'curriculum_versions'
            AND revision_provenance.source_primary_key = revision.id
            AND revision_provenance.status = 'quarantined'
           JOIN migration_provenance lesson_provenance
             ON lesson_provenance.transform_version = 'm2-v1'
            AND lesson_provenance.source_table = 'curriculum_days_v2'
            AND lesson_provenance.source_primary_key = lesson.id
            AND lesson_provenance.status = 'quarantined'
           JOIN migration_provenance snapshot_provenance
             ON snapshot_provenance.transform_version = 'm2-v1'
            AND snapshot_provenance.source_table = 'session_snapshots'
            AND snapshot_provenance.source_primary_key = snapshot.id
            AND snapshot_provenance.status = 'quarantined'
           WHERE snapshot.session_id = session.id
         ) THEN 1 ELSE 0 END), 0) AS quarantined_missing_rows
       FROM learning_sessions session
       LEFT JOIN session_course_contexts context ON context.session_id = session.id
       WHERE session.status = 'active'`,
    )
    .get() as Record<string, unknown>;
  const activeSessionRows = toNumber(active.active_rows);
  const activeSessionsWithContextRows = toNumber(active.with_context_rows);
  const quarantinedActiveSessionsMissingContextRows = toNumber(
    active.quarantined_missing_rows,
  );
  const quarantineCandidates = sqlite
    .prepare(
      `SELECT session.id AS session_id,
              revision.id AS revision_id,
              lesson.id AS lesson_id,
              snapshot.id AS snapshot_id,
              revision_provenance.source_row_hash AS revision_row_hash,
              lesson_provenance.source_row_hash AS lesson_row_hash,
              snapshot_provenance.source_row_hash AS snapshot_row_hash
       FROM learning_sessions session
       LEFT JOIN session_course_contexts context ON context.session_id = session.id
       JOIN session_snapshots snapshot ON snapshot.session_id = session.id
       JOIN curriculum_versions revision
         ON revision.id = snapshot.curriculum_version_id
        AND revision.curriculum_id = snapshot.curriculum_id
       JOIN curriculum_days_v2 lesson
         ON lesson.id = snapshot.curriculum_day_id
        AND lesson.version_id = revision.id
       JOIN migration_provenance revision_provenance
         ON revision_provenance.transform_version = 'm2-v1'
        AND revision_provenance.source_table = 'curriculum_versions'
        AND revision_provenance.source_primary_key = revision.id
        AND revision_provenance.status = 'quarantined'
       JOIN migration_provenance lesson_provenance
         ON lesson_provenance.transform_version = 'm2-v1'
        AND lesson_provenance.source_table = 'curriculum_days_v2'
        AND lesson_provenance.source_primary_key = lesson.id
        AND lesson_provenance.status = 'quarantined'
       JOIN migration_provenance snapshot_provenance
         ON snapshot_provenance.transform_version = 'm2-v1'
        AND snapshot_provenance.source_table = 'session_snapshots'
        AND snapshot_provenance.source_primary_key = snapshot.id
        AND snapshot_provenance.status = 'quarantined'
       WHERE session.status = 'active' AND context.session_id IS NULL`,
    )
    .all() as Array<{
    session_id: string;
    revision_id: string;
    lesson_id: string;
    snapshot_id: string;
    revision_row_hash: unknown;
    lesson_row_hash: unknown;
    snapshot_row_hash: unknown;
  }>;
  const quarantineHashMatches = new Map<string, boolean>();
  for (const candidate of quarantineCandidates) {
    const matches =
      matchesCurrentSourceRowHash(
        sqlite,
        "curriculum_versions",
        candidate.revision_id,
        candidate.revision_row_hash,
      ) &&
      matchesCurrentSourceRowHash(
        sqlite,
        "curriculum_days_v2",
        candidate.lesson_id,
        candidate.lesson_row_hash,
      ) &&
      matchesCurrentSourceRowHash(
        sqlite,
        "session_snapshots",
        candidate.snapshot_id,
        candidate.snapshot_row_hash,
      );
    quarantineHashMatches.set(
      candidate.session_id,
      (quarantineHashMatches.get(candidate.session_id) ?? false) || matches,
    );
  }
  const quarantinedActiveSessionSourceHashMismatchRows = [
    ...quarantineHashMatches.values(),
  ].filter((matches) => !matches).length;
  const mismatch = sqlite
    .prepare(
      `SELECT count(*) AS count
       FROM session_course_contexts context
       LEFT JOIN session_snapshots snapshot
         ON snapshot.id = context.session_snapshot_id
       LEFT JOIN learning_sessions session ON session.id = context.session_id
       WHERE snapshot.id IS NULL
          OR session.id IS NULL
          OR snapshot.session_id IS NOT context.session_id
          OR session.curriculum_day_v2_id IS NOT context.lesson_id
          OR snapshot.curriculum_id IS NOT context.course_id
          OR snapshot.curriculum_version_id IS NOT context.revision_id
          OR snapshot.curriculum_day_id IS NOT context.lesson_id
          OR snapshot.content_hash IS NOT context.snapshot_hash`,
    )
    .get() as { count?: unknown } | undefined;
  let snapshotBytesHashMissingRows = 0;
  let snapshotBytesHashMismatchRows = 0;
  let snapshotStrictParseMismatchRows = 0;
  let snapshotSchemaVersionMismatchRows = 0;
  let snapshotEmbeddedIdentityMismatchRows = 0;
  let snapshotEmbeddedContentHashMismatchRows = 0;
  let snapshotCanonicalCoreHashMismatchRows = 0;
  for (const row of sqlite
    .prepare(
      `SELECT context.snapshot_bytes_hash, snapshot.schema_version,
              snapshot.curriculum_id, snapshot.curriculum_version_id,
              snapshot.curriculum_day_id, snapshot.content_hash,
              snapshot.snapshot_json,
              revision.revision AS source_revision_number
       FROM session_course_contexts context
       LEFT JOIN session_snapshots snapshot
         ON snapshot.id = context.session_snapshot_id
       LEFT JOIN curriculum_versions revision
         ON revision.id = snapshot.curriculum_version_id
        AND revision.curriculum_id = snapshot.curriculum_id`,
    )
    .iterate() as Iterable<{
    snapshot_bytes_hash?: unknown;
    schema_version?: unknown;
    curriculum_id?: unknown;
    curriculum_version_id?: unknown;
    curriculum_day_id?: unknown;
    content_hash?: unknown;
    snapshot_json?: unknown;
    source_revision_number?: unknown;
  }>) {
    const payload =
      typeof row.snapshot_json === "string"
        ? Buffer.from(row.snapshot_json, "utf8")
        : row.snapshot_json instanceof Uint8Array
          ? Buffer.from(
              row.snapshot_json.buffer,
              row.snapshot_json.byteOffset,
              row.snapshot_json.byteLength,
            )
          : null;
    if (row.snapshot_bytes_hash === null) {
      snapshotBytesHashMissingRows += 1;
    } else if (
      payload === null ||
      typeof row.snapshot_bytes_hash !== "string" ||
      createHash("sha256").update(payload).digest("hex") !==
        row.snapshot_bytes_hash
    ) {
      snapshotBytesHashMismatchRows += 1;
    }

    if (typeof row.snapshot_json !== "string") {
      snapshotStrictParseMismatchRows += 1;
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(row.snapshot_json) as unknown;
    } catch {
      snapshotStrictParseMismatchRows += 1;
      continue;
    }
    const parsed = strictSessionSnapshotSchema.safeParse(raw);
    if (
      !parsed.success ||
      JSON.stringify(canonicalizeSnapshotValue(raw)) !==
        JSON.stringify(canonicalizeSnapshotValue(parsed.data))
    ) {
      snapshotStrictParseMismatchRows += 1;
      continue;
    }

    const snapshot = parsed.data;
    if (
      row.schema_version !== currentSessionSnapshotSchemaVersion ||
      snapshot.schemaVersion !== row.schema_version
    ) {
      snapshotSchemaVersionMismatchRows += 1;
    }
    if (
      typeof row.curriculum_id !== "string" ||
      typeof row.curriculum_version_id !== "string" ||
      typeof row.curriculum_day_id !== "string" ||
      typeof row.source_revision_number !== "number" ||
      !Number.isSafeInteger(row.source_revision_number) ||
      snapshot.curriculumId !== row.curriculum_id ||
      snapshot.curriculumVersionId !== row.curriculum_version_id ||
      snapshot.curriculumRevision !== row.source_revision_number ||
      snapshot.day.id !== row.curriculum_day_id
    ) {
      snapshotEmbeddedIdentityMismatchRows += 1;
    }
    const { contentHash, ...snapshotCore } = snapshot;
    if (
      typeof row.content_hash !== "string" ||
      contentHash !== row.content_hash
    ) {
      snapshotEmbeddedContentHashMismatchRows += 1;
    }
    if (
      typeof row.content_hash !== "string" ||
      createHash("sha256")
        .update(JSON.stringify(canonicalizeSnapshotValue(snapshotCore)))
        .digest("hex") !== row.content_hash
    ) {
      snapshotCanonicalCoreHashMismatchRows += 1;
    }
  }
  return {
    ...table,
    activeSessionRows,
    activeSessionsWithContextRows,
    activeSessionsMissingContextRows:
      activeSessionRows - activeSessionsWithContextRows,
    quarantinedActiveSessionsMissingContextRows,
    quarantinedActiveSessionSourceHashMismatchRows,
    unaccountedActiveSessionsMissingContextRows:
      activeSessionRows -
      activeSessionsWithContextRows -
      quarantinedActiveSessionsMissingContextRows,
    snapshotMismatchRows: toNumber(mismatch?.count),
    snapshotBytesHashMissingRows,
    snapshotBytesHashMismatchRows,
    snapshotStrictParseMismatchRows,
    snapshotSchemaVersionMismatchRows,
    snapshotEmbeddedIdentityMismatchRows,
    snapshotEmbeddedContentHashMismatchRows,
    snapshotCanonicalCoreHashMismatchRows,
  };
}

function inspectM2Evidence(
  sqlite: DatabaseSync,
  table: M2TableInventory,
): M2EvidenceInventory {
  if (!table.schemaCompatible) {
    const unavailable = table.tablePresent ? null : 0;
    return {
      ...table,
      recallAttemptRows: unavailable,
      quizAnswerRows: unavailable,
      codeReadingAttemptRows: unavailable,
      summaryRows: unavailable,
      invalidTypeRows: unavailable,
    };
  }
  const row = sqlite
    .prepare(
      `SELECT
         COALESCE(sum(evidence_type = 'recall-attempt'), 0) AS recall_rows,
         COALESCE(sum(evidence_type = 'quiz-answer'), 0) AS quiz_rows,
         COALESCE(sum(evidence_type = 'code-reading-attempt'), 0) AS code_reading_rows,
         COALESCE(sum(evidence_type = 'summary'), 0) AS summary_rows,
         COALESCE(sum(evidence_type NOT IN ('recall-attempt', 'quiz-answer', 'code-reading-attempt', 'summary')), 0) AS invalid_rows
       FROM evidence_facts`,
    )
    .get() as Record<string, unknown>;
  return {
    ...table,
    recallAttemptRows: toNumber(row.recall_rows),
    quizAnswerRows: toNumber(row.quiz_rows),
    codeReadingAttemptRows: toNumber(row.code_reading_rows),
    summaryRows: toNumber(row.summary_rows),
    invalidTypeRows: toNumber(row.invalid_rows),
  };
}

function inspectM2Runs(
  sqlite: DatabaseSync,
  table: M2TableInventory,
): M2MigrationRunInventory {
  if (!table.schemaCompatible) {
    const unavailable = table.tablePresent ? null : 0;
    return {
      ...table,
      m2V1Rows: unavailable,
      m2V2Rows: unavailable,
      correctionSourceDatabaseDigest: null,
      correctionApprovedBackupLogicalSha256: null,
      correctionApprovedBackupSha256: null,
      correctionApprovedBackupPathHash: null,
      m2V3Rows: unavailable,
      hardeningSourceDatabaseDigest: null,
      hardeningApprovedBackupLogicalSha256: null,
      hardeningApprovedBackupSha256: null,
      hardeningApprovedBackupPathHash: null,
      m2V4Rows: unavailable,
      quarantineImmutabilitySourceDatabaseDigest: null,
      quarantineImmutabilityApprovedBackupLogicalSha256: null,
      quarantineImmutabilityApprovedBackupSha256: null,
      quarantineImmutabilityApprovedBackupPathHash: null,
      sourceRowCount: unavailable,
      mappedRows: unavailable,
      quarantinedRows: unavailable,
      intentionallyUnmappedRows: unavailable,
      reconciled: false,
      sourceDatabaseDigest: null,
      approvedBackupLogicalSha256: null,
      approvedBackupSha256: null,
      approvedBackupPathHash: null,
    };
  }
  const rows = sqlite
    .prepare(
      `SELECT source_database_digest, approved_backup_logical_sha256,
              approved_backup_sha256, approved_backup_path_hash,
              source_row_count, mapped_count, quarantined_count,
              intentionally_unmapped_count
       FROM migration_runs
       WHERE transform_version = 'm2-v1' AND status = 'completed'`,
    )
    .all() as Array<Record<string, unknown>>;
  const row = rows.length === 1 ? rows[0]! : undefined;
  const correctionRows = sqlite
    .prepare(
      `SELECT source_database_digest, approved_backup_logical_sha256,
              approved_backup_sha256, approved_backup_path_hash
       FROM migration_runs
       WHERE transform_version = 'm2-v2' AND status = 'completed'`,
    )
    .all() as Array<Record<string, unknown>>;
  const correction =
    correctionRows.length === 1 ? correctionRows[0]! : undefined;
  const hardeningRows = sqlite
    .prepare(
      `SELECT source_database_digest, approved_backup_logical_sha256,
              approved_backup_sha256, approved_backup_path_hash
       FROM migration_runs
       WHERE transform_version = 'm2-v3' AND status = 'completed'`,
    )
    .all() as Array<Record<string, unknown>>;
  const hardening = hardeningRows.length === 1 ? hardeningRows[0]! : undefined;
  const quarantineImmutabilityRows = sqlite
    .prepare(
      `SELECT source_database_digest, approved_backup_logical_sha256,
              approved_backup_sha256, approved_backup_path_hash
       FROM migration_runs
       WHERE transform_version = 'm2-v4' AND status = 'completed'`,
    )
    .all() as Array<Record<string, unknown>>;
  const quarantineImmutability =
    quarantineImmutabilityRows.length === 1
      ? quarantineImmutabilityRows[0]!
      : undefined;
  return {
    ...table,
    m2V1Rows: rows.length,
    m2V2Rows: correctionRows.length,
    correctionSourceDatabaseDigest: readSha256(
      correction?.source_database_digest,
    ),
    correctionApprovedBackupLogicalSha256: readOptionalSha256(
      correction?.approved_backup_logical_sha256,
    ),
    correctionApprovedBackupSha256: readOptionalSha256(
      correction?.approved_backup_sha256,
    ),
    correctionApprovedBackupPathHash: readOptionalSha256(
      correction?.approved_backup_path_hash,
    ),
    m2V3Rows: hardeningRows.length,
    hardeningSourceDatabaseDigest: readSha256(
      hardening?.source_database_digest,
    ),
    hardeningApprovedBackupLogicalSha256: readOptionalSha256(
      hardening?.approved_backup_logical_sha256,
    ),
    hardeningApprovedBackupSha256: readOptionalSha256(
      hardening?.approved_backup_sha256,
    ),
    hardeningApprovedBackupPathHash: readOptionalSha256(
      hardening?.approved_backup_path_hash,
    ),
    m2V4Rows: quarantineImmutabilityRows.length,
    quarantineImmutabilitySourceDatabaseDigest: readSha256(
      quarantineImmutability?.source_database_digest,
    ),
    quarantineImmutabilityApprovedBackupLogicalSha256: readOptionalSha256(
      quarantineImmutability?.approved_backup_logical_sha256,
    ),
    quarantineImmutabilityApprovedBackupSha256: readOptionalSha256(
      quarantineImmutability?.approved_backup_sha256,
    ),
    quarantineImmutabilityApprovedBackupPathHash: readOptionalSha256(
      quarantineImmutability?.approved_backup_path_hash,
    ),
    sourceRowCount: readNonNegativeInteger(row?.source_row_count),
    mappedRows: readNonNegativeInteger(row?.mapped_count),
    quarantinedRows: readNonNegativeInteger(row?.quarantined_count),
    intentionallyUnmappedRows: readNonNegativeInteger(
      row?.intentionally_unmapped_count,
    ),
    reconciled: false,
    sourceDatabaseDigest: readSha256(row?.source_database_digest),
    approvedBackupLogicalSha256: readOptionalSha256(
      row?.approved_backup_logical_sha256,
    ),
    approvedBackupSha256: readOptionalSha256(row?.approved_backup_sha256),
    approvedBackupPathHash: readOptionalSha256(row?.approved_backup_path_hash),
  };
}

function inspectM2Provenance(
  sqlite: DatabaseSync,
  table: M2TableInventory,
): M2ProvenanceInventory {
  if (!table.schemaCompatible) {
    const unavailable = table.tablePresent ? null : 0;
    return {
      ...table,
      m2V1Rows: unavailable,
      mappedRows: unavailable,
      quarantinedRows: unavailable,
      intentionallyUnmappedRows: unavailable,
      invalidStatusRows: unavailable,
      quarantinedRevisionSourceHashMismatchRows: unavailable,
    };
  }
  const row = sqlite
    .prepare(
      `SELECT
         count(*) AS rows,
         COALESCE(sum(status = 'mapped'), 0) AS mapped_rows,
         COALESCE(sum(status = 'quarantined'), 0) AS quarantined_rows,
         COALESCE(sum(status = 'intentionally_unmapped'), 0) AS intentionally_unmapped_rows,
         COALESCE(sum(status NOT IN ('mapped', 'quarantined', 'intentionally_unmapped')), 0) AS invalid_status_rows
       FROM migration_provenance
       WHERE transform_version = 'm2-v1'`,
    )
    .get() as Record<string, unknown>;
  const quarantinedRevisionSourceHashMismatchRows = (
    sqlite
      .prepare(
        `SELECT source_primary_key, source_row_hash
         FROM migration_provenance
         WHERE transform_version = 'm2-v1'
           AND source_table = 'curriculum_versions'
           AND status = 'quarantined'`,
      )
      .all() as Array<{
      source_primary_key: string;
      source_row_hash: unknown;
    }>
  ).filter(
    (candidate) =>
      !matchesCurrentSourceRowHash(
        sqlite,
        "curriculum_versions",
        candidate.source_primary_key,
        candidate.source_row_hash,
      ),
  ).length;
  return {
    ...table,
    m2V1Rows: toNumber(row.rows),
    mappedRows: toNumber(row.mapped_rows),
    quarantinedRows: toNumber(row.quarantined_rows),
    intentionallyUnmappedRows: toNumber(row.intentionally_unmapped_rows),
    invalidStatusRows: toNumber(row.invalid_status_rows),
    quarantinedRevisionSourceHashMismatchRows,
  };
}

function inspectM2Quarantine(
  sqlite: DatabaseSync,
  table: M2TableInventory,
  provenanceTable: M2TableInventory,
): M2QuarantineInventory {
  if (!table.schemaCompatible || !provenanceTable.schemaCompatible) {
    const unavailable = table.tablePresent ? null : 0;
    return {
      ...table,
      m2V1Rows: unavailable,
      unresolvedRows: unavailable,
      invalidResolutionRows: unavailable,
      distinctReasonCount: unavailable,
    };
  }
  const row = sqlite
    .prepare(
      `SELECT
         count(*) AS rows,
         COALESCE(sum(quarantine.resolution_status = 'unresolved'), 0) AS unresolved_rows,
         COALESCE(sum(quarantine.resolution_status != 'unresolved'), 0) AS invalid_resolution_rows,
         count(DISTINCT quarantine.reason_code) AS distinct_reason_count
       FROM migration_quarantine quarantine
       JOIN migration_provenance provenance ON provenance.id = quarantine.provenance_id
       WHERE provenance.transform_version = 'm2-v1'`,
    )
    .get() as Record<string, unknown>;
  return {
    ...table,
    m2V1Rows: toNumber(row.rows),
    unresolvedRows: toNumber(row.unresolved_rows),
    invalidResolutionRows: toNumber(row.invalid_resolution_rows),
    distinctReasonCount: toNumber(row.distinct_reason_count),
  };
}

function inspectM2Orphans(
  sqlite: DatabaseSync,
  complete: boolean,
): M2OrphanInventory {
  if (!complete) {
    return {
      inspected: false,
      total: null,
      revisionScopeRows: null,
      revisionParentRows: null,
      courseActiveRevisionRows: null,
      sectionScopeRows: null,
      lessonScopeRows: null,
      lessonPrerequisiteScopeRows: null,
      activityScopeRows: null,
      activityPrerequisiteScopeRows: null,
      sourceSnapshotScopeRows: null,
      sourceSnapshotSupersedesScopeRows: null,
      knowledgeCapsuleScopeRows: null,
      knowledgeCapsuleSourceScopeRows: null,
      adaptationBranchScopeRows: null,
      sessionContextScopeRows: null,
      evidenceScopeRows: null,
      reviewItemScopeRows: null,
      provenanceRunRows: null,
      quarantineProvenanceRows: null,
    };
  }
  const row = sqlite
    .prepare(
      `SELECT
       (SELECT count(*) FROM course_revisions revision
        LEFT JOIN courses course ON course.id = revision.course_id
        WHERE course.id IS NULL) AS revision_scope_rows,
       (SELECT count(*) FROM course_revisions child
        LEFT JOIN course_revisions parent ON parent.course_id = child.course_id AND parent.id = child.parent_revision_id
        WHERE child.parent_revision_id IS NOT NULL AND parent.id IS NULL) AS revision_parent_rows,
       (SELECT count(*) FROM courses course
        LEFT JOIN course_revisions revision ON revision.course_id = course.id AND revision.id = course.active_revision_id
        WHERE course.active_revision_id IS NOT NULL AND revision.id IS NULL) AS course_active_revision_rows,
       (SELECT count(*) FROM course_sections section
        LEFT JOIN course_revisions revision ON revision.course_id = section.course_id AND revision.id = section.revision_id
        WHERE revision.id IS NULL) AS section_scope_rows,
       (SELECT count(*) FROM course_lessons lesson
        LEFT JOIN course_revisions revision ON revision.course_id = lesson.course_id AND revision.id = lesson.revision_id
        LEFT JOIN course_sections section ON section.course_id = lesson.course_id AND section.revision_id = lesson.revision_id AND section.id = lesson.section_id
        WHERE revision.id IS NULL OR section.id IS NULL) AS lesson_scope_rows,
       (SELECT count(*) FROM course_lesson_prerequisites edge
        LEFT JOIN course_lessons lesson ON lesson.course_id = edge.course_id AND lesson.revision_id = edge.revision_id AND lesson.id = edge.lesson_id
        LEFT JOIN course_lessons prerequisite ON prerequisite.course_id = edge.course_id AND prerequisite.revision_id = edge.revision_id AND prerequisite.id = edge.prerequisite_lesson_id
        WHERE lesson.id IS NULL OR prerequisite.id IS NULL) AS lesson_prerequisite_scope_rows,
       (SELECT count(*) FROM course_activities activity
        LEFT JOIN course_revisions revision ON revision.course_id = activity.course_id AND revision.id = activity.revision_id
        LEFT JOIN course_lessons lesson ON lesson.course_id = activity.course_id AND lesson.revision_id = activity.revision_id AND lesson.id = activity.lesson_id
        WHERE revision.id IS NULL OR lesson.id IS NULL) AS activity_scope_rows,
       (SELECT count(*) FROM course_activity_prerequisites edge
        LEFT JOIN course_activities activity ON activity.course_id = edge.course_id AND activity.revision_id = edge.revision_id AND activity.lesson_id = edge.lesson_id AND activity.id = edge.activity_id
        LEFT JOIN course_activities prerequisite ON prerequisite.course_id = edge.course_id AND prerequisite.revision_id = edge.revision_id AND prerequisite.lesson_id = edge.lesson_id AND prerequisite.id = edge.prerequisite_activity_id
        WHERE activity.id IS NULL OR prerequisite.id IS NULL) AS activity_prerequisite_scope_rows,
       (SELECT count(*) FROM source_snapshots snapshot
        LEFT JOIN course_revisions revision ON revision.course_id = snapshot.course_id AND revision.id = snapshot.revision_id
        WHERE revision.id IS NULL) AS source_snapshot_scope_rows,
       (SELECT count(*) FROM source_snapshots snapshot
        LEFT JOIN source_snapshots superseded ON superseded.course_id = snapshot.course_id AND superseded.revision_id = snapshot.revision_id AND superseded.id = snapshot.supersedes_snapshot_id
        WHERE snapshot.supersedes_snapshot_id IS NOT NULL AND superseded.id IS NULL) AS source_snapshot_supersedes_scope_rows,
       (SELECT count(*) FROM knowledge_capsules capsule
        LEFT JOIN course_revisions revision ON revision.course_id = capsule.course_id AND revision.id = capsule.revision_id
        WHERE revision.id IS NULL) AS knowledge_capsule_scope_rows,
       (SELECT count(*) FROM knowledge_capsule_sources link
        LEFT JOIN knowledge_capsules capsule ON capsule.course_id = link.course_id AND capsule.revision_id = link.revision_id AND capsule.id = link.capsule_id
        LEFT JOIN source_snapshots snapshot ON snapshot.course_id = link.course_id AND snapshot.revision_id = link.revision_id AND snapshot.id = link.source_snapshot_id
        WHERE capsule.id IS NULL OR snapshot.id IS NULL) AS knowledge_capsule_source_scope_rows,
       (SELECT count(*) FROM adaptation_branches branch
        LEFT JOIN course_revisions base ON base.course_id = branch.course_id AND base.id = branch.base_revision_id
        LEFT JOIN course_revisions head ON head.course_id = branch.course_id AND head.id = branch.head_revision_id
        WHERE base.id IS NULL OR (branch.head_revision_id IS NOT NULL AND head.id IS NULL)) AS adaptation_branch_scope_rows,
       (SELECT count(*) FROM session_course_contexts context
        LEFT JOIN learning_sessions session ON session.id = context.session_id
        LEFT JOIN course_revisions revision ON revision.course_id = context.course_id AND revision.id = context.revision_id
        LEFT JOIN course_lessons lesson ON lesson.course_id = context.course_id AND lesson.revision_id = context.revision_id AND lesson.id = context.lesson_id
        LEFT JOIN session_snapshots snapshot ON snapshot.id = context.session_snapshot_id AND snapshot.session_id = context.session_id
        WHERE session.id IS NULL OR revision.id IS NULL OR lesson.id IS NULL OR snapshot.id IS NULL) AS session_context_scope_rows,
       (SELECT count(*) FROM evidence_facts evidence
        LEFT JOIN session_course_contexts context ON context.session_id = evidence.session_id AND context.course_id = evidence.course_id AND context.revision_id = evidence.revision_id AND context.lesson_id = evidence.lesson_id
        LEFT JOIN course_activities activity ON activity.course_id = evidence.course_id AND activity.revision_id = evidence.revision_id AND activity.lesson_id = evidence.lesson_id AND activity.id = evidence.activity_id
        WHERE context.session_id IS NULL OR activity.id IS NULL) AS evidence_scope_rows,
       (SELECT count(*) FROM review_items item
        LEFT JOIN evidence_facts evidence ON evidence.course_id = item.course_id AND evidence.revision_id = item.revision_id AND evidence.id = item.source_evidence_id
        WHERE evidence.id IS NULL) AS review_item_scope_rows,
       (SELECT count(*) FROM migration_provenance provenance
        LEFT JOIN migration_runs run ON run.id = provenance.run_id AND run.source_database_digest = provenance.source_database_digest
        WHERE run.id IS NULL) AS provenance_run_rows,
       (SELECT count(*) FROM migration_quarantine quarantine
        LEFT JOIN migration_provenance provenance ON provenance.id = quarantine.provenance_id AND provenance.run_id = quarantine.run_id AND provenance.source_table = quarantine.source_table AND provenance.source_primary_key = quarantine.source_primary_key AND provenance.source_row_hash = quarantine.source_row_hash
        LEFT JOIN migration_runs run ON run.id = quarantine.run_id
        WHERE provenance.id IS NULL OR run.id IS NULL) AS quarantine_provenance_rows`,
    )
    .get() as Record<string, unknown>;
  const counts = {
    revisionScopeRows: toNumber(row.revision_scope_rows),
    revisionParentRows: toNumber(row.revision_parent_rows),
    sourceSnapshotSupersedesScopeRows: toNumber(
      row.source_snapshot_supersedes_scope_rows,
    ),
    courseActiveRevisionRows: toNumber(row.course_active_revision_rows),
    sectionScopeRows: toNumber(row.section_scope_rows),
    lessonScopeRows: toNumber(row.lesson_scope_rows),
    lessonPrerequisiteScopeRows: toNumber(row.lesson_prerequisite_scope_rows),
    activityScopeRows: toNumber(row.activity_scope_rows),
    activityPrerequisiteScopeRows: toNumber(
      row.activity_prerequisite_scope_rows,
    ),
    sourceSnapshotScopeRows: toNumber(row.source_snapshot_scope_rows),
    knowledgeCapsuleScopeRows: toNumber(row.knowledge_capsule_scope_rows),
    knowledgeCapsuleSourceScopeRows: toNumber(
      row.knowledge_capsule_source_scope_rows,
    ),
    adaptationBranchScopeRows: toNumber(row.adaptation_branch_scope_rows),
    sessionContextScopeRows: toNumber(row.session_context_scope_rows),
    evidenceScopeRows: toNumber(row.evidence_scope_rows),
    reviewItemScopeRows: toNumber(row.review_item_scope_rows),
    provenanceRunRows: toNumber(row.provenance_run_rows),
    quarantineProvenanceRows: toNumber(row.quarantine_provenance_rows),
  };
  return {
    inspected: true,
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    ...counts,
  };
}

function readNonNegativeInteger(value: unknown): number | null {
  if (typeof value === "bigint") {
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : null;
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function readSha256(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : null;
}

function readOptionalSha256(value: unknown): string | null {
  return value === null ? null : readSha256(value);
}

function emptyAgentMessageCounts(
  tablePresent: boolean,
  rows: number,
): LogicalAgentMessageCounts {
  return {
    tablePresent,
    schemaCompatible: false,
    rows,
    toolEventBytes: tablePresent ? null : 0,
    nonEmptyToolEventRows: tablePresent ? null : 0,
    invalidToolEventRows: tablePresent ? null : 0,
    rawEventBytes: tablePresent ? null : 0,
    rawEventRows: tablePresent ? null : 0,
    invalidRawEventRows: tablePresent ? null : 0,
  };
}

function emptyReviewCounts(
  tablePresent: boolean,
  rows: number,
): LogicalReviewCounts {
  return {
    tablePresent,
    schemaCompatible: false,
    rows,
    rawResponseBytes: tablePresent ? null : 0,
    rawResponseRows: tablePresent ? null : 0,
  };
}
function emptySessionSnapshotInventory(
  tablePresent: boolean,
  rows: number,
): LogicalSessionSnapshotInventory {
  return {
    tablePresent,
    schemaCompatible: false,
    rows,
    storedContentHashRows: tablePresent ? null : 0,
    snapshotJsonBytes: tablePresent ? null : 0,
    contentHashInventorySha256: tablePresent ? null : digestInventory([]),
    snapshotBytesInventorySha256: tablePresent ? null : digestInventory([]),
  };
}

interface LogicalSchemaRow {
  readonly type?: unknown;
  readonly name?: unknown;
  readonly tbl_name?: unknown;
  readonly sql?: unknown;
}

function readLogicalSchema(sqlite: DatabaseSync): LogicalSchemaRow[] {
  return sqlite
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema")
    .all() as LogicalSchemaRow[];
}

export function databaseSchemaSha256(sqlite: DatabaseSync): string {
  const digest = createHash("sha256");
  updateLogicalSchemaDigest(digest, readLogicalSchema(sqlite));
  return digest.digest("hex");
}

function updateLogicalSchemaDigest(
  digest: Hash,
  schemaRows: readonly LogicalSchemaRow[],
): void {
  const schemaDigests = schemaRows
    .map((row) => logicalRowDigest([row.type, row.name, row.tbl_name, row.sql]))
    .sort(Buffer.compare);
  updateLogicalValue(digest, BigInt(schemaDigests.length));
  for (const schemaDigest of schemaDigests) {
    updateLogicalValue(digest, schemaDigest);
  }
}

export function databaseLogicalSha256(sqlite: DatabaseSync): string {
  const schemaRows = readLogicalSchema(sqlite);
  const digest = createHash("sha256");
  updateLogicalSchemaDigest(digest, schemaRows);

  const tables = schemaRows
    .filter((row) => row.type === "table" && typeof row.name === "string")
    .map((row) => ({ name: row.name as string, sql: row.sql }))
    .sort((left, right) => compareLogicalNames(left.name, right.name));
  updateLogicalValue(digest, BigInt(tables.length));
  for (const table of tables) {
    updateLogicalValue(digest, table.name);
    const rowidProjection = logicalRowidProjection(
      sqlite,
      table.name,
      table.sql,
    );
    const statement = sqlite.prepare(
      rowidProjection === null
        ? `SELECT * FROM ${quoteSqlIdentifier(table.name)}`
        : `SELECT *, ${rowidProjection.expression} AS ${quoteSqlIdentifier(
            rowidProjection.resultAlias,
          )} FROM ${quoteSqlIdentifier(table.name)}`,
    );
    statement.setReadBigInts(true);
    const rowDigests: Buffer[] = [];
    for (const row of statement.iterate() as Iterable<
      Record<string, unknown>
    >) {
      rowDigests.push(logicalRowDigest(Object.values(row)));
    }
    rowDigests.sort(Buffer.compare);
    updateLogicalValue(digest, BigInt(rowDigests.length));
    for (const rowDigest of rowDigests) {
      updateLogicalValue(digest, rowDigest);
    }
  }

  const userVersion = sqlite.prepare("PRAGMA user_version").get() as
    { user_version?: unknown } | undefined;
  const applicationId = sqlite.prepare("PRAGMA application_id").get() as
    { application_id?: unknown } | undefined;
  updateLogicalValue(digest, toLogicalInteger(userVersion?.user_version));
  updateLogicalValue(digest, toLogicalInteger(applicationId?.application_id));
  return digest.digest("hex");
}

function logicalRowidProjection(
  sqlite: DatabaseSync,
  tableName: string,
  schemaSql: unknown,
): { expression: string; resultAlias: string } | null {
  if (
    typeof schemaSql === "string" &&
    /\bWITHOUT\s+ROWID\b/iu.test(schemaSql)
  ) {
    return null;
  }
  const declaredNames = new Set(
    (
      sqlite
        .prepare(`PRAGMA table_info(${quoteSqlIdentifier(tableName)})`)
        .all() as Array<{ name?: unknown }>
    )
      .map((row) => String(row.name ?? "").toLowerCase())
      .filter(Boolean),
  );
  const expression = ["rowid", "_rowid_", "oid"].find(
    (alias) => !declaredNames.has(alias),
  );
  if (expression === undefined) {
    throw new Error(
      "Logical database identity cannot access a rowid table's hidden rowid",
    );
  }
  let resultAlias = "__aptiloop_hidden_rowid__";
  while (declaredNames.has(resultAlias.toLowerCase())) resultAlias += "_";
  return { expression, resultAlias };
}

function logicalRowDigest(values: readonly unknown[]): Buffer {
  const digest = createHash("sha256");
  updateLogicalValue(digest, BigInt(values.length));
  for (const value of values) updateLogicalValue(digest, value);
  return digest.digest();
}
function digestInventory(rowDigests: Buffer[]): string {
  rowDigests.sort(Buffer.compare);
  const digest = createHash("sha256");
  updateLogicalValue(digest, BigInt(rowDigests.length));
  for (const rowDigest of rowDigests) updateLogicalValue(digest, rowDigest);
  return digest.digest("hex");
}

function updateLogicalValue(digest: Hash, value: unknown): void {
  let tag: number;
  let payload: Buffer;
  if (value === null || value === undefined) {
    tag = 0;
    payload = Buffer.alloc(0);
  } else if (typeof value === "bigint") {
    tag = 1;
    payload = Buffer.from(value.toString(10), "utf8");
  } else if (typeof value === "number") {
    tag = 2;
    payload = Buffer.allocUnsafe(8);
    payload.writeDoubleBE(value);
  } else if (typeof value === "string") {
    tag = 3;
    payload = Buffer.from(value, "utf8");
  } else if (value instanceof Uint8Array) {
    tag = 4;
    payload = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  } else {
    throw new Error("Database contained an unsupported SQLite value type");
  }
  const frame = Buffer.allocUnsafe(9);
  frame[0] = tag;
  frame.writeBigUInt64BE(BigInt(payload.byteLength), 1);
  digest.update(frame);
  digest.update(payload);
}

function quoteSqlIdentifier(identifier: string): string {
  if (identifier.includes("\0")) {
    throw new Error("Database schema contained an invalid identifier");
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

function compareLogicalNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toLogicalInteger(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  throw new Error("Database pragma returned an invalid integer");
}

function tableExists(sqlite: DatabaseSync, table: string): boolean {
  return Boolean(
    sqlite
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ? LIMIT 1",
      )
      .get(table),
  );
}

function tableColumns(sqlite: DatabaseSync, table: string): Set<string> {
  if (
    inspectableInventoryTables[table] !== true &&
    !Object.hasOwn(m2ExpectedTableColumns, table)
  ) {
    throw new Error("Inventory attempted to inspect an unapproved table");
  }
  return new Set(
    (
      sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name?: unknown;
      }>
    ).map((row) => String(row.name)),
  );
}

function countRows(sqlite: DatabaseSync, table: string): number {
  if (
    countableInventoryTables[table] !== true &&
    !Object.hasOwn(m2ExpectedTableColumns, table)
  ) {
    throw new Error("Inventory attempted to count an unapproved table");
  }
  const row = sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get() as
    { count?: unknown } | undefined;
  return toNumber(row?.count);
}

function sanitizeMigrationId(value: unknown): string {
  const id = String(value ?? "");
  return safeMigrationIdPattern.test(id) ? id : `sha256:${shortHash(id)}`;
}

function fingerprintFamily(
  paths: InventoryFamilyPaths,
  trustedRoot: string,
): InventoryFamilyFingerprint {
  const main = fingerprintFile(paths.main, trustedRoot);
  const wal = fingerprintFile(paths.wal, trustedRoot);
  const shm = fingerprintFile(paths.shm, trustedRoot);
  const journal = fingerprintFile(paths.journal, trustedRoot);
  return {
    family: {
      main: main.metadata,
      wal: wal.metadata,
      shm: shm.metadata,
      journal: journal.metadata,
    },
    files: { main, wal, shm, journal },
  };
}

function fingerprintFile(
  candidatePath: string,
  trustedRoot: string,
): InventoryFileFingerprint {
  assertSafeInventoryParent(candidatePath, trustedRoot);
  let stats: BigIntStats;
  try {
    stats = lstatSync(candidatePath, { bigint: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return { metadata: missingInventoryFile(), identity: null };
    }
    throw error;
  }
  assertSafeInventoryFile(candidatePath, stats);
  const identity = inventoryIdentity(stats);
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const descriptor = openSync(
    candidatePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    assertInventoryIdentity(fstatSync(descriptor, { bigint: true }), identity);
    let bytesRead = 0;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    assertInventoryIdentity(fstatSync(descriptor, { bigint: true }), identity);
  } finally {
    closeSync(descriptor);
  }
  assertSafeInventoryParent(candidatePath, trustedRoot);
  assertInventoryIdentity(lstatSync(candidatePath, { bigint: true }), identity);
  return {
    metadata: {
      present: true,
      bytes: Number(identity.size),
      modifiedAtMs: Number(identity.mtimeNs) / 1_000_000,
      sha256: hash.digest("hex"),
    },
    identity,
  };
}

function sameFamily(
  left: InventoryFamilyFingerprint,
  right: InventoryFamilyFingerprint,
): boolean {
  return (
    sameFile(left.family.main, right.family.main) &&
    sameFile(left.family.wal, right.family.wal) &&
    sameFile(left.family.shm, right.family.shm) &&
    sameFile(left.family.journal, right.family.journal) &&
    sameInventoryIdentity(
      left.files.main.identity,
      right.files.main.identity,
    ) &&
    sameInventoryIdentity(left.files.wal.identity, right.files.wal.identity) &&
    sameInventoryIdentity(left.files.shm.identity, right.files.shm.identity) &&
    sameInventoryIdentity(
      left.files.journal.identity,
      right.files.journal.identity,
    )
  );
}

function assertSafeInventoryDirectory(
  directoryPath: string,
  trustedRoot: string,
  required: boolean,
): boolean {
  assertInventoryContained(trustedRoot, directoryPath);
  let stats: BigIntStats;
  try {
    stats = lstatSync(directoryPath, { bigint: true });
  } catch (error) {
    if (!required && hasErrorCode(error, "ENOENT")) return false;
    throw new Error("Inventory directory cannot be safely inspected", {
      cause: error,
    });
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    if (!required) return false;
    throw new Error("Inventory directory must be a real directory");
  }
  if (
    pathKey(realpathSync.native(directoryPath)) !==
    pathKey(resolve(directoryPath))
  ) {
    if (!required) return false;
    throw new Error("Inventory directory contains a reparse component");
  }
  return true;
}

function assertSafeInventoryParent(
  candidatePath: string,
  trustedRoot: string,
): void {
  assertSafeInventoryDirectory(trustedRoot, trustedRoot, true);
  assertSafeInventoryDirectory(dirname(candidatePath), trustedRoot, true);
}

function assertSafeInventoryFile(
  candidatePath: string,
  stats: BigIntStats,
): void {
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1n) {
    throw new Error(
      "Inventory database family entry is not an exclusive regular file",
    );
  }
  const canonicalParent = realpathSync.native(dirname(candidatePath));
  const expectedCanonicalPath = join(canonicalParent, basename(candidatePath));
  if (
    pathKey(realpathSync.native(candidatePath)) !==
    pathKey(expectedCanonicalPath)
  ) {
    throw new Error("Inventory database family entry is a reparse point");
  }
}

function assertInventoryContained(
  trustedRoot: string,
  candidatePath: string,
): void {
  const relativePath = relative(resolve(trustedRoot), resolve(candidatePath));
  if (
    relativePath === ".." ||
    /^[.]{2}[\\/]/u.test(relativePath) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Inventory path escapes its explicit trusted root");
  }
}

function inventoryIdentity(stats: BigIntStats): InventoryFileIdentity {
  return {
    device: stats.dev,
    inode: stats.ino,
    birthtimeNs: stats.birthtimeNs,
    size: stats.size,
    mtimeNs: stats.mtimeNs,
  };
}

function assertInventoryIdentity(
  stats: BigIntStats,
  expected: InventoryFileIdentity,
): void {
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    stats.nlink !== 1n ||
    stats.dev !== expected.device ||
    stats.ino !== expected.inode ||
    stats.birthtimeNs !== expected.birthtimeNs ||
    stats.size !== expected.size ||
    stats.mtimeNs !== expected.mtimeNs
  ) {
    throw new Error(
      "Inventory database family entry changed during inspection",
    );
  }
}

function sameInventoryIdentity(
  left: InventoryFileIdentity | null,
  right: InventoryFileIdentity | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.birthtimeNs === right.birthtimeNs &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  );
}

function copyVerifiedInventoryFile(
  sourcePath: string,
  destinationPath: string,
  expected: InventoryFileFingerprint,
  trustedRoot: string,
): void {
  if (expected.identity === null || expected.metadata.sha256 === null) {
    throw new Error("Missing inventory family entry cannot be copied");
  }
  assertSafeInventoryParent(sourcePath, trustedRoot);
  assertInventoryIdentity(
    lstatSync(sourcePath, { bigint: true }),
    expected.identity,
  );
  let sourceDescriptor: number | undefined;
  let destinationDescriptor: number | undefined;
  try {
    sourceDescriptor = openSync(
      sourcePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    destinationDescriptor = openSync(
      destinationPath,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    assertInventoryIdentity(
      fstatSync(sourceDescriptor, { bigint: true }),
      expected.identity,
    );
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const bytesRead = readSync(
        sourceDescriptor,
        buffer,
        0,
        buffer.length,
        null,
      );
      if (bytesRead === 0) break;
      digest.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        written += writeSync(
          destinationDescriptor,
          buffer,
          written,
          bytesRead - written,
          null,
        );
      }
    }
    assertInventoryIdentity(
      fstatSync(sourceDescriptor, { bigint: true }),
      expected.identity,
    );
    const destinationStats = fstatSync(destinationDescriptor, { bigint: true });
    if (!destinationStats.isFile() || destinationStats.nlink !== 1n) {
      throw new Error(
        "Inventory snapshot destination is not an exclusive file",
      );
    }
    if (digest.digest("hex") !== expected.metadata.sha256) {
      throw new Error("Inventory database family entry changed while copying");
    }
  } finally {
    if (sourceDescriptor !== undefined) closeSync(sourceDescriptor);
    if (destinationDescriptor !== undefined) closeSync(destinationDescriptor);
  }
  assertSafeInventoryParent(sourcePath, trustedRoot);
  assertInventoryIdentity(
    lstatSync(sourcePath, { bigint: true }),
    expected.identity,
  );
}

function presenceOnlyFamily(
  paths: InventoryFamilyPaths,
): PrivateDataInventoryCandidate["family"] {
  return {
    main: presenceOnlyFile(paths.main),
    wal: presenceOnlyFile(paths.wal),
    shm: presenceOnlyFile(paths.shm),
    journal: presenceOnlyFile(paths.journal),
  };
}

function presenceOnlyFile(candidatePath: string): InventoryFileMetadata {
  try {
    lstatSync(candidatePath);
    return { present: true, bytes: 0, modifiedAtMs: 0, sha256: null };
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return missingInventoryFile();
    return { present: true, bytes: 0, modifiedAtMs: 0, sha256: null };
  }
}

function missingInventoryFile(): InventoryFileMetadata {
  return { present: false, bytes: 0, modifiedAtMs: 0, sha256: null };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function sameFile(
  left: InventoryFileMetadata,
  right: InventoryFileMetadata,
): boolean {
  return (
    left.present === right.present &&
    left.bytes === right.bytes &&
    left.modifiedAtMs === right.modifiedAtMs &&
    left.sha256 === right.sha256
  );
}

function isBackupPath(path: string): boolean {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => segment.toLowerCase().endsWith("backups"));
}

function safeError(error: unknown): { name: string; code: string | null } {
  if (!(error instanceof Error)) {
    return { name: "UnknownError", code: null };
  }
  const candidate = error as Error & { code?: unknown };
  const code =
    typeof candidate.code === "string" && /^[A-Z0-9_]+$/.test(candidate.code)
      ? candidate.code
      : null;
  return { name: error.name || "Error", code };
}

function toNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function pathKey(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function comparePaths(left: string, right: string): number {
  return pathKey(left).localeCompare(pathKey(right));
}

function shortHash(value: string): string {
  return sha256(value).slice(0, 16);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
