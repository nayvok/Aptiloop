import { z } from "zod";

export const MasteryDimensionSchema = z.enum([
  "understanding",
  "explanation",
  "codeReading",
  "implementation",
  "debugging",
  "interview",
]);
export type MasteryDimension = z.infer<typeof MasteryDimensionSchema>;

export const MasterySuggestionSchema = z
  .object({
    topicId: z.string().min(1),
    dimension: MasteryDimensionSchema,
    delta: z.number().min(-2).max(2),
    reason: z.string().min(1),
    evidence: z.string().min(1),
  })
  .strict();
export type MasterySuggestion = z.infer<typeof MasterySuggestionSchema>;

export const ReviewFindingSchema = z
  .object({
    severity: z.enum(["info", "warning", "error"]),
    category: z.enum([
      "correctness",
      "types",
      "edge_case",
      "readability",
      "requirements",
      "tests",
    ]),
    file: z.string().min(1).optional(),
    line: z.number().int().positive().optional(),
    message: z.string().min(1),
    hintLevel: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
    ]),
  })
  .strict();
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const ReviewResultSchema = z
  .object({
    status: z.enum(["passed", "changes_requested"]),
    summary: z.string().min(1),
    findings: z.array(ReviewFindingSchema),
    strengths: z.array(z.string().min(1)),
    suggestedMasteryChanges: z.array(MasterySuggestionSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === "passed" &&
      value.findings.some((finding) => finding.severity === "error")
    ) {
      context.addIssue({
        code: "custom",
        message: "A passed review cannot contain error findings",
        path: ["findings"],
      });
    }
    if (value.status === "changes_requested" && value.findings.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Requested changes require at least one finding",
        path: ["findings"],
      });
    }
  });
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
