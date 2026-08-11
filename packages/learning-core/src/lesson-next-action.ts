export type LessonProgressionStatus =
  "completed" | "in_progress" | "available" | "locked";

export interface LessonProgressionItem {
  readonly lessonId: string;
  readonly status: LessonProgressionStatus;
  /** Only an active session may be resumed. */
  readonly sessionId: string | null;
}

export type LessonNextAction =
  | {
      readonly type: "start";
      readonly lessonId: string;
    }
  | {
      readonly type: "resume";
      readonly lessonId: string;
      readonly sessionId: string;
    }
  | null;

/**
 * Selects a Course-level lesson action without relying on collection order.
 * Multiple current or available lessons are ambiguous and therefore produce
 * no action. Activity selection remains the Learning Kernel's responsibility.
 */
export function selectLessonNextAction(
  progress: readonly LessonProgressionItem[],
): LessonNextAction {
  const current = progress.filter((item) => item.status === "in_progress");
  if (current.length > 0) {
    if (current.length !== 1) return null;
    const lesson = current[0];
    if (!lesson?.sessionId) return null;
    return {
      type: "resume",
      lessonId: lesson.lessonId,
      sessionId: lesson.sessionId,
    };
  }

  const available = progress.filter((item) => item.status === "available");
  if (available.length !== 1) return null;
  const lesson = available[0];
  if (!lesson || lesson.sessionId !== null) return null;
  return { type: "start", lessonId: lesson.lessonId };
}
