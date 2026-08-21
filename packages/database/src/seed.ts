import { weekOneCurriculum, type CurriculumWeek } from "@aptiloop/curriculum";

import { withTransaction, type DatabaseConnection } from "./database.js";
import {
  seedVersionedCurriculum,
  type VersionedSeedResult,
} from "./versioned-seed.js";

export interface SeedResult extends VersionedSeedResult {
  weeks: number;
  days: number;
  topics: number;
  questions: number;
  exercises: number;
}

const exerciseAllowedOperations = JSON.stringify([
  "exercise:test",
  "exercise:typecheck",
]);

export function seedCurriculum(
  connection: DatabaseConnection,
  weeks: readonly CurriculumWeek[] = [weekOneCurriculum],
  now = Date.now(),
): SeedResult {
  const result: SeedResult = {
    weeks: weeks.length,
    days: 0,
    topics: 0,
    questions: 0,
    exercises: 0,
    curriculumVersions: 0,
    versionedWeeks: 0,
    versionedDays: 0,
    versionedUnits: 0,
  };
  const topicIds = new Set<string>();

  withTransaction(connection, () => {
    const selectDayRow = connection.sqlite.prepare(
      `SELECT slug, week_number AS weekNumber, day_number AS dayNumber, title,
              summary, estimated_minutes AS estimatedMinutes,
              goals_json AS goalsJson, sources_json AS sourcesJson
       FROM curriculum_days WHERE id = ?`,
    );
    const upsertDayRow = connection.sqlite.prepare(
      `INSERT INTO curriculum_days
       (id, slug, week_number, day_number, title, summary, estimated_minutes,
        goals_json, sources_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         slug = excluded.slug, week_number = excluded.week_number, day_number = excluded.day_number,
         title = excluded.title, summary = excluded.summary,
         estimated_minutes = excluded.estimated_minutes, goals_json = excluded.goals_json,
         sources_json = excluded.sources_json, updated_at = excluded.updated_at`,
    );
    const selectTopicRow = connection.sqlite.prepare(
      "SELECT slug, title, description FROM topics WHERE id = ?",
    );
    const upsertTopicRow = connection.sqlite.prepare(
      `INSERT INTO topics (id, slug, title, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         slug = excluded.slug, title = excluded.title,
         description = excluded.description, updated_at = excluded.updated_at`,
    );
    const selectDayTopicIds = connection.sqlite.prepare(
      `SELECT topic_id AS topicId FROM curriculum_day_topics
       WHERE day_id = ? ORDER BY order_index, topic_id`,
    );
    const insertDayTopic = connection.sqlite.prepare(
      "INSERT INTO curriculum_day_topics (day_id, topic_id, order_index) VALUES (?, ?, ?)",
    );
    const selectQuestionRow = connection.sqlite.prepare(
      `SELECT day_id AS dayId, kind, prompt, expected_seconds AS expectedSeconds,
              order_index AS orderIndex, reference_answer AS referenceAnswer,
              key_points_json AS keyPointsJson,
              reveal_after_attempts AS revealAfterAttempts, active
       FROM questions WHERE id = ?`,
    );
    const upsertQuestionRow = connection.sqlite.prepare(
      `INSERT INTO questions
       (id, day_id, kind, prompt, expected_seconds, order_index, reference_answer,
        key_points_json, reveal_after_attempts, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         day_id = excluded.day_id, kind = excluded.kind, prompt = excluded.prompt,
         expected_seconds = excluded.expected_seconds, order_index = excluded.order_index,
         reference_answer = excluded.reference_answer, key_points_json = excluded.key_points_json,
         reveal_after_attempts = excluded.reveal_after_attempts, active = 1,
         updated_at = excluded.updated_at`,
    );
    const selectExerciseRow = connection.sqlite.prepare(
      `SELECT day_id AS dayId, slug, title, prompt, difficulty,
              estimated_minutes AS estimatedMinutes, workspace_path AS workspacePath,
              constraints_json AS constraintsJson, criteria_json AS criteriaJson,
              allowed_operations_json AS allowedOperationsJson, active
       FROM exercises WHERE id = ?`,
    );
    const upsertExerciseRow = connection.sqlite.prepare(
      `INSERT INTO exercises
       (id, day_id, slug, title, prompt, difficulty, estimated_minutes, workspace_path,
        constraints_json, criteria_json, allowed_operations_json, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         day_id = excluded.day_id, slug = excluded.slug, title = excluded.title,
         prompt = excluded.prompt, difficulty = excluded.difficulty,
         estimated_minutes = excluded.estimated_minutes, workspace_path = excluded.workspace_path,
         constraints_json = excluded.constraints_json, criteria_json = excluded.criteria_json,
         allowed_operations_json = excluded.allowed_operations_json, active = 1,
         updated_at = excluded.updated_at`,
    );

    for (const week of weeks) {
      for (const day of week.days) {
        result.days += 1;
        const sources = day.topics.flatMap((topic) => topic.sources);
        const existingDayRow = selectDayRow.get(day.id) as
          | {
              slug: string;
              weekNumber: number;
              dayNumber: number;
              title: string;
              summary: string;
              estimatedMinutes: number;
              goalsJson: string;
              sourcesJson: string;
            }
          | undefined;
        if (
          !existingDayRow ||
          existingDayRow.slug !== day.slug ||
          existingDayRow.weekNumber !== week.weekNumber ||
          existingDayRow.dayNumber !== day.dayNumber ||
          existingDayRow.title !== day.title ||
          existingDayRow.summary !== day.summary ||
          existingDayRow.estimatedMinutes !== day.estimatedMinutes ||
          existingDayRow.goalsJson !== JSON.stringify(day.goals) ||
          existingDayRow.sourcesJson !== JSON.stringify(sources)
        ) {
          upsertDayRow.run(
            day.id,
            day.slug,
            week.weekNumber,
            day.dayNumber,
            day.title,
            day.summary,
            day.estimatedMinutes,
            JSON.stringify(day.goals),
            JSON.stringify(sources),
            now,
            now,
          );
        }

        const desiredTopicIds = day.topics.map((topic) => topic.id);
        const existingTopicIds = (
          selectDayTopicIds.all(day.id) as Array<{ topicId: string }>
        ).map((row) => row.topicId);
        const rebuildDayTopics =
          existingTopicIds.length !== desiredTopicIds.length ||
          existingTopicIds.some(
            (topicId, index) => topicId !== desiredTopicIds[index],
          );
        if (rebuildDayTopics) {
          connection.sqlite
            .prepare("DELETE FROM curriculum_day_topics WHERE day_id = ?")
            .run(day.id);
        }

        day.topics.forEach((topic, orderIndex) => {
          topicIds.add(topic.id);
          const description = topic.prompts.join(" · ");
          const existingTopicRow = selectTopicRow.get(topic.id) as
            | { slug: string; title: string; description: string | null }
            | undefined;
          if (
            !existingTopicRow ||
            existingTopicRow.slug !== topic.id ||
            existingTopicRow.title !== topic.title ||
            existingTopicRow.description !== description
          ) {
            upsertTopicRow.run(
              topic.id,
              topic.id,
              topic.title,
              description,
              now,
              now,
            );
          }
          if (rebuildDayTopics) {
            insertDayTopic.run(day.id, topic.id, orderIndex);
          }
        });

        day.questions.forEach((question, orderIndex) => {
          result.questions += 1;
          const keyPointsJson = JSON.stringify(question.evaluationPoints);
          const existingQuestionRow = selectQuestionRow.get(question.id) as
            | {
                dayId: string;
                kind: string;
                prompt: string;
                expectedSeconds: number | null;
                orderIndex: number;
                referenceAnswer: string | null;
                keyPointsJson: string;
                revealAfterAttempts: number;
                active: number;
              }
            | undefined;
          if (
            !existingQuestionRow ||
            existingQuestionRow.dayId !== day.id ||
            existingQuestionRow.kind !== question.kind ||
            existingQuestionRow.prompt !== question.prompt ||
            existingQuestionRow.expectedSeconds !== null ||
            existingQuestionRow.orderIndex !== orderIndex ||
            existingQuestionRow.referenceAnswer !== question.referenceAnswer ||
            existingQuestionRow.keyPointsJson !== keyPointsJson ||
            existingQuestionRow.revealAfterAttempts !== 2 ||
            existingQuestionRow.active !== 1
          ) {
            upsertQuestionRow.run(
              question.id,
              day.id,
              question.kind,
              question.prompt,
              null,
              orderIndex,
              question.referenceAnswer,
              keyPointsJson,
              now,
              now,
            );
          }
        });

        // Preserve referenced history while hiding authoring entries removed from a later seed.
        if (day.questions.length) {
          const placeholders = day.questions.map(() => "?").join(", ");
          connection.sqlite
            .prepare(
              `UPDATE questions SET active = 0
               WHERE day_id = ? AND active = 1 AND id NOT IN (${placeholders})`,
            )
            .run(day.id, ...day.questions.map((question) => question.id));
        } else {
          connection.sqlite
            .prepare(
              "UPDATE questions SET active = 0 WHERE day_id = ? AND active = 1",
            )
            .run(day.id);
        }

        day.exercises.forEach((exercise) => {
          result.exercises += 1;
          const constraintsJson = JSON.stringify(exercise.constraints);
          const criteriaJson = JSON.stringify(exercise.criteria);
          const existingExerciseRow = selectExerciseRow.get(exercise.id) as
            | {
                dayId: string;
                slug: string;
                title: string;
                prompt: string;
                difficulty: string;
                estimatedMinutes: number;
                workspacePath: string;
                constraintsJson: string;
                criteriaJson: string;
                allowedOperationsJson: string;
                active: number;
              }
            | undefined;
          if (
            !existingExerciseRow ||
            existingExerciseRow.dayId !== day.id ||
            existingExerciseRow.slug !== exercise.id ||
            existingExerciseRow.title !== exercise.title ||
            existingExerciseRow.prompt !== exercise.brief ||
            existingExerciseRow.difficulty !== exercise.difficulty ||
            existingExerciseRow.estimatedMinutes !==
              exercise.estimatedMinutes ||
            existingExerciseRow.workspacePath !== exercise.workspacePath ||
            existingExerciseRow.constraintsJson !== constraintsJson ||
            existingExerciseRow.criteriaJson !== criteriaJson ||
            existingExerciseRow.allowedOperationsJson !==
              exerciseAllowedOperations ||
            existingExerciseRow.active !== 1
          ) {
            upsertExerciseRow.run(
              exercise.id,
              day.id,
              exercise.id,
              exercise.title,
              exercise.brief,
              exercise.difficulty,
              exercise.estimatedMinutes,
              exercise.workspacePath,
              constraintsJson,
              criteriaJson,
              exerciseAllowedOperations,
              now,
              now,
            );
          }
        });

        if (day.exercises.length) {
          const placeholders = day.exercises.map(() => "?").join(", ");
          connection.sqlite
            .prepare(
              `UPDATE exercises SET active = 0
               WHERE day_id = ? AND active = 1 AND id NOT IN (${placeholders})`,
            )
            .run(day.id, ...day.exercises.map((exercise) => exercise.id));
        } else {
          connection.sqlite
            .prepare(
              "UPDATE exercises SET active = 0 WHERE day_id = ? AND active = 1",
            )
            .run(day.id);
        }
      }
    }

    connection.sqlite
      .prepare(
        `INSERT OR IGNORE INTO application_settings (key, value_json, updated_at)
         VALUES ('curriculum.activeWeekId', ?, ?)`,
      )
      .run(JSON.stringify(weeks[0]?.id ?? null), now);
  });

  result.topics = topicIds.size;
  Object.assign(result, seedVersionedCurriculum(connection));
  return result;
}

export const seedDatabase = seedCurriculum;
