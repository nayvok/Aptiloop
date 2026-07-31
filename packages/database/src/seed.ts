import { weekOneCurriculum, type CurriculumWeek } from "@dlh/curriculum";

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
    for (const week of weeks) {
      for (const day of week.days) {
        result.days += 1;
        const sources = day.topics.flatMap((topic) => topic.sources);
        connection.sqlite
          .prepare(
            `INSERT INTO curriculum_days
             (id, slug, week_number, day_number, title, summary, estimated_minutes,
              goals_json, sources_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               slug = excluded.slug, week_number = excluded.week_number, day_number = excluded.day_number,
               title = excluded.title, summary = excluded.summary,
               estimated_minutes = excluded.estimated_minutes, goals_json = excluded.goals_json,
               sources_json = excluded.sources_json, updated_at = excluded.updated_at`,
          )
          .run(
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

        connection.sqlite
          .prepare("DELETE FROM curriculum_day_topics WHERE day_id = ?")
          .run(day.id);
        // Preserve referenced history while hiding authoring entries removed from a later seed.
        connection.sqlite
          .prepare("UPDATE questions SET active = 0 WHERE day_id = ?")
          .run(day.id);
        connection.sqlite
          .prepare("UPDATE exercises SET active = 0 WHERE day_id = ?")
          .run(day.id);
        day.topics.forEach((topic, orderIndex) => {
          topicIds.add(topic.id);
          connection.sqlite
            .prepare(
              `INSERT INTO topics (id, slug, title, description, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 slug = excluded.slug, title = excluded.title,
                 description = excluded.description, updated_at = excluded.updated_at`,
            )
            .run(
              topic.id,
              topic.id,
              topic.title,
              topic.prompts.join(" · "),
              now,
              now,
            );
          connection.sqlite
            .prepare(
              "INSERT INTO curriculum_day_topics (day_id, topic_id, order_index) VALUES (?, ?, ?)",
            )
            .run(day.id, topic.id, orderIndex);
        });

        day.questions.forEach((question, orderIndex) => {
          result.questions += 1;
          connection.sqlite
            .prepare(
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
            )
            .run(
              question.id,
              day.id,
              question.kind,
              question.prompt,
              null,
              orderIndex,
              question.referenceAnswer,
              JSON.stringify(question.evaluationPoints),
              now,
              now,
            );
        });

        day.exercises.forEach((exercise) => {
          result.exercises += 1;
          connection.sqlite
            .prepare(
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
            )
            .run(
              exercise.id,
              day.id,
              exercise.id,
              exercise.title,
              exercise.brief,
              exercise.difficulty,
              exercise.estimatedMinutes,
              exercise.workspacePath,
              JSON.stringify(exercise.constraints),
              JSON.stringify(exercise.criteria),
              JSON.stringify(["exercise:test", "exercise:typecheck"]),
              now,
              now,
            );
        });
      }
    }

    const provider = connection.sqlite.prepare(
      `INSERT OR IGNORE INTO provider_configurations
       (provider_id, enabled, endpoint, teacher_model_id, reviewer_model_id,
        interviewer_model_id, options_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '{}', ?)`,
    );
    provider.run(
      "mock",
      1,
      null,
      "mock-teacher",
      "mock-reviewer",
      "mock-interviewer",
      now,
    );
    provider.run("codex", 0, null, null, null, null, now);
    provider.run("opencode", 0, "http://127.0.0.1:4096", null, null, null, now);
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
