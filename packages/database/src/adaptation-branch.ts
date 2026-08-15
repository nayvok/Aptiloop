import { createHash } from "node:crypto";

export function adaptationBranchIdForRevision(
  courseId: string,
  revisionId: string,
): string {
  const digest = createHash("sha256")
    .update(courseId)
    .update("\0")
    .update(revisionId)
    .update("\0local")
    .digest("hex");
  return `branch:${digest}`;
}
