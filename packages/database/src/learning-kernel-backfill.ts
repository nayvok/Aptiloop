import {
  canonicalLearningKernelJson,
  learningKernelSha256,
  type LearningKernelCommand,
  type LearningKernelEvidenceBody,
} from "@aptiloop/learning-core";

import type { DatabaseConnection } from "./database.js";
import { createLearningKernelRepository } from "./learning-kernel-repository.js";

const MIGRATION_VERSION = "m4-backfill-v1";

interface LegacyProgressRow {
  session_id: string;
  unit_id: string;
  status: "locked" | "ready" | "in_progress" | "completed" | "skipped";
  started_at: number | null;
  completed_at: number | null;
  skipped_at: number | null;
  updated_at: number;
}

interface LegacyEvidenceRow {
  id: string;
  session_id: string;
  unit_id: string;
  evidence_type:
    "recall-attempt" | "quiz-answer" | "code-reading-attempt" | "summary";
  operation_id: string;
  question_id: string | null;
  payload_json: string;
  correctness: number | null;
  created_at: number;
}

interface BackfillActivity {
  id: string;
  knowledgeNodeIds: readonly string[];
}

export interface LearningKernelBackfillResult {
  readonly acceptedFacts: number;
  readonly quarantinedRows: number;
}

export function backfillLearningKernel(
  connection: DatabaseConnection,
  acceptedAt = Date.now(),
): LearningKernelBackfillResult {
  const repository = createLearningKernelRepository(connection, {
    now: () => acceptedAt,
  });
  const progressRows = connection.sqlite
    .prepare(
      `SELECT session_id, unit_id, status, started_at, completed_at, skipped_at,
              updated_at
       FROM unit_progress
       WHERE status IN ('in_progress', 'completed', 'skipped')
       ORDER BY session_id, updated_at, unit_id`,
    )
    .all() as unknown as LegacyProgressRow[];
  const evidenceRows = connection.sqlite
    .prepare(
      `SELECT id, session_id, unit_id, evidence_type, operation_id,
              question_id, payload_json, correctness, created_at
       FROM versioned_unit_evidence
       ORDER BY created_at, id`,
    )
    .all() as unknown as LegacyEvidenceRow[];

  let acceptedFacts = 0;
  let quarantinedRows = 0;
  const scopes = new Map<
    string,
    ReturnType<typeof repository.resolveSessionScope> | null
  >();
  const activities = new Map<string, ReadonlyMap<string, BackfillActivity>>();

  const resolve = (sessionId: string) => {
    if (!scopes.has(sessionId)) {
      try {
        const scope = repository.resolveSessionScope(sessionId);
        scopes.set(sessionId, scope);
        activities.set(
          sessionId,
          new Map(
            repository
              .listActivities(scope)
              .map((activity) => [activity.id, activity] as const),
          ),
        );
      } catch {
        scopes.set(sessionId, null);
      }
    }
    return scopes.get(sessionId) ?? null;
  };

  const quarantine = (
    sourceTable: string,
    sourceId: string,
    reasonCode: string,
    source: object,
    occurredAt: number,
  ) => {
    const result = connection.sqlite
      .prepare(
        `INSERT OR IGNORE INTO learning_kernel_migration_quarantine
         (source_table, source_id, reason_code, source_snapshot_json,
          quarantined_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        sourceTable,
        sourceId,
        reasonCode,
        canonicalLearningKernelJson(source),
        occurredAt,
      );
    if (result.changes === 1) quarantinedRows += 1;
  };

  const accept = (
    sessionId: string,
    sourceTable: string,
    sourceId: string,
    source: object,
    command: LearningKernelCommand,
  ) => {
    const scope = resolve(sessionId);
    if (!scope) {
      quarantine(
        sourceTable,
        sourceId,
        "MISSING_EXACT_SESSION_BRANCH_SCOPE",
        source,
        Date.parse(command.observedAt),
      );
      return false;
    }
    try {
      const result = repository.accept(scope, command);
      if (result.accepted) acceptedFacts += 1;
      return true;
    } catch {
      quarantine(
        sourceTable,
        sourceId,
        "AMBIGUOUS_OR_INVALID_KERNEL_PROJECTION",
        source,
        Date.parse(command.observedAt),
      );
      return false;
    }
  };

  const progressEvents = progressRows.flatMap((row) => {
    const sourceHash = learningKernelSha256({
      sourceTable: "unit_progress",
      row,
    });
    const events: Array<{
      row: LegacyProgressRow;
      observedAt: number;
      order: number;
      transition: "start" | "complete" | "skip";
      sourceHash: string;
    }> = [];
    if (row.started_at !== null) {
      events.push({
        row,
        observedAt: row.started_at,
        order: 0,
        transition: "start",
        sourceHash,
      });
    }
    const terminalAt =
      row.status === "completed"
        ? row.completed_at
        : row.status === "skipped"
          ? row.skipped_at
          : null;
    if (terminalAt !== null) {
      events.push({
        row,
        observedAt: terminalAt,
        order: 1,
        transition: row.status === "completed" ? "complete" : "skip",
        sourceHash,
      });
    }
    if (events.length === 0) {
      quarantine(
        "unit_progress",
        `${row.session_id}:${row.unit_id}`,
        "MISSING_PROGRESS_TRANSITION_TIME",
        row,
        row.updated_at,
      );
    }
    return events;
  });
  progressEvents.sort(
    (left, right) =>
      left.observedAt - right.observedAt ||
      left.order - right.order ||
      (left.row.session_id < right.row.session_id
        ? -1
        : left.row.session_id > right.row.session_id
          ? 1
          : 0) ||
      (left.row.unit_id < right.row.unit_id
        ? -1
        : left.row.unit_id > right.row.unit_id
          ? 1
          : 0),
  );
  for (const event of progressEvents) {
    const sourceId = `${event.row.session_id}:${event.row.unit_id}:${event.transition}`;
    accept(
      event.row.session_id,
      "unit_progress",
      `${event.row.session_id}:${event.row.unit_id}`,
      event.row,
      {
        operationId: `m4:${sourceId}`,
        factId: `m4-fact:${sourceId}`,
        observedAt: new Date(event.observedAt).toISOString(),
        provenance: {
          kind: "migration",
          sourceId,
          sourceHash: event.sourceHash,
          evaluatorVersion: MIGRATION_VERSION,
        },
        body: {
          type: "progress",
          activityId: event.row.unit_id,
          transition: event.transition,
        },
      },
    );
  }

  for (const row of evidenceRows) {
    if (row.evidence_type === "summary") {
      quarantine(
        "versioned_unit_evidence",
        row.id,
        "SUMMARY_IS_NON_AUTHORITATIVE_PROJECTION",
        row,
        row.created_at,
      );
      continue;
    }
    const scope = resolve(row.session_id);
    const activity = activities.get(row.session_id)?.get(row.unit_id);
    if (!scope || !activity || activity.knowledgeNodeIds.length === 0) {
      quarantine(
        "versioned_unit_evidence",
        row.id,
        "MISSING_EXACT_ACTIVITY_KNOWLEDGE_SCOPE",
        row,
        row.created_at,
      );
      continue;
    }
    const sourceHash = learningKernelSha256({
      sourceTable: "versioned_unit_evidence",
      row,
    });
    const hintLevel = readHistoricalHintLevel(
      connection,
      row.session_id,
      row.unit_id,
      row.created_at,
    );
    const evidenceShape = evidenceShapeFor(row.evidence_type);
    const submissionFactId = `m4-fact:evidence:${row.id}`;
    const submission: LearningKernelEvidenceBody = {
      type: "evidence",
      activityId: row.unit_id,
      knowledgeNodeIds: activity.knowledgeNodeIds,
      dimension: evidenceShape.dimension,
      evidenceType: evidenceShape.evidenceType,
      outcome: "unverified",
      hintLevel,
      basisFactIds: [],
    };
    const submissionAccepted = accept(
      row.session_id,
      "versioned_unit_evidence",
      row.id,
      row,
      {
        operationId: `m4:evidence:${row.operation_id}`,
        factId: submissionFactId,
        observedAt: new Date(row.created_at).toISOString(),
        provenance: {
          kind: "migration",
          sourceId: row.id,
          sourceHash,
          evaluatorVersion: MIGRATION_VERSION,
        },
        body: submission,
      },
    );
    if (row.evidence_type !== "quiz-answer" || !submissionAccepted) continue;
    if (row.correctness === null || row.question_id === null) {
      quarantine(
        "versioned_unit_evidence_evaluation",
        row.id,
        "AMBIGUOUS_QUIZ_EVALUATION",
        row,
        row.created_at,
      );
      continue;
    }
    accept(row.session_id, "versioned_unit_evidence_evaluation", row.id, row, {
      operationId: `m4:evaluation:${row.operation_id}`,
      factId: `m4-fact:evaluation:${row.id}`,
      observedAt: new Date(row.created_at).toISOString(),
      provenance: {
        kind: "deterministic_evaluator",
        sourceId: `${row.id}:evaluation`,
        sourceHash,
        evaluatorVersion: "legacy-quiz-v1",
      },
      body: {
        ...submission,
        outcome: row.correctness === 1 ? "correct" : "incorrect",
        basisFactIds: [submissionFactId],
        ...(row.correctness === 1
          ? {}
          : { errorFamily: `quiz:${row.question_id}` }),
      },
    });
  }

  return { acceptedFacts, quarantinedRows };
}

function evidenceShapeFor(
  evidenceType: LegacyEvidenceRow["evidence_type"],
): Pick<LearningKernelEvidenceBody, "dimension" | "evidenceType"> {
  if (evidenceType === "code-reading-attempt") {
    return { dimension: "codeReading", evidenceType: "code_reading" };
  }
  return { dimension: "understanding", evidenceType: "recall" };
}

function readHistoricalHintLevel(
  connection: DatabaseConnection,
  sessionId: string,
  unitId: string,
  occurredAt: number,
): 0 | 1 | 2 | 3 | 4 | 5 {
  const row = connection.sqlite
    .prepare(
      `SELECT max(level) AS level FROM hint_usages_v2
       WHERE session_id = ? AND unit_id = ? AND used_at <= ?`,
    )
    .get(sessionId, unitId, occurredAt) as { level: number | null };
  return (row.level ?? 0) as 0 | 1 | 2 | 3 | 4 | 5;
}
