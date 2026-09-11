import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateCoursePackBytes } from "@aptiloop/course-authoring-kit";
import { describe, expect, it } from "vitest";

const fixturesDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures/course-packs",
);

const EXPECTED_ACTIVITY_TYPES = [
  "briefing",
  "checkpoint",
  "code-reading",
  "interview",
  "quiz",
  "recall",
  "spaced-review",
  "study",
  "summary",
  "teacher-dialogue",
];

describe("Aptiloop Dev Tour course pack presets", () => {
  for (const locale of ["en", "ru"] as const) {
    it(`keeps the ${locale} preset importable with every supported activity type`, () => {
      const source = readFileSync(
        path.join(
          fixturesDirectory,
          `aptiloop-dev-tour-${locale}.course-pack.json`,
        ),
        "utf8",
      );
      const result = validateCoursePackBytes(new TextEncoder().encode(source));

      expect(result.report.diagnostics).toEqual([]);
      expect(result.valid).toBe(true);
      expect(result.pack).not.toBeNull();
      expect(result.pack?.course.primaryLocale).toBe(locale);
      expect(result.pack?.course.availableLocales).toEqual([locale]);
      expect(result.pack?.course.provenance.contentStatus).toBe(
        "development-fixture",
      );
      expect(result.pack?.requirements.activityTypes).toEqual(
        EXPECTED_ACTIVITY_TYPES,
      );
    });
  }

  it("uses distinct courses per primary locale", () => {
    const packs = (["en", "ru"] as const).map((locale) => {
      const source = readFileSync(
        path.join(
          fixturesDirectory,
          `aptiloop-dev-tour-${locale}.course-pack.json`,
        ),
        "utf8",
      );
      return validateCoursePackBytes(new TextEncoder().encode(source)).pack;
    });
    const courseKeys = packs.map((pack) => pack?.course.courseKey);
    expect(new Set(courseKeys).size).toBe(2);
    expect(courseKeys).toEqual([
      "aptiloop-dev-tour-en",
      "aptiloop-dev-tour-ru",
    ]);
  });
});
