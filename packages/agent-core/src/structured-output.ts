import { type ZodType, type ZodError } from "zod";

import { ReviewResultSchema, type ReviewResult } from "@aptiloop/shared";

export interface RepairRequest {
  readonly raw: string;
  readonly validationError: string;
}

export type StructuredOutputRepair = (
  request: RepairRequest,
) => Promise<string>;

export interface ParseStructuredOutputOptions {
  readonly repair?: StructuredOutputRepair;
}

export class StructuredOutputError extends Error {
  readonly raw: string;
  readonly repairedRaw: string | undefined;
  readonly validationError: string;

  constructor(raw: string, validationError: string, repairedRaw?: string) {
    super("Agent returned invalid structured output");
    this.name = "StructuredOutputError";
    this.raw = raw;
    this.repairedRaw = repairedRaw;
    this.validationError = validationError;
  }
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

function validationMessage(error: unknown): string {
  if (error instanceof SyntaxError) return error.message;
  const zodError = error as ZodError | undefined;
  if (zodError?.issues)
    return zodError.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
  return error instanceof Error ? error.message : "Unknown validation error";
}

function parseAttempt<T>(
  schema: ZodType<T>,
  raw: string,
): { readonly data?: T; readonly error?: string } {
  try {
    const parsed = schema.safeParse(extractJson(raw));
    return parsed.success
      ? { data: parsed.data }
      : { error: validationMessage(parsed.error) };
  } catch (error: unknown) {
    return { error: validationMessage(error) };
  }
}

export async function parseStructuredOutput<T>(
  schema: ZodType<T>,
  raw: string,
  options: ParseStructuredOutputOptions = {},
): Promise<T> {
  const first = parseAttempt(schema, raw);
  if (first.data !== undefined) return first.data;
  const firstError = first.error ?? "Unknown validation error";
  if (!options.repair) throw new StructuredOutputError(raw, firstError);

  const repairedRaw = await options.repair({
    raw,
    validationError: firstError,
  });
  const repaired = parseAttempt(schema, repairedRaw);
  if (repaired.data !== undefined) return repaired.data;
  throw new StructuredOutputError(
    raw,
    repaired.error ?? firstError,
    repairedRaw,
  );
}

export function parseReviewResult(
  raw: string,
  repair?: StructuredOutputRepair,
): Promise<ReviewResult> {
  return parseStructuredOutput(
    ReviewResultSchema,
    raw,
    repair ? { repair } : {},
  );
}
