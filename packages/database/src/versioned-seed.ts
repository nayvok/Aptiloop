import {
  activeCurriculumVersion,
  archivedLegacyCurriculumVersion,
  publishedCurriculumRevision2,
  publishedCurriculumV2,
  publishedCurriculumV3,
  type UnitCompletionCriterion as AuthoredCriterion,
  type VersionedCurriculumDay as AuthoredDay,
  type VersionedCurriculumQuestion as AuthoredQuestion,
  type VersionedCurriculumSource as AuthoredSource,
  type VersionedCurriculumUnit as AuthoredUnit,
  type VersionedCurriculumVersion as AuthoredVersion,
} from "@dlh/curriculum";
import {
  CurriculumVersionSchema,
  type CurriculumSource,
  type CurriculumUnit,
  type CurriculumVersion,
  type UnitCompletionCriterion,
  type UnitPayload,
} from "@dlh/shared";

import { withTransaction, type DatabaseConnection } from "./database.js";

export interface VersionedSeedResult {
  curriculumVersions: number;
  versionedWeeks: number;
  versionedDays: number;
  versionedUnits: number;
}

const rowId = (versionId: string, kind: string, stableId: string): string =>
  `${versionId}:${kind}:${stableId}`;

function mapSource(source: AuthoredSource): CurriculumSource {
  return {
    id: source.id,
    title: source.title,
    url: source.url,
    kind: source.kind,
    ...(source.note === undefined ? {} : { description: source.note }),
    required: source.required,
    estimatedMinutes: source.estimatedMinutes,
    learningGoal: source.learningGoal,
    examplesToRepeat: [...source.examplesToRepeat],
  };
}

function mapQuestion(question: AuthoredQuestion) {
  return {
    id: question.stableId,
    kind: question.kind,
    prompt: question.prompt,
    options: (question.options ?? []).map((option) => ({
      id: option.stableId,
      label: option.label,
    })),
    correctOptionIds: [
      ...(question.protectedEvaluation.correctOptionStableIds ?? []),
    ],
    referenceAnswer: question.protectedEvaluation.referenceAnswer,
    evaluationPoints: [...question.protectedEvaluation.evaluationPoints],
    commonMistakes: [...question.misconceptions],
  };
}

function mapCriterion(
  criterion: AuthoredCriterion,
  unit: AuthoredUnit,
  checklistIds: readonly string[],
): UnitCompletionCriterion {
  switch (criterion.evidence) {
    case "acknowledgement":
      return { type: "acknowledgement" };
    case "checklist":
      return checklistIds.length
        ? { type: "checklist", requiredItemIds: [...checklistIds] }
        : { type: "custom", key: criterion.stableId };
    case "written-attempt":
      return { type: "attempts", minimum: criterion.minimum ?? 1 };
    case "dialogue-revision":
      return {
        type: "dialogue",
        minimumTurns: criterion.minimum ?? 1,
        requiresRevision: true,
      };
    case "quiz-score":
      return {
        type: "score",
        minimum: Math.min(1, (criterion.minimum ?? 75) / 100),
        minimumAttempts: 1,
      };
    case "code-reading-attempt":
      return {
        type: "fields",
        required: ["prediction", "explanation", "verbalFix"],
      };
    case "exercise-attempt":
    case "accepted-review":
      return {
        type: "exercise",
        passingTestsRequired: true,
        acceptedReviewRequired: unit.type === "review",
      };
    case "summary-commit":
      return { type: "fields", required: ["summaryId"] };
  }
}

function mapPayload(
  unit: AuthoredUnit,
  day: AuthoredDay,
  questions: ReturnType<typeof mapQuestion>[],
): UnitPayload {
  switch (unit.type) {
    case "briefing":
      return {
        type: "briefing",
        scope: [...unit.objectives],
        outOfScope: [...day.outOfScope],
      };
    case "study":
      return { type: "study", body: unit.description };
    case "recall":
      return {
        type: "recall",
        prompt: questions[0]?.prompt ?? unit.description,
      };
    case "teacher-dialogue":
      return {
        type: "teacher-dialogue",
        openingPrompt: questions[0]?.prompt ?? unit.description,
        minimumTurns: 1,
        requiresRevision: true,
      };
    case "quiz":
      return {
        type: "quiz",
        questionIds: questions.map((question) => question.id),
        minimumScore: 0.75,
      };
    case "code-reading":
      return {
        type: "code-reading",
        // Published v3 authors code separately from the learner's question.
        // The fallback keeps immutable legacy curriculum revisions seedable.
        snippet: unit.codeSnippet ?? questions[0]?.prompt ?? unit.description,
      };
    case "exercise": {
      if (!unit.exercise)
        throw new Error(`Exercise payload is missing: ${unit.stableId}`);
      return {
        type: "exercise",
        exerciseId: unit.exercise.exerciseStableId,
        acceptanceCriteria: [...unit.exercise.acceptanceCriteria],
        constraints: [...unit.exercise.constraints],
        // The authored v2 source owns a workspace template rather than inline code.
        // Persisting its full brief keeps the snapshot truthful and non-empty.
        template: unit.exercise.brief,
        testCommandId: unit.exercise.testCommandId,
        hintPolicy: unit.exercise.hintPolicy,
        reviewPolicy: unit.exercise.reviewPolicy,
      };
    }
    case "review": {
      const exerciseUnitId = unit.unlockRule.requiredUnitStableIds[0];
      if (!exerciseUnitId)
        throw new Error(`Review prerequisite is missing: ${unit.stableId}`);
      return { type: "review", exerciseUnitId };
    }
    case "interview":
      return { type: "interview", topics: [...day.topics] };
    case "summary":
      return { type: "summary", prompts: [...unit.objectives] };
    case "checkpoint":
      return { type: "checkpoint", label: unit.title };
    case "spaced-review":
      return { type: "spaced-review", topicIds: [...day.topics] };
  }
}

function mapUnit(
  versionId: string,
  day: AuthoredDay,
  unit: AuthoredUnit,
): CurriculumUnit {
  const checklist = unit.checklist.map((label, index) => ({
    id: `${unit.stableId}-check-${index + 1}`,
    label,
    required: true,
  }));
  const questions = unit.questions.map(mapQuestion);
  return {
    id: rowId(versionId, "unit", unit.stableId),
    stableId: unit.stableId,
    type: unit.type,
    title: unit.title,
    description: unit.description,
    order: unit.order,
    estimatedMinutes: unit.estimatedMinutes,
    objectives: [...unit.objectives],
    checklist,
    sources: unit.sources.map(mapSource),
    questions,
    misconceptions: [...unit.misconceptions],
    referenceAnswer: null,
    completionCriteria: unit.completionCriteria.map((criterion) =>
      mapCriterion(
        criterion,
        unit,
        checklist.map((item) => item.id),
      ),
    ),
    unlockRules: unit.unlockRule.requiredUnitStableIds.map((unitId) => ({
      type: "unit-completed" as const,
      unitId,
    })),
    optional: !unit.required,
    depthLevel: unit.depthLevel,
    payload: mapPayload(unit, day, questions),
  };
}

export function mapActiveCurriculumVersion(
  source: AuthoredVersion = activeCurriculumVersion,
): CurriculumVersion {
  const mapped = {
    id: source.id,
    curriculumId: source.curriculumId,
    revision: source.revision,
    parentVersionId: source.parentVersionId,
    status: source.status,
    title: source.title,
    description: source.description,
    contentHash: source.contentHash,
    createdAt: source.createdAt,
    publishedAt: source.publishedAt,
    archivedAt: source.archivedAt,
    weeks: source.weeks.map((week) => ({
      id: rowId(source.id, "week", week.stableId),
      stableId: week.stableId,
      order: week.order,
      title: week.title,
      description: week.description,
      days: week.days.map((day) => ({
        id: rowId(source.id, "day", day.stableId),
        stableId: day.stableId,
        order: day.order,
        title: day.title,
        description: day.description,
        goal: day.goal,
        estimatedMinutes: day.estimatedMinutes,
        prerequisites: [...day.prerequisites],
        expectedOutcomes: [...day.expectedOutcomes],
        depthLevel: day.depthLevel,
        outOfScope: [...day.outOfScope],
        topics: [...day.topics],
        units: day.units.map((unit) => mapUnit(source.id, day, unit)),
      })),
    })),
  };
  return CurriculumVersionSchema.parse(mapped);
}

function seedSingleVersion(
  connection: DatabaseConnection,
  source: AuthoredVersion,
): VersionedSeedResult {
  const version = mapActiveCurriculumVersion(source);
  const result = {
    curriculumVersions: 1,
    versionedWeeks: version.weeks.length,
    versionedDays: version.weeks.reduce(
      (count, week) => count + week.days.length,
      0,
    ),
    versionedUnits: version.weeks.reduce(
      (count, week) =>
        count +
        week.days.reduce((dayCount, day) => dayCount + day.units.length, 0),
      0,
    ),
  };

  withTransaction(connection, () => {
    const existing = connection.sqlite
      .prepare(
        "SELECT status, content_hash FROM curriculum_versions WHERE id = ?",
      )
      .get(version.id) as
      { status: string; content_hash: string | null } | undefined;
    if (existing) {
      if (
        existing.status !== "published" ||
        existing.content_hash !== version.contentHash
      ) {
        throw new Error(
          `Seeded curriculum version conflicts with immutable row: ${version.id}`,
        );
      }
      const counts = connection.sqlite
        .prepare(
          `SELECT
             (SELECT count(*) FROM curriculum_weeks WHERE version_id = ?) AS weeks,
             (SELECT count(*) FROM curriculum_days_v2 WHERE version_id = ?) AS days,
             (SELECT count(*) FROM curriculum_units WHERE version_id = ?) AS units`,
        )
        .get(version.id, version.id, version.id) as {
        weeks: number;
        days: number;
        units: number;
      };
      if (
        counts.weeks !== result.versionedWeeks ||
        counts.days !== result.versionedDays ||
        counts.units !== result.versionedUnits
      ) {
        throw new Error(`Seeded curriculum graph is incomplete: ${version.id}`);
      }
      // Authored curriculum timestamps may legitimately lie in the future
      // (release notes are dated ahead of the local clock). The path picks the
      // active curriculum by `curricula.updated_at DESC`, so such a row must
      // never outrank a real, later publish. Clamp the wall-clock marker to
      // the seed moment when the authored value is in the future.
      connection.sqlite
        .prepare(
          `UPDATE curricula SET updated_at = ? WHERE id = ? AND updated_at > ?`,
        )
        .run(Date.now(), version.curriculumId, Date.now());
      return;
    }

    const createdAt = Date.parse(version.createdAt);
    const publishedAt = Date.parse(version.publishedAt ?? version.createdAt);
    const wallClockNow = Date.now();
    const curriculumUpdatedAt = Math.min(publishedAt, wallClockNow);
    const parentExists = version.parentVersionId
      ? connection.sqlite
          .prepare("SELECT id FROM curriculum_versions WHERE id = ?")
          .get(version.parentVersionId)
      : undefined;
    if (
      version.parentVersionId === archivedLegacyCurriculumVersion.id &&
      !parentExists
    ) {
      connection.sqlite
        .prepare(
          `INSERT OR IGNORE INTO curricula
           (id, slug, title, description, active_version_id, created_at, updated_at)
           VALUES ('curriculum-legacy-bridge', 'curriculum-legacy-bridge',
                   ?, 'Immutable metadata for the preserved legacy curriculum export',
                   NULL, ?, ?)`,
        )
        .run(archivedLegacyCurriculumVersion.title, createdAt, createdAt);
      connection.sqlite
        .prepare(
          `INSERT OR IGNORE INTO curriculum_versions
           (id, curriculum_id, revision, parent_version_id, status, title, description,
            content_hash, created_at, published_at, archived_at, updated_at)
           VALUES (?, 'curriculum-legacy-bridge', 1, NULL, 'archived',
                   ?, 'Preserved legacy weekOneCurriculum export', ?, ?, ?, ?, ?)`,
        )
        .run(
          version.parentVersionId,
          archivedLegacyCurriculumVersion.title,
          "20b3e27c49fa179fd04ec1435649fb776ae02c6eccbdf2ec6bc17d4b61fae5c3",
          Date.parse(archivedLegacyCurriculumVersion.publishedAt),
          Date.parse(archivedLegacyCurriculumVersion.publishedAt),
          Date.parse(archivedLegacyCurriculumVersion.archivedAt),
          Date.parse(archivedLegacyCurriculumVersion.archivedAt),
        );
    }
    if (
      version.parentVersionId &&
      !connection.sqlite
        .prepare("SELECT id FROM curriculum_versions WHERE id = ?")
        .get(version.parentVersionId)
    ) {
      throw new Error(
        `Missing immutable parent curriculum version: ${version.parentVersionId}`,
      );
    }
    connection.sqlite
      .prepare(
        `INSERT OR IGNORE INTO curricula
         (id, slug, title, description, active_version_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        version.curriculumId,
        version.curriculumId,
        version.title,
        version.description,
        createdAt,
        createdAt,
      );
    connection.sqlite
      .prepare(
        `INSERT INTO curriculum_versions
         (id, curriculum_id, revision, parent_version_id, status, title, description,
          content_hash, created_at, published_at, archived_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, NULL, ?, NULL, NULL, ?)`,
      )
      .run(
        version.id,
        version.curriculumId,
        version.revision,
        version.parentVersionId,
        version.title,
        version.description,
        createdAt,
        createdAt,
      );

    const insertWeek = connection.sqlite.prepare(
      `INSERT INTO curriculum_weeks
       (id, version_id, stable_id, order_index, title, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertDay = connection.sqlite.prepare(
      `INSERT INTO curriculum_days_v2
       (id, version_id, week_id, stable_id, order_index, title, description, goal,
        estimated_minutes, prerequisites_json, expected_outcomes_json, depth_level,
        out_of_scope_json, topics_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertUnit = connection.sqlite.prepare(
      `INSERT INTO curriculum_units
       (id, version_id, day_id, stable_id, type, order_index, title, description,
        estimated_minutes, objectives_json, checklist_json, sources_json, questions_json,
        misconceptions_json, reference_answer_json, completion_criteria_json,
        unlock_rules_json, optional, depth_level, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const week of version.weeks) {
      insertWeek.run(
        week.id,
        version.id,
        week.stableId,
        week.order - 1,
        week.title,
        week.description,
        createdAt,
        createdAt,
      );
      for (const day of week.days) {
        insertDay.run(
          day.id,
          version.id,
          week.id,
          day.stableId,
          day.order - 1,
          day.title,
          day.description,
          day.goal,
          day.estimatedMinutes,
          JSON.stringify(day.prerequisites),
          JSON.stringify(day.expectedOutcomes),
          day.depthLevel,
          JSON.stringify(day.outOfScope),
          JSON.stringify(day.topics),
          createdAt,
          createdAt,
        );
        for (const unit of day.units) {
          insertUnit.run(
            unit.id,
            version.id,
            day.id,
            unit.stableId,
            unit.type,
            unit.order - 1,
            unit.title,
            unit.description,
            unit.estimatedMinutes,
            JSON.stringify(unit.objectives),
            JSON.stringify(unit.checklist),
            JSON.stringify(unit.sources),
            JSON.stringify(unit.questions),
            JSON.stringify(unit.misconceptions),
            unit.referenceAnswer === null
              ? null
              : JSON.stringify(unit.referenceAnswer),
            JSON.stringify(unit.completionCriteria),
            JSON.stringify(unit.unlockRules),
            unit.optional ? 1 : 0,
            unit.depthLevel,
            JSON.stringify(unit.payload),
            createdAt,
            createdAt,
          );
        }
      }
    }
    connection.sqlite
      .prepare(
        `UPDATE curriculum_versions
         SET status = 'published', content_hash = ?, published_at = ?, updated_at = ?
         WHERE id = ? AND status = 'draft'`,
      )
      .run(version.contentHash, publishedAt, publishedAt, version.id);
    connection.sqlite
      .prepare(
        "UPDATE curricula SET active_version_id = ?, updated_at = ? WHERE id = ?",
      )
      .run(version.id, curriculumUpdatedAt, version.curriculumId);
  });
  return result;
}

export function seedVersionedCurriculum(
  connection: DatabaseConnection,
  source?: AuthoredVersion,
): VersionedSeedResult {
  const sources =
    source === undefined
      ? [
          publishedCurriculumV2,
          publishedCurriculumRevision2,
          publishedCurriculumV3,
          activeCurriculumVersion,
        ]
      : [source];
  return sources.reduce<VersionedSeedResult>(
    (total, candidate) => {
      const seeded = seedSingleVersion(connection, candidate);
      return {
        curriculumVersions:
          total.curriculumVersions + seeded.curriculumVersions,
        versionedWeeks: total.versionedWeeks + seeded.versionedWeeks,
        versionedDays: total.versionedDays + seeded.versionedDays,
        versionedUnits: total.versionedUnits + seeded.versionedUnits,
      };
    },
    {
      curriculumVersions: 0,
      versionedWeeks: 0,
      versionedDays: 0,
      versionedUnits: 0,
    },
  );
}
