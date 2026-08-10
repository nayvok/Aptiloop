import type { AgentRole, AptiloopAiRole } from "@dlh/shared";

export function toAptiloopAiRole(role: AgentRole): AptiloopAiRole {
  switch (role) {
    case "course-designer":
      return "course-designer";
    case "teacher":
    case "codex-expert":
      return "tutor";
    case "reviewer":
      return "reviewer";
    case "interviewer":
    case "curator":
    case "flashcard-generator":
    case "daily-summary":
    case "weekly-analysis":
      return "evaluator";
  }
}
