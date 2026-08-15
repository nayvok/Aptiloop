import { describe, expect, it } from "vitest";

import {
  calculateCoursePackContentHash,
  canonicalJson,
  COURSE_PACK_JSON_LIMITS_V1,
  CoursePackV1Schema,
  finalizeCoursePack,
  parseStrictJson,
  StrictJsonError,
  validateCoursePackBytes,
} from "../src/index.js";
import { validCoursePack } from "./fixture.js";

const encoder = new TextEncoder();

function bytes(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function diagnosticCodes(value: Uint8Array): string[] {
  return validateCoursePackBytes(value).report.diagnostics.map(
    (diagnostic) => diagnostic.code,
  );
}

function finalizedWithProvenanceNote(note: string): Uint8Array {
  const raw = structuredClone(validCoursePack());
  raw.course.provenance.notes = note;
  return bytes(finalizeCoursePack(CoursePackV1Schema.parse(raw)));
}

describe("Course Pack V1", () => {
  it("validates, canonicalizes, and hashes the synthetic fixture deterministically", () => {
    const pack = validCoursePack();
    const first = validateCoursePackBytes(bytes(pack));
    const second = validateCoursePackBytes(
      encoder.encode(JSON.stringify(pack, null, 2)),
    );

    expect(first.valid).toBe(true);
    expect(second.valid).toBe(true);
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.canonicalJson).toBe(first.canonicalJson);
    expect(first.preview).toMatchObject({
      courseKey: "development-kernel-basics",
      revisionKey: "development-kernel-basics/v1",
      lessonCount: 1,
      activityCount: 2,
      sourcePrivacyClasses: { public: 0, private: 0 },
    });
    expect(first.contentHash).toBe(pack.revision.contentHash);
    expect(calculateCoursePackContentHash(pack)).toBe(
      pack.revision.contentHash,
    );
  });

  it("canonicalizes object keys without locale-sensitive ordering", () => {
    expect(canonicalJson({ z: 1, a: [true, null, "x"] })).toBe(
      '{"a":[true,null,"x"],"z":1}',
    );
  });

  it("rejects invalid UTF-8, BOMs, duplicate keys, limits, and slow parsing", () => {
    expect(diagnosticCodes(Uint8Array.of(0xff))).toContain(
      "PACK_JSON_INVALID_UTF8",
    );
    expect(
      diagnosticCodes(Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0x7d)),
    ).toContain("PACK_JSON_UTF8_BOM");
    expect(
      diagnosticCodes(encoder.encode('{"format":1,"format":2}')),
    ).toContain("PACK_JSON_DUPLICATE_KEY");

    expect(() =>
      parseStrictJson(encoder.encode("[0,1]"), {
        limits: { ...COURSE_PACK_JSON_LIMITS_V1, maxItems: 1 },
      }),
    ).toThrow(StrictJsonError);
    let tick = 0;
    expect(() =>
      parseStrictJson(encoder.encode("[]"), {
        limits: { ...COURSE_PACK_JSON_LIMITS_V1, maxParseMilliseconds: 1 },
        now: () => tick++ * 2,
      }),
    ).toThrow(/parsing exceeded/u);
  });

  it("rejects malformed JSON and unknown format versions before semantic validation", () => {
    expect(diagnosticCodes(encoder.encode('{"format":'))).toContain(
      "PACK_JSON_INVALID_JSON",
    );

    const unknownVersion = { ...validCoursePack(), formatVersion: 99 };
    const result = validateCoursePackBytes(bytes(unknownVersion));
    expect(result.valid).toBe(false);
    expect(result.preview).toBeNull();
    expect(result.report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PACK_SHAPE_INVALID",
          path: "/formatVersion",
        }),
      ]),
    );
  });

  it("rejects authority fields, secrets, active content, unsafe URLs, and paths", () => {
    const cases = [
      ["command", "npm test", "PACK_AUTHORITY_FIELD"],
      ["note", "sk-abcdefghijklmnop", "PACK_SECRET_SHAPED_VALUE"],
      ["note", "<script>alert(1)</script>", "PACK_ACTIVE_CONTENT"],
      ["note", "C:\\Users\\learner", "PACK_LOCAL_PATH_VALUE"],
      ["note", "https://127.0.0.1/private", "PACK_URL_UNSAFE"],
    ] as const;
    for (const [field, value, code] of cases) {
      const raw = { ...validCoursePack(), [field]: value };
      expect(diagnosticCodes(bytes(raw))).toContain(code);
    }
  });

  it("rejects common credential forms without echoing their values", () => {
    const slackToken = [
      "xoxb",
      "123456789012",
      "abcdefghijklmnopqrstuvwx",
    ].join("-");
    const secrets = [
      "password=hunter2",
      "passphrase: correct-horse-battery-staple",
      "api_key=abc123456789",
      "access-token: abcdefghijklmnop",
      '"client_secret":"client-secret-value"',
      "private key => private-key-value",
      slackToken,
      "AIzaSyA12345678901234567890123456789012",
      "Authorization: Basic dXNlcjpwYXNzd29yZA==",
      "https://learner:password123@example.invalid/resource",
    ];

    for (const [index, secret] of secrets.entries()) {
      const result = validateCoursePackBytes(
        finalizedWithProvenanceNote(secret),
      );
      expect(result.report.diagnostics, `secret case ${index}`).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "PACK_SECRET_SHAPED_VALUE" }),
        ]),
      );
      expect(JSON.stringify(result.report.diagnostics)).not.toContain(secret);
    }
  });

  it("does not classify ordinary credential-related prose as a secret", () => {
    const safeNotes = [
      "The lesson explains how password managers reduce credential reuse.",
      "Rotate an API key after accidental exposure.",
      "A client secret belongs in an approved credential store.",
      "The access token expires after the configured interval.",
      "Private key cryptography uses a public/private key pair.",
      "Use Basic authentication only over an authenticated transport.",
      "Basic authentication overview",
      "Password: minimum length is twelve characters.",
      "API key: rotation policy should be documented.",
    ];

    for (const [index, note] of safeNotes.entries()) {
      const result = validateCoursePackBytes(finalizedWithProvenanceNote(note));
      expect(result.valid, `safe note case ${index}`).toBe(true);
      expect(
        result.report.diagnostics.map((diagnostic) => diagnostic.code),
        `safe note case ${index}`,
      ).not.toContain("PACK_SECRET_SHAPED_VALUE");
    }
  });

  it("rejects cycles, dangling references, requirement drift, and hash drift", () => {
    const fixture = validCoursePack();
    const cyclic = structuredClone(fixture);
    cyclic.lessons[0]!.activities[0]!.prerequisiteActivityIds = [
      "recall-replay",
    ];
    expect(diagnosticCodes(bytes(cyclic))).toContain("PACK_GRAPH_CYCLE");

    const knowledgeCycle = structuredClone(fixture);
    knowledgeCycle.knowledge.nodes = [
      {
        ...knowledgeCycle.knowledge.nodes[0]!,
        knowledgeNodeId: "cycle-a",
        prerequisiteKnowledgeNodeIds: ["cycle-b"],
      },
      {
        ...knowledgeCycle.knowledge.nodes[0]!,
        knowledgeNodeId: "cycle-b",
        prerequisiteKnowledgeNodeIds: ["cycle-a"],
      },
    ];
    const finalizedKnowledgeCycle = finalizeCoursePack(
      CoursePackV1Schema.parse(knowledgeCycle),
    );
    const firstKnowledgeCycleResult = validateCoursePackBytes(
      bytes(finalizedKnowledgeCycle),
    );
    const secondKnowledgeCycleResult = validateCoursePackBytes(
      bytes(finalizedKnowledgeCycle),
    );
    expect(firstKnowledgeCycleResult.report.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PACK_KNOWLEDGE_GRAPH_CYCLE",
          path: "/knowledge/nodes/1/prerequisiteKnowledgeNodeIds/0",
          entityId: "cycle-b",
        }),
      ]),
    );
    expect(secondKnowledgeCycleResult.report.diagnostics).toEqual(
      firstKnowledgeCycleResult.report.diagnostics,
    );

    const relatedCycle = structuredClone(fixture);
    relatedCycle.knowledge.nodes = [
      {
        ...relatedCycle.knowledge.nodes[0]!,
        knowledgeNodeId: "related-a",
        relatedKnowledgeNodeIds: ["related-b"],
      },
      {
        ...relatedCycle.knowledge.nodes[0]!,
        knowledgeNodeId: "related-b",
        relatedKnowledgeNodeIds: ["related-a"],
      },
    ];
    expect(
      diagnosticCodes(
        bytes(finalizeCoursePack(CoursePackV1Schema.parse(relatedCycle))),
      ),
    ).not.toContain("PACK_KNOWLEDGE_GRAPH_CYCLE");

    const dangling = structuredClone(fixture);
    dangling.lessons[0]!.activities[0]!.knowledgeNodeIds = ["missing-node"];
    expect(diagnosticCodes(bytes(dangling))).toContain(
      "PACK_KNOWLEDGE_REFERENCE_MISSING",
    );

    const drift = structuredClone(fixture);
    drift.requirements.activityTypes = ["study"];
    expect(diagnosticCodes(bytes(drift))).toContain(
      "PACK_REQUIREMENT_MISMATCH",
    );

    const hashDrift = structuredClone(fixture);
    hashDrift.course.title = "Changed title";
    expect(diagnosticCodes(bytes(hashDrift))).toContain(
      "PACK_CONTENT_HASH_MISMATCH",
    );
  });

  it("keeps installation blocked for unavailable trusted checks", () => {
    const fixture = validCoursePack();
    const exercise = structuredClone(fixture.lessons[0]!.activities[0]!);
    const raw = {
      ...fixture,
      requirements: {
        activityTypes: ["exercise", "recall", "study"],
        capabilities: [],
        environmentIds: [],
        checkIds: ["test"],
      },
      lessons: [
        {
          ...fixture.lessons[0]!,
          activities: [
            ...fixture.lessons[0]!.activities,
            {
              ...exercise,
              activityId: "exercise-replay",
              order: 2,
              type: "exercise",
              title: "Trusted exercise",
              description: "A declarative exercise reference.",
              prerequisiteActivityIds: ["recall-replay"],
              completionCriteria: [
                {
                  type: "exercise",
                  passingTestsRequired: true,
                  acceptedReviewRequired: true,
                },
              ],
              payload: {
                type: "exercise",
                exerciseId: "exercise-replay",
                acceptanceCriteria: ["Explain the result"],
                constraints: [],
                template: "export const value = 1;",
                testCommandId: "test",
                hintPolicy: "Hints do not reveal the answer.",
                reviewPolicy: "Review remains read-only.",
              },
            },
          ],
        },
      ],
    };
    const finalized = finalizeCoursePack(CoursePackV1Schema.parse(raw));
    expect(diagnosticCodes(bytes(finalized))).toContain(
      "PACK_REQUIREMENT_UNAVAILABLE",
    );
  });

  it("reports locale and provenance blockers without hiding valid preview data", () => {
    const fixture = validCoursePack();
    const raw = structuredClone(fixture);
    raw.course.availableLocales = ["en-US", "ru-RU"];
    raw.course.provenance.ownership = "unresolved";
    const result = validateCoursePackBytes(bytes(raw));
    expect(result.valid).toBe(false);
    expect(result.preview?.courseKey).toBe(fixture.course.courseKey);
    expect(result.report.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "PACK_LOCALIZATION_MISSING",
        "PACK_PROVENANCE_UNRESOLVED",
        "PACK_CONTENT_HASH_MISMATCH",
      ]),
    );
  });
});
