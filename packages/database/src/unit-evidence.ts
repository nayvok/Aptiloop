export const VERSIONED_EVIDENCE_TYPES = [
  "recall-attempt",
  "quiz-answer",
  "code-reading-attempt",
  "summary",
] as const;

export type VersionedEvidenceType = (typeof VERSIONED_EVIDENCE_TYPES)[number];

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface RecordVersionedUnitEvidenceInput {
  sessionId: string;
  unitId: string;
  evidenceType: VersionedEvidenceType;
  operationId: string;
  questionId?: string | null;
  payload: unknown;
  correctness?: number | null;
}

export interface VersionedUnitEvidenceRecord {
  id: string;
  sessionId: string;
  unitId: string;
  evidenceType: VersionedEvidenceType;
  operationId: string;
  questionId: string | null;
  payload: JsonValue;
  correctness: number | null;
  createdAt: number;
}

export interface ListVersionedUnitEvidenceFilter {
  unitId?: string;
  evidenceType?: VersionedEvidenceType;
}

export const MAX_EVIDENCE_PAYLOAD_BYTES = 50_000;
const MAX_IDENTIFIER_LENGTH = 200;

const evidenceUnitTypes: Record<VersionedEvidenceType, string> = {
  "recall-attempt": "recall",
  "quiz-answer": "quiz",
  "code-reading-attempt": "code-reading",
  summary: "summary",
};

export function expectedUnitTypeForEvidence(
  type: VersionedEvidenceType,
): string {
  if (!VERSIONED_EVIDENCE_TYPES.includes(type)) {
    throw new Error(`Unsupported versioned evidence type: ${String(type)}`);
  }
  return evidenceUnitTypes[type];
}

export function validateEvidenceIdentifier(
  value: string,
  label: string,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH
  ) {
    throw new Error(`${label} must contain 1 to 200 characters`);
  }
  return value;
}

function normalizeJsonValue(
  value: unknown,
  ancestors: Set<object>,
  path: string,
): JsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(
        `Evidence payload contains a non-finite number at ${path}`,
      );
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new Error(`Evidence payload contains a non-JSON value at ${path}`);
  }
  if (ancestors.has(value)) {
    throw new Error(
      `Evidence payload contains a circular reference at ${path}`,
    );
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((child, index) =>
        normalizeJsonValue(child, ancestors, `${path}[${index}]`),
      );
    }
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(
        `Evidence payload contains a non-plain object at ${path}`,
      );
    }
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [
          key,
          normalizeJsonValue(child, ancestors, `${path}.${key}`),
        ]),
    );
  } finally {
    ancestors.delete(value);
  }
}

export function serializeEvidencePayload(payload: unknown): {
  json: string;
  value: JsonValue;
} {
  const value = normalizeJsonValue(payload, new Set(), "payload");
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > MAX_EVIDENCE_PAYLOAD_BYTES) {
    throw new Error(
      `Evidence payload exceeds ${MAX_EVIDENCE_PAYLOAD_BYTES} bytes`,
    );
  }
  return { json, value };
}

export function parseEvidencePayload(json: string): JsonValue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error("Invalid JSON stored in versioned unit evidence", {
      cause: error,
    });
  }
  return serializeEvidencePayload(parsed).value;
}

export function validateEvidenceCorrectness(
  correctness: number | null | undefined,
): number | null {
  if (correctness === undefined || correctness === null) return null;
  if (!Number.isFinite(correctness) || correctness < 0 || correctness > 1) {
    throw new Error("Evidence correctness must be between 0 and 1");
  }
  return correctness;
}
