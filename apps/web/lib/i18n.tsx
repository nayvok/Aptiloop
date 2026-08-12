"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
export type UiLocale = "en-US" | "ru-RU";

export const uiLocaleStorageKey = "aptiloop:ui-locale";
const uiLocaleCookieName = "aptiloop.ui-locale";

export function isUiLocale(value: unknown): value is UiLocale {
  return value === "en-US" || value === "ru-RU";
}

const enUS = {
  "brand.name": "Aptiloop",
  "brand.tagline": "Local learning workbench",
  "a11y.skipToContent": "Skip to main content",
  "a11y.primaryNavigation": "Primary navigation",
  "a11y.mobileNavigation": "Mobile navigation",
  "a11y.breadcrumbs": "Breadcrumbs",
  "toast.notifications": "Notifications",
  "toast.close": "Close notification",
  "shell.workspace": "Workspace",
  "shell.theme.system": "System",
  "shell.theme.light": "Light",
  "shell.theme.dark": "Dark",
  "shell.theme.change": "Use {theme} theme",
  "shell.theme.current": "Theme: {theme}",
  "shell.sidebar.collapse": "Collapse sidebar",
  "shell.sidebar.expand": "Expand sidebar",
  "shell.route.course": "Course",
  "shell.route.lesson": "Lesson",
  "shell.route.studio": "Adaptive Studio",
  "nav.home": "Home",
  "nav.courses": "Courses",
  "nav.review": "Review",
  "nav.skills": "Skills",
  "nav.settings": "Settings",
  "page.home.description":
    "Continue the next deterministic learning action in your active Course.",
  "page.lesson.description":
    "Follow the saved Lesson plan and continue from the current activity.",
  "page.exercise.description":
    "Complete the trusted local practice workflow for the current Lesson.",
  "page.interview.description":
    "Set up, continue, or review a technical interview without changing mastery directly.",
  "home.loading": "Loading your learning path…",
  "home.unavailable": "Aptiloop Core is unavailable.",
  "home.noCourse.title": "No active Course",
  "home.noCourse.description":
    "Choose an existing Course, create one in Adaptive Studio, or import a validated Course Pack to begin.",
  "home.openCourses": "Open Courses",
  "home.chooseCourse": "Choose a Course",
  "home.createCourse": "Create Course",
  "home.importCoursePack": "Import Course Pack",
  "home.currentCourse": "Current Course",
  "home.switchCourse": "Switch Course",
  "home.focus.lessonProgress": "Lesson progress",
  "home.focus.time": "Time",
  "home.focus.courseProgress": "Course progress",
  "home.courseProgress": "{complete} of {total} lessons complete",
  "home.courseRoadmap": "Course roadmap",
  "courses.revisionSurface.current":
    "Current Course · Published revision {revision}",
  "courses.revisionSurface.preview":
    "Course preview · Published revision {revision}",
  "home.focus.phase": "Current phase",
  "home.focus.evidenceBasis": "Evidence basis",
  "home.revision": "Published revision {revision}",
  "home.defaultCourseDescription":
    "A finite route from understanding to independent explanation and practice.",
  "home.startError": "Could not start the lesson.",
  "home.nextAction": "Next action",
  "home.lesson": "Lesson {number}",
  "home.remaining": "{minutes} min remaining",
  "home.estimated": "About {minutes} min",
  "home.starting": "Starting…",
  "home.start": "Start lesson",
  "home.resume": "Resume lesson",
  "home.selectCourse.title": "Use this Course revision",
  "home.selectCourse.description":
    "Make this your active Course before starting or resuming its lessons.",
  "home.selectCourse.action": "Use this Course",
  "home.selectCourse.selecting": "Selecting…",
  "home.selectCourse.error": "Could not select this Course revision.",
  "home.complete": "Course complete",
  "home.phases": "Learning phases",
  "home.phase.study": "Understand",
  "home.phase.check": "Demonstrate",
  "home.phase.practice": "Practice and review",
  "home.phase.complete": "Complete",
  "home.phase.current": "Current",
  "home.phase.ready": "Ready",
  "home.phase.locked": "Locked",
  "home.phase.progress": "{complete} of {total} activities",
  "home.upcoming": "Upcoming lessons",
  "home.locked": "Prerequisites not complete",
  "home.completed": "Completed",
  "unit.type.briefing": "Briefing",
  "unit.type.study": "Study",
  "unit.type.recall": "Recall",
  "unit.type.teacherDialogue": "Tutor dialogue",
  "unit.type.quiz": "Short check",
  "unit.type.codeReading": "Code reading",
  "unit.type.exercise": "Practice exercise",
  "unit.type.review": "Solution review",
  "unit.type.interview": "Interview",
  "unit.type.summary": "Lesson summary",
  "unit.type.checkpoint": "Checkpoint",
  "unit.type.spacedReview": "Spaced review",
  "unit.status.locked": "Locked",
  "unit.status.ready": "Ready",
  "unit.status.inProgress": "In progress",
  "unit.status.completed": "Complete",
  "unit.status.skipped": "Skipped",
  "unit.depth.foundation": "Foundation",
  "unit.depth.interviewReady": "Interview-ready",
  "unit.depth.deepDive": "Deep dive",
  "source.book": "Book",
  "source.documentation": "Documentation",
  "source.video": "Video",
  "source.article": "Article",
  "source.note": "Local note",
  "source.course": "Course",
  "source.podcast": "Podcast",
  "dayPlan.title": "Lesson {order} · {title}",
  "dayPlan.meta": "{duration} · Depth: {depth}",
  "dayPlan.phases": "Learning phases",
  "dayPlan.phaseIndex": "Phase {current} of {total}",
  "dayPlan.goal": "Goal",
  "dayPlan.topics": "Topics",
  "dayPlan.outcomes": "Expected outcomes",
  "dayPlan.prerequisites": "Prerequisites",
  "dayPlan.noPrerequisites": "No prerequisites.",
  "dayPlan.outOfScope": "Outside this lesson",
  "activity.unsupported.title": "Activity unavailable",
  "activity.unsupported.description":
    "This activity type is not supported by this Aptiloop version. No progress was changed.",
  "page.courses.description":
    "Create courses by hand or import Course Packs. All content stays on your device.",
  "page.review.description":
    "Work through due evidence, corrections, the review queue, and interview practice.",
  "page.skills.description":
    "Inspect topic evidence across independent dimensions. No invented overall score.",
  "page.settings.description":
    "Local appearance, language, runtimes, and optional AI connections.",
  "locale.dialog.title": "Choose interface language",
  "locale.dialog.description":
    "This changes Aptiloop controls and accessibility names only. Course language stays independent.",
  "locale.field.label": "Interface language",
  "locale.field.description":
    "Prefilled from this browser. Nothing is saved until you confirm.",
  "locale.option.english": "English (United States)",
  "locale.option.russian": "Русский (Россия)",
  "locale.confirm": "Use this language",
  "locale.saving": "Saving…",
  "locale.saveError": "Could not save the interface language. Try again.",
  "settings.section.interface": "Interface",
  "settings.section.interfaceDescription":
    "Appearance and language are local preferences.",
  "settings.theme": "Theme",
  "settings.theme.help": "Applied immediately and saved in this browser.",
  "settings.locale": "Interface language",
  "settings.locale.help":
    "Kept as a draft until you save. Does not change Course content or its primary locale.",
  "settings.section.local": "Core & local paths",
  "settings.section.localDescription":
    "Diagnostic values owned by Aptiloop. They are never sent by this browser.",
  "settings.workspace": "Exercise workspace",
  "settings.editor": "Editor executable",
  "settings.section.ai": "AI roles",
  "settings.section.aiDescription":
    "Choose one exact reviewed connection and model, or keep AI Off. There is no Mock fallback.",
  "settings.serverPolicy": "Server-owned policy",
  "settings.aiOff": "AI Off",
  "settings.aiMixedConfiguration": "Mixed configuration",
  "settings.defaultModel": "Default model",
  "settings.model.search": "Search connections and model IDs…",
  "settings.model.noMatches": "No matching models.",
  "settings.roleOverrides": "Role overrides (advanced)",
  "settings.roleOverridesDescription":
    "Customize only the roles that need a different exact model.",
  "settings.customizeRoles": "Customize roles",
  "settings.externalDisclosure":
    "External turns require one-time disclosure approval",
  "settings.aiSaved": "AI role profiles saved",
  "settings.aiSaveError": "Could not save AI role profiles",
  "settings.saveAi": "Save AI roles",
  "settings.saving": "Saving…",
  "settings.section.connections": "Connections",
  "settings.section.connectionsDescription":
    "Readiness is observed and time-scoped. Credentials stay in provider-owned storage.",
  "settings.connection.add": "Add connection",
  "settings.connection.details": "Details",
  "settings.connection.legacyReadOnly":
    "This legacy connection exposes read-only diagnostics but has no safe credential-management metadata. Add a managed connection to sign in or replace credentials.",
  "settings.connection.addManaged": "Add managed connection",
  "settings.connection.cancelAdd": "Cancel",
  "settings.connection.provider": "Provider",
  "settings.connection.name": "Connection name",
  "settings.connection.apiKey": "{label}",
  "settings.connection.apiKeyDefault": "API key",
  "settings.connection.secretHelp":
    "Stored only in Aptiloop's local credential file and never returned to the browser.",
  "settings.connection.subscriptionHelp":
    "Create the connection, then complete the provider-owned subscription sign-in.",
  "settings.connection.recommendation.overall":
    "Recommended overall: OpenAI subscription for strong general quality without separate API billing.",
  "settings.connection.recommendation.free":
    "Recommended free starting point: OpenCode Zen offers reviewed free model IDs; provider limits may change.",
  "settings.connection.recommendation.private":
    "Recommended for privacy: Ollama keeps model traffic on this computer.",
  "settings.connection.baseUrl": "Local OpenAI-compatible URL",
  "settings.connection.loopbackOnly":
    "Only loopback HTTP endpoints ending in /v1 are accepted.",
  "settings.connection.externalBaseUrl": "External OpenAI-compatible HTTPS URL",
  "settings.connection.publicHttpsOnly":
    "Only public HTTPS hostnames on port 443 with a path ending in /v1 are accepted. External turns still require disclosure approval.",
  "settings.connection.modelIds": "Exact model IDs",
  "settings.connection.addError": "Could not add the connection",
  "settings.connection.adding": "Adding…",
  "settings.connection.addConfirm": "Add connection",
  "settings.connection.newApiKey": "New API key",
  "settings.connection.saveKey": "Save key",
  "settings.connection.replaceKey": "Replace key",
  "settings.connection.setKey": "Set key",
  "settings.connection.signIn": "Sign in",
  "settings.connection.enable": "Enable",
  "settings.connection.disable": "Disable",
  "settings.connection.actionError": "Connection action failed",
  "settings.connection.signingIn": "Starting provider sign-in…",
  "settings.connection.openSignIn": "Open provider sign-in",
  "settings.connection.deviceCode": "Use code {code}.",
  "settings.connection.chooseOption": "Choose an option",
  "settings.connection.continue": "Continue",
  "settings.connection.signInComplete": "Subscription connected",
  "settings.connection.signInFailed": "Provider sign-in failed",
  "settings.connection.cancelSignIn": "Cancel sign-in",
  "settings.external": "External",
  "settings.localDevelopment": "Local development",
  "settings.models": "{count} models",
  "settings.developerDiagnostics": "Developer diagnostics",
  "settings.saved": "Interface language saved in this browser",
  "settings.saveError": "Could not save settings",
  "settings.localOnly":
    "Theme saves immediately. Language changes require Save and stay in this browser.",
  "settings.localStorageUnavailable":
    "Browser storage is unavailable. The language draft cannot be saved; your current language is unchanged.",
  "settings.locale.unsaved": "Interface language has unsaved changes.",
  "settings.save": "Save language",
  "settings.cancel": "Cancel language changes",
  "settings.status.off": "Off",
  "settings.status.starting": "Starting",
  "settings.status.connected": "Connected",
  "query.failed": "Could not load data",
  "query.offline": "You're offline",
  "query.offlineDescription":
    "This browser reports that it is offline. Reconnect to the network, then try again.",
  "query.technicalDetails": "Technical details",
  "query.technical.httpStatus": "HTTP status: {status}",
  "query.technical.diagnosticId": "Diagnostic ID: {diagnosticId}",
  "query.technical.code": "Code: {code}",
  "failure.operation.session.load": "This lesson could not be loaded.",
  "failure.operation.session.action":
    "The lesson change could not be saved. Try again.",
  "failure.operation.exercise.load": "This exercise could not be loaded.",
  "failure.operation.exercise.action":
    "The exercise action did not complete. Try again.",
  "failure.operation.settingsAiSave":
    "AI role settings could not be saved. Try again.",
  "failure.operation.courseCreate":
    "The local Course draft could not be created. Try again.",
  "failure.operation.courseInstructionsDownload":
    "The authoring instructions could not be downloaded. Try again.",
  "failure.operation.studioLoad": "Curriculum Studio could not be loaded.",
  "failure.operation.studioAction":
    "The Studio action did not complete. Try again.",
  "ai.failure.disabled": "AI is off for this role.",
  "ai.failure.connectionNotFound": "The selected AI connection was not found.",
  "ai.failure.connectionDisabled": "The selected AI connection is disabled.",
  "ai.failure.authenticationRequired":
    "The selected AI connection needs authentication.",
  "ai.failure.misconfigured": "The selected AI connection is not configured.",
  "ai.failure.providerUnavailable": "The selected AI provider is unavailable.",
  "ai.failure.modelUnavailable": "The selected AI model is unavailable.",
  "ai.failure.capabilityUnknown":
    "The selected model's capabilities have not been verified.",
  "ai.failure.capabilityMissing":
    "The selected model does not support this operation.",
  "ai.failure.toolPolicyUnavailable":
    "The required AI tool policy is unavailable.",
  "ai.failure.disclosureRequired":
    "Review and approve the external AI disclosure to continue.",
  "ai.failure.disclosureMismatch":
    "The AI disclosure no longer matches this operation. Review it again.",
  "ai.failure.invalidOutput": "The AI response could not be safely used.",
  "ai.failure.budgetExceeded": "The AI operation exceeded its allowed budget.",
  "ai.failure.cancelled": "The AI operation was cancelled.",
  "ai.failure.timeout": "The AI operation timed out. Try again.",
  "ai.failure.providerError":
    "The AI provider could not complete the operation.",
  "routeBoundary.retry": "Try again",
  "routeBoundary.back": "Go back",
  "routeBoundary.home": "Go to Home",
  "routeBoundary.technicalDetails": "Technical details",
  "routeBoundary.error.eyebrow": "Recovery",
  "routeBoundary.error.title": "This page could not be shown",
  "routeBoundary.error.description":
    "Aptiloop could not finish loading this page. Your saved learning data was not changed. Try again, return to the previous page, or go Home.",
  "routeBoundary.error.reference": "Error reference: {digest}",
  "routeBoundary.notFound.eyebrow": "Page not found",
  "routeBoundary.notFound.title": "This page is not available",
  "routeBoundary.notFound.description":
    "The link may be outdated, or the page may have moved. Go back or return Home to continue learning.",
  "ui.developerTools.title": "Developer tools",
  "ui.developerTools.description":
    "Diagnostics and manual tools for checking the provider lifecycle. They are not part of the primary learning path.",
  "ui.developerTools.playgroundTitle": "Agent Playground",
  "ui.developerTools.playgroundDescription":
    "Manual conversation with a selected role and model, with visible tool events. Reviewer remains read-only and cannot apply changes.",
  "ui.developerTools.openPlayground": "Open Playground",
  "ui.developerTools.boundaryNote":
    "No embedded terminal UI or arbitrary shell access is available here. Executable commands are selected only by the server allowlist.",
  "ui.messageScroller.toLast": "Go to latest message",
  "ui.messageScroller.toStart": "Go to beginning",
  "ui.close": "Close",
  "settings.status.degraded": "Needs canary",
  "settings.status.authentication": "Authentication required",
  "settings.status.unavailable": "Unavailable",
  "settings.status.misconfigured": "Configuration required",
  "settings.status.error": "Error",
  "settings.savedRoleSummary": "Saved: {connection} · {model}",
  "settings.unsavedWarning":
    "You have unsaved interface or role assignments. Save before leaving this page.",
  "settings.connection.requirements":
    "Credentials stay in local provider storage and are never returned to this page.",
  "settings.connection.emptyTitle": "No connections yet",
  "settings.connection.emptyDescription":
    "Add a provider connection to observe readiness and exact available model IDs.",
  "settings.connection.providerKind": "Provider type",
  "settings.connection.scope": "Traffic scope",
  "settings.connection.modelsObserved": "Available models observed",
  "settings.connection.lastChecked": "Last readiness check",
  "settings.connection.notChecked": "Not checked yet",
  "settings.connection.endpoint": "Endpoint",
  "settings.connection.credentialState": "Credential state",
  "settings.connection.credentialStored": "Stored",
  "settings.connection.credentialMissing": "Required",
  "settings.connection.loginUnavailable":
    "Provider sign-in status is unavailable. Start sign-in again to retry.",
  "settings.connection.answering": "Sending response…",
  "settings.connection.loginRunning": "Waiting for the provider…",
  "settings.connection.progressUpdate": "Provider sign-in is in progress.",
  "settings.connection.promptText": "Enter the value requested by the provider",
  "settings.connection.promptSecret":
    "Enter the secret requested by the provider",
  "settings.connection.promptSelect": "Choose a provider sign-in option",
  "settings.connection.promptCode": "Enter the provider sign-in code",
  "settings.connection.promptGithubDomain": "GitHub Enterprise domain",
  "settings.connection.promptGithubDomainDescription":
    "Optional. Leave blank to sign in with github.com.",
  "settings.connection.promptGithubDomainPlaceholder": "company.ghe.com",
  "settings.connection.promptGithubDomainUnsupported":
    "GitHub Enterprise domains are not supported yet. Leave this field blank to use github.com.",
  "settings.connection.promptOpenAiLoginMethod": "OpenAI Codex sign-in method",
  "settings.connection.promptOptionBrowser": "Browser sign-in (recommended)",
  "settings.connection.promptOptionDeviceCode": "Device code sign-in",
  "settings.connection.updating": "Updating…",
  "settings.connection.cancelling": "Cancelling…",
  "settings.connection.loginCancelled":
    "Provider sign-in was cancelled. The connection was not authorized.",
  "ui.developerTools.compatibilityBadge": "Compatibility surface",
  "ui.developerTools.boundaryTitle": "Deliberate execution boundaries",
  "ui.developerTools.executionBoundary": "Command execution",
  "ui.developerTools.serverAllowlist": "Server allowlist only",
  "ui.developerTools.reviewerBoundary": "Reviewer role",
  "ui.developerTools.readOnly": "Read-only · cannot apply changes",
  "role.courseDesigner": "Course Designer",
  "role.courseDesigner.help":
    "Draft-only proposals. Apply and Publish remain separate actions.",
  "role.tutor": "Tutor",
  "role.tutor.help": "Learner-safe explanation and Socratic guidance.",
  "role.evaluator": "Evaluator",
  "role.evaluator.help":
    "Bounded interview and evaluation output; no mastery writes.",
  "role.reviewer": "Reviewer",
  "role.reviewer.help":
    "Evidence-only review with no patch or local file authority.",
  "provider.checking": "Checking AI status…",
  "provider.statusUnavailable": "AI status unavailable",
  "provider.statusDetails": "AI status: open details",
  "provider.ready": "AI ready",
  "provider.off": "AI Off",
  "provider.needsAttention": "AI needs attention",
  "provider.title": "Optional AI assistance",
  "provider.rolesReady": "{ready} of {total} configured AI roles ready",
  "provider.unavailable": "Unavailable",
  "provider.noModel": "No model",
  "provider.problem": "One or more connections need configuration.",
  "provider.recoverConnections": "Review connections",
  "provider.fullDiagnostics": "Open developer diagnostics",
  "query.loadingSettings": "Loading settings…",
  "query.settingsUnavailable": "Settings are unavailable",
  "query.retry": "Try again",
  "chat.page.title": "Agent diagnostic",
  "chat.page.description":
    "An optional, bounded conversation for checking reasoning or selected evidence. Courses and lessons remain the primary learning path.",
  "chat.error.response": "Could not get a response.",
  "chat.status.cancelled": "Response stopped.",
  "chat.status.loading": "Loading conversation…",
  "chat.label.you": "You",
  "chat.role.teacher": "Tutor",
  "chat.role.reviewer": "Solution reviewer",
  "chat.role.interviewer": "Interviewer",
  "chat.role.curator": "Learning curator",
  "chat.role.codexExpert": "Architecture expert",
  "chat.error.prepare":
    "Could not prepare the request. Your message is ready to retry.",
  "chat.error.send":
    "Could not send the request. Your message is ready to retry.",
  "chat.error.responseDetail":
    "Could not get a response. Your message is ready to retry.",
  "chat.error.emptyResponse": "The agent completed the response without text.",
  "chat.a11y.roleSelector": "Agent role",
  "chat.a11y.transcript": "Agent conversation transcript",
  "chat.error.history": "Conversation history is temporarily unavailable.",
  "chat.error.settings": "Provider settings are temporarily unavailable.",
  "chat.error.recovery":
    "Pending external-data approval could not be checked. Nothing was sent.",
  "chat.error.cancelDisclosure":
    "The pending external-data approval could not be cancelled. Nothing was sent; try again.",
  "chat.error.dataUnavailable": "Agent data is temporarily unavailable.",
  "chat.retry": "Try again",
  "chat.status.generating": "Agent is preparing a response",
  "chat.status.failed": "No response received",
  "chat.status.ready": "Response ready",
  "chat.empty.title": "Start by writing your question or answer",
  "chat.empty.description":
    "The agent will not write a practice solution for you. Solution review works only with a committed diff.",
  "chat.empty.reloadLimitation":
    "Reload does not restore an unsent draft or a response in progress.",
  "chat.a11y.typing": "Agent is typing",
  "chat.composer.label": "Message to the agent",
  "chat.composer.placeholder": "Write your answer or ask a follow-up question…",
  "chat.composer.stop": "Stop response",
  "chat.composer.send": "Send",
  "chat.composer.configureAi": "Configure AI",
  "chat.composer.unavailablePlaceholder":
    "Configure an available provider and model in Settings to use this diagnostic.",
  "chat.composer.context": "Conversation context: {context}",
  "chat.tools.title": "Tool events ({count})",
  "chat.tools.boundary": "Read-only activity",
  "chat.disclosure.title": "Send data to an external AI?",
  "chat.disclosure.description":
    "Permission applies once and only to the specified request.",
  "chat.disclosure.destination": "Recipient",
  "chat.disclosure.data": "Data",
  "chat.disclosure.payload": "{categories} · {bytes} bytes",
  "chat.disclosure.exclusions": "Not sent",
  "chat.disclosure.cancel": "Do not send",
  "chat.disclosure.approve": "Allow once",
  "review.view.due": "Due",
  "review.view.mistakes": "Corrections",
  "review.view.cards": "Review queue",
  "review.view.interviews": "Interviews",
  "review.empty.title": "Nothing is due yet",
  "review.empty.description":
    "No review is due now. Future and historical items remain visible in Review queue.",
  "review.goToCourses": "Browse Courses",
  "review.viewDescription.due":
    "Pending review items whose scheduled time has arrived, ordered by due date.",
  "review.viewDescription.mistakes":
    "Open corrections explain the error family, evidence count, and next deterministic correction.",
  "review.viewDescription.cards":
    "The full deterministic review queue, including completed, dismissed, and superseded history.",
  "review.viewDescription.interviews":
    "Run structured interview practice and inspect saved interview observations.",
  "review.dueCount": "Due now: {count}",
  "review.actionUnavailable":
    "This review is scheduled, but a safe review activity is not available yet. Aptiloop will not reopen the source lesson as a substitute.",
  "skills.loading": "Loading skills…",
  "skills.unavailable": "Skills are unavailable",
  "skills.empty.title": "No recorded skill evidence yet",
  "skills.empty.description":
    "Complete an activity that records evidence. Skills never infer mastery from page visits.",
  "skills.topic": "Topic",
  "skills.evidence": "Evidence",
  "skills.evidenceCount": "Evidence records: {count}",
  "skills.reviewDue": "Review due",
  "skills.level": "{value} of 5",
  "skills.scaleDescription":
    "Each topic keeps six evidence-backed dimensions separate on a 0–5 scale.",
  "skills.dimension.understanding": "Understanding",
  "skills.dimension.explanation": "Explanation",
  "skills.dimension.codeReading": "Code reading",
  "skills.dimension.implementation": "Implementation",
  "skills.dimension.debugging": "Debugging",
  "skills.dimension.interview": "Interview",
  "mistakes.loading": "Loading corrections…",
  "mistakes.unavailable": "Corrections are unavailable",
  "mistakes.empty.title": "No corrections recorded yet",
  "mistakes.empty.description":
    "Evidence-producing activities can create deterministic corrections and review dates.",
  "mistakes.repeated": "Repeated",
  "mistakes.previous": "Error family",
  "mistakes.correction": "Next correction",
  "mistakes.occurrences": "{count} recorded occurrences",
  "mistakes.correctThroughReview":
    "Complete the scheduled correction activity; the deterministic kernel will evaluate new evidence.",
  "mistakes.dueDate": "Due {date}",
  "mistakes.whyDue": "Why it is due",
  "mistakes.evidenceBasis": "Evidence basis",
  "cards.loading": "Loading the review queue…",
  "cards.unavailable": "The review queue is unavailable",
  "cards.empty.title": "No review items yet",
  "cards.empty.description":
    "Deterministic review items appear after evidence-producing activities.",
  "cards.status.pending": "Pending",
  "cards.status.completed": "Completed",
  "cards.status.dismissed": "Dismissed",
  "cards.status.superseded": "Superseded",
  "cards.topic": "Knowledge node",
  "cards.reviewReason": "Review reason",
  "cards.reviewDetail": "{dimension} · {reason}",
  "cards.dueAt": "Due {date}",
  "cards.dimensionValue": "{dimension} dimension",
  "cards.evidenceBasis": "Evidence basis",
  "cards.sourceSession": "Source session {session}",
  "cards.reason.mistake": "A recorded mistake scheduled this correction.",
  "cards.reason.lowMastery":
    "Existing evidence is below the deterministic review threshold.",
  "cards.activity.recall": "Recall evidence",
  "cards.activity.correction": "Correction evidence",
  "cards.dismiss": "Dismiss review item",
  "cards.saveError": "Could not dismiss the review item.",
  "session.error.unknown": "Unknown error",
  "session.loading": "Loading lesson…",
  "session.empty.title": "No active lesson",
  "session.empty.description":
    "Open Home and start an available lesson. Saved progress will appear here.",
  "session.openHome": "Open Home",
  "session.error.noActivities": "The lesson snapshot contains no activities.",
  "session.error.noProgress": "Current activity progress is missing.",
  "session.close": "Close",
  "session.ready.description":
    "This activity is ready. Starting is persisted, so the lesson resumes here after a restart.",
  "session.starting": "Starting…",
  "session.startActivity": "Start activity",
  "session.locked": "Complete the previous required activity first.",
  "session.lessonTitle": "Lesson {order} · {title}",
  "session.phaseProgress":
    "Phase {phase} of {phaseTotal} · {name} · Activity {activity} of {activityTotal}",
  "session.lessonComplete": "Lesson complete",
  "session.phaseRemaining": "Remaining in phase: {duration}",
  "session.plan": "Lesson steps",
  "session.continueLater": "Continue later",
  "session.progress": "Lesson progress",
  "session.transition.complete": "Phase {phase} of {total} complete",
  "session.transition.title": "Next: {name}",
  "session.transition.covered": "You covered:",
  "session.transition.next": "Next phase",
  "session.transition.meta": "{name} · {count} activities · {duration}",
  "session.transition.continue": "Continue now",
  "session.transition.back": "Return later",
  "session.transition.saved":
    "Progress is saved. The lesson resumes from this phase.",
  "session.checklist.title": "What to do",
  "session.checklist.help": "Check each item after you complete it.",
  "session.checklist.requiredHelp":
    " Required items must be checked before completion.",
  "session.checklist.required": "required",
  "session.checklist.count": "Checked {checked} of {total}",
  "session.briefing.topics": "Today’s topics",
  "session.briefing.topicsEmpty": "Topics will appear in the lesson plan.",
  "session.briefing.outcomes": "After this lesson",
  "session.briefing.outcomesEmpty": "Outcomes will appear in the lesson plan.",
  "session.briefing.level": "Depth",
  "session.briefing.levelDescription":
    "Understand the mechanism, explain it independently, identify common errors, and write a small example.",
  "session.briefing.scope": "Not covered",
  "session.briefing.scopeEmpty": "Boundaries are recorded in the lesson plan.",
  "session.briefing.plan": "Plan",
  "session.activitiesCount": "{count} activities · {duration}",
  "session.briefing.skipDescription":
    "Nothing to check here. Continue when you are ready for the material.",
  "session.briefing.diagnostic": "Skip study and take the diagnostic",
  "session.briefing.opening": "Opening…",
  "session.briefing.startStudy": "Continue to study",
  "session.study.notes": "Notes",
  "session.study.placeholder": "Record the mechanism and open questions…",
  "session.study.save": "Save notes",
  "session.study.complete": "Complete study",
  "session.recall.saveAnswer": "Save answer {number}",
  "session.recall.firstAttempt":
    "Each first attempt is persisted separately and is never overwritten.",
  "session.recall.complete": "Complete recall",
  "session.recall.count":
    "Saved {saved} of {total} answers. Completion unlocks after every question has an answer.",
  "session.tutor.defaultPrompt": "Refine your explanation.",
  "session.tutor.generating": "Tutor is preparing a follow-up…",
  "session.tutor.stopped": "Tutor response stopped",
  "session.tutor.unavailable": "Tutor unavailable",
  "session.tutor.emptyResponse": "Tutor returned an empty response",
  "session.tutor.received": "Tutor response received",
  "session.tutor.task": "Tutor task",
  "session.tutor.history": "Tutor conversation history",
  "session.tutor.you": "You",
  "session.tutor.name": "Tutor",
  "session.tutor.emptyHistory":
    "No messages yet. Send a refined explanation; the Tutor will respond without revealing a reference answer.",
  "session.tutor.retry": "Try again",
  "session.tutor.followUpLabel": "Response to the Tutor follow-up",
  "session.tutor.revisionLabel": "Refined explanation",
  "session.tutor.followUpPlaceholder":
    "Answer the Tutor’s latest question in your own words…",
  "session.tutor.revisionPlaceholder":
    "Rewrite the mechanism more precisely; the Tutor will ask a follow-up…",
  "session.tutor.stop": "Stop Tutor",
  "session.tutor.complete": "Complete dialogue",
  "session.tutor.answer": "Answer follow-up",
  "session.tutor.send": "Send explanation",
  "session.quiz.invalid":
    "Quiz configuration is invalid: every question needs at least two options.",
  "session.quiz.correct": "Correct",
  "session.quiz.retryNeeded": "Review needed",
  "session.quiz.score": "Server score: {score}%. Required: {minimum}%.",
  "session.quiz.complete": "Complete check",
  "session.quiz.retryDescription":
    "The first attempt is saved. Review the material and answer again; the latest attempt controls progression.",
  "session.quiz.retry": "Retake quiz",
  "session.quiz.submitAgain": "Check again",
  "session.quiz.submit": "Check answers",
  "session.code.prediction": "Prediction",
  "session.code.explanation": "Mechanism explanation",
  "session.code.verbalFix": "Verbal correction",
  "session.code.complete": "Complete code reading",
  "session.code.save": "Save analysis",
  "session.practice.reviewCriteria": "Solution review criteria",
  "session.practice.acceptance": "Acceptance criteria",
  "session.practice.constraints": "Constraints",
  "session.practice.description":
    "Edit code only in the external editor. Practice owns the diff, allowlisted checks, and read-only Reviewer.",
  "session.practice.openReview": "Open solution review",
  "session.practice.open": "Open practice",
  "session.interview.topics": "Topics",
  "session.interview.reportReady":
    "The interview report is saved. Open it, then complete the activity.",
  "session.interview.openReport": "Open report",
  "session.interview.complete": "Complete activity",
  "session.interview.open": "Open interview",
  "session.summary.prompts": "Reflection prompts",
  "session.summary.quiz": "Quiz",
  "session.summary.evidence": "Skill evidence",
  "session.summary.hints": "Hints",
  "session.summary.strengths": "What is working",
  "session.summary.noStrengths": "Not enough skill evidence yet",
  "session.summary.gaps": "What to reinforce",
  "session.summary.noGaps": "No new gaps recorded",
  "session.summary.counts":
    "Corrections added: {mistakes}. Card candidates: {cards}.",
  "session.summary.completing": "Completing…",
  "session.summary.complete": "Complete lesson",
  "session.summary.restoreError":
    "Could not restore the saved summary: {error}",
  "session.summary.retry": "Reload summary",
  "session.summary.loading": "Loading summary…",
  "session.summary.generating": "Generating summary…",
  "session.summary.generate": "Generate summary",
  "session.summary.description":
    "The summary uses only saved answers, checks, and review evidence. The browser never assigns mastery or invents evidence.",
  "session.checkpoint.confirm": "Confirm checkpoint",
  "session.spaced.topics": "Review topics",
  "session.spaced.description":
    "Review becomes available in Review after server-owned skill evidence exists.",
  "session.spaced.start": "Start server review",
  "session.sources.title": "Sources",
  "session.sources.empty": "No source is assigned to this activity yet.",
  "session.sources.own":
    "Use your own source alongside Aptiloop and check each item when you find the answer.",
  "session.sources.openEditor": "Open Course editor",
  "session.sources.primary": "Primary",
  "session.sources.additional": "Additional",
  "session.sources.focus": "Focus",
  "session.learningBrief.title": "What to learn",
  "session.learningBrief.completion": "Completion evidence",
  "session.completionEvidence.description":
    "Progress changes only after Aptiloop saves the authored evidence below.",
  "session.criteria.acknowledgement":
    "Acknowledge the activity after reviewing it",
  "session.criteria.checklist": "Required checklist items: {count}",
  "session.criteria.attempts": "Minimum attempts: {count}",
  "session.criteria.dialogue": "Minimum tutor dialogue turns: {count}",
  "session.criteria.dialogueWithRevision":
    "Minimum tutor dialogue turns: {count}; revise the answer",
  "session.criteria.score":
    "Minimum score: {score}; minimum attempts: {attempts}",
  "session.criteria.fields": "Complete the required fields: {fields}",
  "session.criteria.exercise": "Complete the practice activity",
  "session.criteria.exerciseTests": "Pass the trusted checks",
  "session.criteria.exerciseReview": "Receive an accepted read-only review",
  "session.criteria.exerciseTestsAndReview":
    "Pass the trusted checks and receive an accepted read-only review",
  "session.criteria.custom": "Satisfy Course requirement {key}",
  "session.sources.open": "Open source",
  "session.completed": "Activity complete and saved",
  "courses.status.draft": "Draft",
  "courses.status.published": "Published",
  "courses.status.archived": "Archived",
  "courses.error.validateFirst": "Validate the Course Pack first.",
  "courses.error.activeSessionPinned":
    "Return to the active lesson and finish it before removing this Course Pack. Your current session and progress remain available.",
  "courses.notice.installed":
    "Course Pack installed. Opening the learning path.",
  "courses.notice.draftSaved": "Course Pack saved as a draft.",
  "courses.notice.alreadyInstalled":
    "This exact Course Pack revision was already installed. Opening the existing learning path.",
  "courses.notice.draftAlreadySaved":
    "This Course Pack was already saved as a local draft. Opening the existing draft.",
  "courses.notice.uninstalled":
    "Course Pack removed from the active library. History was preserved.",
  "courses.notice.selected":
    "This Course revision is now current. Home will use its deterministic path and next action.",
  "courses.create.primaryPath": "Primary authoring path",
  "courses.create.title": "Create Course",
  "courses.create.description":
    "Choose how you want to begin. You can edit everything before publishing.",
  "courses.create.action": "Create Course",
  "courses.current.title": "Current Course",
  "courses.current.loading": "Loading current Course",
  "courses.current.unavailable": "Current Course is unavailable",
  "courses.current.unavailableDescription":
    "The local library is still available, but the current selection cannot be confirmed.",
  "courses.current.revision": "Published revision {revision}",
  "courses.current.revisionUnavailable": "Course revision unavailable",
  "courses.current.sessionActive": "Session in progress",
  "courses.current.none": "No current Course",
  "courses.current.noneDescription":
    "Create a Course, import a Course Pack, or make an eligible published library revision current.",
  "courses.page.title": "Courses",
  "courses.page.description":
    "Validate a declarative Course Pack before installing it. The file cannot provide commands, paths, credentials, or provider settings.",
  "courses.import.title": "Import Course Pack",
  "courses.import.description":
    "Local validation and Preview come first. Installation requires a separate explicit confirmation.",
  "courses.import.secondaryPath": "Alternative: bring an existing pack",
  "courses.import.fileLabel": "JSON file",
  "courses.import.fileDescription":
    "UTF-8 JSON, up to 1 MiB. Invalid source bytes are not stored.",
  "courses.import.validationFailed":
    "Could not validate {filename}. The selected file is still available; check it and try again.",
  "courses.import.validate": "Validate Pack",
  "courses.intake.title": "Course Pack inspection",
  "courses.intake.description":
    "This temporary server-staged result restores Preview and diagnostics without storing Pack bytes in the browser or installing anything on load.",
  "courses.intake.selectAnother": "Import another Pack",
  "courses.intake.loading": "Loading staged Course Pack inspection",
  "courses.intake.unavailable.title":
    "This staged validation is no longer available",
  "courses.intake.unavailable.description":
    "It was consumed, expired, or is unknown. Select the local file again to create a new validation.",
  "courses.intake.loadFailed.title": "Could not restore this inspection",
  "courses.intake.loadFailed.description":
    "The staged validation could not be read safely. Retry the read or select the local file again.",
  "courses.intake.retry": "Retry",
  "courses.intake.reselect": "Select file again",
  "courses.storageUnavailable.title": "Local Course storage is unavailable",
  "courses.storageUnavailable.description":
    "Preview still works, but Aptiloop cannot install this Course Pack or create a draft until local storage is available. Review Core & local paths in Settings, then retry.",
  "courses.storageUnavailable.settings": "Open Core & local paths",
  "courses.storageUnavailable.retry": "Retry storage check",
  "courses.alert.errorTitle": "Operation failed",
  "courses.alert.successTitle": "Done",
  "courses.library.title": "Local library",
  "courses.library.description":
    "All locally authored and imported Course revisions. Making one current changes Home and future sessions; pack-only Export and Remove actions stay explicit.",
  "courses.library.revisionMeta": "Revision {revision} · {locale}",
  "courses.library.revisionNumber": "Revision {revision}",
  "courses.library.details": "Technical details",
  "courses.library.courseId": "Course ID",
  "courses.library.personalRevision": "Personal adaptation",
  "courses.library.upstreamRevision": "Upstream revision",
  "courses.library.branch": "Revision branch",
  "courses.library.source": "Source",
  "courses.library.revisionId": "Revision ID",
  "courses.library.importedAt": "Imported from Course Pack {date}",
  "courses.library.localRevision": "Local authored revision",
  "courses.library.hashUnavailable": "Not available",
  "courses.library.currentHelp":
    "Home and learning sessions currently use this exact revision.",
  "courses.library.draftHelp":
    "This editable draft opens in Adaptive Studio. It cannot become current until it is explicitly published.",
  "courses.library.selectHelp":
    "Preview leaves the current Course unchanged. Make current switches Home and future sessions to this revision.",
  "courses.library.selectionUnknownHelp":
    "Current selection is unavailable, so this revision cannot be switched here right now.",
  "courses.library.notSelectableHelp":
    "This library record is not an eligible published revision for selection. Preview remains read-only.",
  "courses.library.revisions": "Revisions: {count}",
  "courses.library.loading": "Loading Course library",
  "courses.library.empty.title": "No local Courses yet",
  "courses.library.empty.description":
    "Create a Course in Adaptive Studio, or choose a JSON Course Pack above to validate provenance and requirements before installation.",
  "courses.library.filteredEmpty.title": "No matching courses",
  "courses.library.filteredEmpty.description":
    "Try another search or clear the status filter.",
  "courses.library.results": "Courses {start}–{end} of {total}",
  "courses.search.label": "Search courses",
  "courses.search.placeholder": "Search courses…",
  "courses.filter.action": "Filter",
  "courses.filter.label": "Course status",
  "courses.filter.all": "All courses",
  "courses.filter.clear": "Clear filters",
  "courses.table.course": "Course",
  "courses.table.revisionStatus": "Revision & status",
  "courses.table.progress": "Progress",
  "courses.table.actions": "Actions",
  "courses.progress.notStarted": "Not started",
  "courses.progress.inProgress": "In progress",
  "courses.progress.completed": "Completed",
  "courses.progress.neverOpened": "No learning activity yet",
  "courses.progress.lastActivity": "Last activity {date}",
  "courses.progress.label":
    "{percent}% complete, {completed} of {total} lessons",
  "courses.pagination.label": "Course pages",
  "courses.pagination.previous": "Previous page",
  "courses.pagination.next": "Next page",
  "courses.preview.empty.title": "Preview will appear here",
  "courses.preview.empty.description":
    "Installation is unavailable until the schema, references, graph, hashes, and policy gates pass validation.",
  "courses.preview.rejected": "Pack rejected",
  "courses.preview.errors": "Errors: {count}",
  "courses.preview.validated": "Validated Preview",
  "courses.preview.ready": "Ready to install",
  "courses.validation.expired.badge": "Validation expired",
  "courses.validation.expired.title": "Validation expired",
  "courses.validation.expired.description":
    "This validation can no longer be used. Select and validate the local file again before installing it or creating a draft.",
  "courses.validation.expired.revalidate": "Validate file again",
  "courses.revision": "{courseKey} · revision {revision}",
  "courses.preview.metric.lessons": "Lessons",
  "courses.preview.metric.activities": "Activities",
  "courses.preview.metric.language": "Language",
  "courses.preview.metric.sources": "Sources",
  "courses.preview.sourcesValue":
    "{publicCount} public / {privateCount} private",
  "courses.preview.contentHash": "Content hash",
  "courses.preview.requirement.activityTypes": "Activity types",
  "courses.preview.requirement.trustedChecks": "Trusted checks",
  "courses.preview.requirement.environments": "Environment contracts",
  "courses.preview.requirement.provenance": "Provenance",
  "courses.preview.noLicenseClaim": "No project license claim",
  "courses.preview.notRequired": "Not required",
  "courses.action.installAndOpen": "Install and open",
  "courses.action.openAsDraft": "Open as draft",
  "courses.confirm.description":
    "Confirm the exact revision, local destination, and consequence before continuing.",
  "courses.confirm.revision": "Revision",
  "courses.confirm.contentHash": "Content hash",
  "courses.confirm.destination": "Destination",
  "courses.confirm.consequence": "Consequence",
  "courses.confirm.install.title": "Install this immutable revision?",
  "courses.confirm.install.destination":
    "Local Course library, then the read-only learning roadmap",
  "courses.confirm.install.consequence":
    "The imported published revision is immutable and cannot be edited in place.",
  "courses.confirm.install.action": "Install immutable revision",
  "courses.confirm.draft.title": "Create this local draft?",
  "courses.confirm.draft.destination":
    "A local editable draft in Adaptive Studio",
  "courses.confirm.draft.consequence":
    "The source Pack remains unchanged; publishing is a separate explicit action.",
  "courses.confirm.draft.action": "Create local draft",
  "courses.commitFailed.title": "The local change was not completed",
  "courses.commitFailed.description":
    "The request was rejected or Aptiloop could not confirm that it completed. The validation and confirmation are still open. Retry when ready; repeated requests are safe.",
  "courses.commitFailed.retry": "Retry local change",
  "courses.action.open": "Open",
  "courses.action.continue": "Continue",
  "courses.action.edit": "Edit",
  "courses.action.unavailable": "Unavailable",
  "courses.action.openCurrent": "Open current Course",
  "courses.action.openStudio": "Open in Adaptive Studio",
  "courses.action.previewRevision": "Preview revision",
  "courses.action.makeCurrent": "Make current",
  "courses.action.export": "Export",
  "courses.action.remove": "Remove",
  "courses.action.more": "More actions for {title}",
  "courses.remove.title": "Remove Course Pack from the library?",
  "courses.remove.description":
    "Revision {revisionId} will be archived. The Course Pack, sessions, and learning facts are not deleted, so replay and history remain auditable.",
  "courses.action.cancel": "Cancel",
  "courses.action.removeFromLibrary": "Remove from library",
  "courses.export.error": "Export failed ({status})",
  "practice.error.protectedField": "Protected curriculum field received",
  "practice.error.noActiveSession": "There is no active lesson",
  "practice.error.exerciseNotLoaded": "The exercise has not loaded yet",
  "practice.error.attemptRequired": "Create an attempt first",
  "practice.error.diffChanged":
    "Files changed after the latest diff. Refresh the diff and run the tests again.",
  "practice.error.zedUnavailable": "Zed is unavailable for this workspace.",
  "practice.error.completionEvidenceUnavailable":
    "Server-owned skill evidence is not ready for completion yet",
  "practice.error.unavailable": "Exercise unavailable",
  "practice.error.disclosureApprovalFailed":
    "Could not approve sending the data.",
  "practice.loading": "Loading practice…",
  "practice.locked.title": "Practice unlocks during the lesson",
  "practice.locked.description":
    "Complete the required explanations, recall, quiz, and code reading first. The exercise prompt appears only at its scheduled step.",
  "practice.locked.emptyTitle": "The current step is not practice yet",
  "practice.locked.emptyDescription":
    "Return to the lesson: it already marks the one next available step.",
  "practice.backToLesson": "Return to lesson",
  "practice.nextAction.createAttempt": "Create an isolated attempt.",
  "practice.nextAction.editAndRefreshDiff":
    "Make your own change in Zed, then refresh the Git diff.",
  "practice.nextAction.runTests":
    "Run the allowlisted tests against the current diff.",
  "practice.nextAction.fixAndRetest": "Fix the code and run the tests again.",
  "practice.nextAction.retestChangedWorkspace":
    "The code changed after the test — run the tests again.",
  "practice.nextAction.requestReview":
    "The tests passed. Now request a solution review.",
  "practice.nextAction.applyFindings":
    "Apply the findings yourself, then repeat diff → tests → solution review.",
  "practice.nextAction.accepted":
    "The solution review was accepted — save the skill evidence and return to the lesson.",
  "practice.workspace.copied": "Workspace ID copied.",
  "practice.workspace.copyFailed": "Could not copy the workspace ID.",
  "practice.disclosure.cancelled":
    "The data was not sent. You can request the review later.",
  "practice.duration": "≈ {duration}",
  "practice.work.label": "Work on the exercise",
  "practice.completionCriteria": "Done when",
  "practice.constraints": "Constraints",
  "practice.workspace.title": "Isolated workspace",
  "practice.workspace.identity": "{id} · generation {generation}",
  "practice.workspace.pending":
    "The server will create it after the attempt starts.",
  "practice.workspace.copyId": "Copy ID",
  "practice.workspace.opening": "Opening…",
  "practice.workspace.open": "Open in Zed",
  "practice.workspace.creating": "Creating…",
  "practice.workspace.create": "Create attempt",
  "practice.nextAction.label": "Next step:",
  "practice.diff.refreshing": "Refreshing diff…",
  "practice.diff.refresh": "Refresh Git diff",
  "practice.tests.running": "Running tests…",
  "practice.tests.run": "Run tests",
  "practice.tests.stop": "Stop tests",
  "practice.review.running": "Reviewer is reading…",
  "practice.review.request": "Request review",
  "practice.review.stop": "Stop review",
  "practice.operation.stopped":
    "Stopped. No result from this operation was applied.",
  "practice.diff.title": "Diff from baseline",
  "practice.diff.empty": "The diff will appear after your first change.",
  "practice.diff.truncated": "The diff was truncated by the server limit.",
  "practice.testRun.title": "Latest test run",
  "practice.testRun.output": "{output}\n\nexit code: {exitCode}",
  "practice.testRun.empty": "Tests have not run yet.",
  "practice.testRun.status.passed": "Tests passed against the current diff",
  "practice.testRun.status.failed": "Tests failed",
  "practice.testRun.status.running": "Test run in progress",
  "practice.testRun.status.cancelled": "Test run cancelled",
  "practice.testRun.status.timedOut": "Test run timed out",
  "practice.testRun.status.resourceLimit": "Test output limit reached",
  "practice.testRun.status.unsupportedEnvironment":
    "Trusted environment unavailable",
  "practice.testRun.status.backendError": "Trusted check unavailable",
  "practice.testRun.status.stale": "Code changed after the test",
  "practice.sidebar.label": "Review and topics",
  "practice.topics.title": "Topics in practice",
  "practice.reviewer.title": "Reviewer",
  "practice.reviewer.status.accepted": "Accepted",
  "practice.reviewer.status.changesRequested": "Changes requested",
  "practice.reviewer.status.notRun": "Not run",
  "practice.evidenceBundle.title": "Evidence bundle",
  "practice.evidenceBundle.snapshot": "snapshot {hash}",
  "practice.reviewer.hint": "hint {level}",
  "practice.reviewer.empty":
    "Review becomes available after a changed diff and a successful test against the current files. It remains read-only.",
  "practice.reviewer.accepting": "Saving skill evidence…",
  "practice.reviewer.accept": "Accept review and continue",
  "practice.reviewer.changesRequested":
    "Fix the code in Zed, run the tests again, and request a new review. The current review does not complete the unit.",
  "practice.disclosure.title": "Send evidence to external AI?",
  "practice.disclosure.description":
    "The Reviewer will receive only the recorded bundle. This approval is valid once.",
  "practice.disclosure.destination": "Destination",
  "practice.disclosure.data": "Data",
  "practice.disclosure.dataSummary": "{categories} · {bytes} bytes",
  "practice.disclosure.exclusions": "Not sent",
  "practice.disclosure.cancel": "Do not send",
  "practice.disclosure.approveOnce": "Allow once",
  "interview.title": "Technical interview",
  "interview.returnToSession": "Return to lesson",
  "interview.loading": "Loading interview…",
  "interview.error.validation.manualTopics":
    "Enter at least one comma-separated topic.",
  "interview.error.validation.emptyScope":
    "No topics are available for this scope yet. Choose ‘Select manually’.",
  "interview.error.validation.setup":
    "Check the topics, difficulty, and question count.",
  "interview.error.start": "Could not start the interview.",
  "interview.error.answerRetry":
    "{error} Your answer remains in the form, so you can retry the request.",
  "interview.error.answer":
    "Could not get the next question. Your answer remains in the form.",
  "interview.error.finish": "Could not finish the interview.",
  "interview.error.disclosureApprove": "Could not approve sending the data.",
  "interview.error.disclosureCancel":
    "Could not cancel the pending disclosure. No data was sent.",
  "interview.error.disclosureCanceled":
    "No data was sent. You can continue the interview later.",
  "interview.error.invalidPayload":
    "The saved interview data failed validation. Nothing protected was displayed.",
  "interview.error.scopeMismatch":
    "The interview session could not be verified. Return to the lesson and try again.",
  "interview.error.associationMismatch":
    "This interview does not belong to the requested lesson session.",
  "interview.error.load": "Could not load the interview. Try again.",
  "interview.error.unknown": "Unknown error",
  "interview.scope.studied.label": "Studied topics only",
  "interview.scope.studied.description":
    "Topics from lessons with activities you have started or completed.",
  "interview.scope.currentWeek.label": "Current week",
  "interview.scope.currentWeek.description":
    "Topics from the week with the current or next available lesson (week 1 by default).",
  "interview.scope.manual.label": "Select manually",
  "interview.scope.manual.description":
    "Enter your own comma-separated topics.",
  "interview.scope.all.label": "Full diagnostic",
  "interview.scope.all.description":
    "Topics from every lesson in the learning path.",
  "interview.disclosure.title": "Send data to an external AI?",
  "interview.disclosure.description":
    "Permission applies once to the next interview question.",
  "interview.disclosure.recipient": "Recipient",
  "interview.disclosure.data": "Data",
  "interview.disclosure.payload": "{categories} · {bytes} B",
  "interview.disclosure.exclusions": "Not sent",
  "interview.disclosure.decline": "Do not send",
  "interview.disclosure.approve": "Allow once",
  "interview.setup.description":
    "Choose the topics and format. The interviewer asks one question at a time; the report records answer observations without claiming technical correctness.",
  "interview.setup.workflow": "Separate flow",
  "interview.setup.title": "Interview setup",
  "interview.setup.help":
    "Set only the learning frame here: topic scope, difficulty, and question count.",
  "interview.setup.scope": "Topic scope",
  "interview.setup.manualTopics": "Comma-separated topics",
  "interview.setup.topics": "Interview topics",
  "interview.setup.selectedTopicsAria": "Topics in the selected scope",
  "interview.setup.loadingTopics": "Loading learning-path topics…",
  "interview.setup.topicsLoadError":
    "Could not load learning-path topics. Try again or select topics manually.",
  "interview.setup.retryTopics": "Try again",
  "interview.setup.chooseManual": "Select manually",
  "interview.setup.noStudiedTopics":
    "There are no studied topics yet: no learning-path lesson has started or completed activities. Start a lesson from Home or select topics manually.",
  "interview.setup.noTopics":
    "The learning path has no topics for this scope yet.",
  "interview.setup.durationEstimate":
    "Estimated duration: {duration} · Questions: {count} × ~5 min",
  "interview.setup.reportLimit":
    "The report evaluates answer structure and completeness, not technical correctness.",
  "interview.setup.difficulty": "Difficulty",
  "interview.setup.difficulty.foundation": "Foundation",
  "interview.setup.difficulty.interviewReady": "Interview-ready",
  "interview.setup.difficulty.deepDive": "Deep dive",
  "interview.setup.questionCount": "Question count",
  "interview.setup.starting": "Preparing the first question…",
  "interview.setup.start": "Start interview",
  "interview.opening.description":
    "The setup is saved, but the first question has not arrived yet.",
  "interview.opening.status": "Waiting to start",
  "interview.opening.errorTitle": "Could not get the first question",
  "interview.opening.retryDescription":
    "Topics: {topics}. Retrying reuses the same operation ID and does not create a duplicate.",
  "interview.opening.retrying": "Retrying…",
  "interview.opening.retry": "Retry start",
  "interview.session.description":
    "Answer the current question. The transcript and progress are saved by the server after every step.",
  "interview.session.questionProgress": "Question {current} of {total}",
  "interview.session.answeredProgress": "Answered: {answered} of {total}",
  "interview.chat.interviewer": "Interviewer",
  "interview.chat.you": "You",
  "interview.chat.typing": "Interviewer is typing…",
  "interview.chat.transcript": "Interview transcript",
  "interview.chat.readyDescription":
    "The server will create an honest report from the saved transcript. Technical correctness without review will not count as proven.",
  "interview.chat.finishing": "Preparing report…",
  "interview.chat.finish": "Finish and open report",
  "interview.chat.messageLabel": "Message",
  "interview.chat.placeholder":
    "Write your answer to the interviewer’s question…",
  "interview.chat.sendAria": "Send answer",
  "interview.chat.retryAria": "Retry request",
  "interview.report.title": "Interview report",
  "interview.report.description":
    "What went well and what to revisit. This assesses answer structure and completeness.",
  "interview.report.completed": "Completed",
  "interview.report.limitsAria": "Assessment limits",
  "interview.report.limits":
    "Answer structure and completeness were assessed. Technical correctness was not checked.",
  "interview.report.summary": "Answer observations",
  "interview.report.metricsAria": "Interview metrics",
  "interview.report.metric.asked": "Asked",
  "interview.report.metric.answered": "Answered",
  "interview.report.metric.completion": "Completion",
  "interview.report.strengths": "Strengths",
  "interview.report.growthAreas": "Growth areas",
  "interview.report.evidence": "Answer excerpts and observations",
  "interview.report.question": "Question {number}",
  "interview.report.answerExcerpt": "“{excerpt}”",
  "interview.report.new": "New interview",
  "interview.report.nextTitle": "Continue practising",
  "interview.report.nextDescription":
    "Start a fresh interview when you are ready to work through another topic.",
  "authoring.page.title": "Course editor",
  "authoring.page.description":
    "Create a versioned graph of weeks, days, and units. Published revisions are immutable; continue work from a draft clone.",
  "authoring.addWeek.aiUnavailable":
    "AI draft generation is not available in this build.",
  "authoring.addWeek.cardDescription":
    "Title, goal, topics, and number of days. A draft revision, week, and days will be created automatically.",
  "authoring.addWeek.commaSeparated": "Comma-separated.",
  "authoring.addWeek.create": "Create week and days",
  "authoring.addWeek.creating": "Creating…",
  "authoring.addWeek.daysCount": "Number of days",
  "authoring.addWeek.goalPlaceholder":
    "What the learner will achieve this week",
  "authoring.addWeek.outcomesPlaceholder":
    "Explain the Event Loop, apply async/await",
  "authoring.addWeek.sheetDescription":
    "A draft revision (if needed), week, and days are created automatically. Edit and publish manually as usual.",
  "authoring.addWeek.title": "Add the next week",
  "authoring.addWeek.titlePlaceholder": "For example: Asynchrony in JavaScript",
  "authoring.addWeek.topicsPlaceholder": "Promise, async/await, Event Loop",
  "authoring.addWeek.weekGoal": "Week goal",
  "authoring.addWeek.weekTitle": "Week title",
  "authoring.clone.submit": "Clone as draft",
  "authoring.common.back": "Back",
  "authoring.common.cancel": "Cancel",
  "authoring.common.continue": "Continue",
  "authoring.common.edit": "Edit",
  "authoring.createDraft.submit": "Create draft",
  "authoring.createDraft.summary": "Create a new revision",
  "authoring.createDraft.creating": "Creating local draft…",
  "authoring.entry.eyebrow": "Adaptive Studio",
  "authoring.entry.title": "Choose how to begin this Course",
  "authoring.entry.description":
    "Choose the assisted workflow that fits the model you have. External work returns a Course Pack for import; connected work begins with an explicit local Draft. Neither path publishes.",
  "authoring.entry.choose": "Choose one Course creation path",
  "authoring.entry.manual.title": "Create manually",
  "authoring.entry.manual.badge": "Works with AI Off",
  "authoring.entry.manual.description":
    "Start with the complete typed editor for weeks, days, units, and protected authoring fields.",
  "authoring.entry.manual.next":
    "Create the local Draft below, then build its structure directly in the complete manual editor.",
  "authoring.entry.designer.title": "Describe a learning goal",
  "authoring.entry.designer.badge": "Optional AI · review required",
  "authoring.entry.designer.description":
    "Start with the guided Course Designer. AI can return a typed proposal only; you review it before Apply.",
  "authoring.entry.designer.next":
    "Name the Course and describe the learning goal. This creates an editable local Draft and opens Designer with the goal ready for a proposal.",
  "authoring.entry.unselected":
    "Choose a path to reveal the shared local Draft details. No option is preselected.",
  "authoring.entry.continueHint": "Select a path to continue",
  "authoring.entry.continueReady": "Continue to the shared authoring brief",
  "authoring.entry.assistedTitle": "Choose an assisted start",
  "authoring.entry.assistedDescription":
    "Choose based on the model you actually have. Aptiloop checks technical compatibility for connected models, but it does not score model strength or output quality.",
  "authoring.external.title": "Use an external model",
  "authoring.external.description":
    "Describe the Course once, then download a self-contained instruction file with the exact Course Pack V1 schema and template.",
  "authoring.external.guidance":
    "Prefer this path when another model offers stronger reasoning, broader context, web research, or tools that your connected model does not have.",
  "authoring.external.badge": "Aptiloop sends nothing",
  "authoring.external.start": "Prepare external instructions",
  "authoring.external.pageDescription":
    "Complete the brief and download one model instruction file. Give it to the model you choose, then upload the returned JSON only through Course Pack import.",
  "authoring.external.form": "External model authoring brief",
  "authoring.external.privacyTitle": "External handoff",
  "authoring.external.privacyDescription":
    "The download contains only this brief and version-matched bundled format guidance. Aptiloop does not contact the model or receive its result automatically. Do not put secrets in the brief.",
  "authoring.external.download": "Download instruction file",
  "authoring.external.downloaded": "Authoring instructions downloaded.",
  "authoring.external.downloadError":
    "The authoring instruction file could not be prepared.",
  "authoring.external.uploadResult": "Upload the returned Course Pack",
  "authoring.external.nextStep":
    "The model should return one UTF-8 JSON document. Treat it as untrusted and validate it at /courses/import.",
  "authoring.connected.title": "Use the connected Course Designer",
  "authoring.connected.description":
    "Create an explicit local Draft from the same brief, then open guided Designer for typed proposals against that Draft.",
  "authoring.connected.guidance":
    "Choose this when the configured model is technically ready and you consider its context and reasoning suitable for the Course. Readiness is checked on the next screen.",
  "authoring.connected.badge": "Capability check required",
  "authoring.connected.start": "Check and use connected model",
  "authoring.connected.pageDescription":
    "Aptiloop shows the exact provider, model, and observed technical capabilities before it creates the local Draft. Model quality is still your decision.",
  "authoring.connected.form": "Connected Course Designer authoring brief",
  "authoring.connected.readinessTitle": "Course Designer readiness",
  "authoring.connected.state.checking": "Checking",
  "authoring.connected.state.ready": "Technically ready",
  "authoring.connected.state.off": "AI Off",
  "authoring.connected.state.unavailable": "Unavailable",
  "authoring.connected.state.unknown": "Capability unknown",
  "authoring.connected.state.unsupported": "Capability unavailable",
  "authoring.connected.stateDescription.checking":
    "Reading the server-owned provider, model, and capability snapshot.",
  "authoring.connected.stateDescription.ready":
    "The exact selected model is available and the observed provider capabilities satisfy the persisted Course Designer role contract.",
  "authoring.connected.stateDescription.off":
    "Course Designer is set to AI Off. External instructions and complete manual authoring remain available.",
  "authoring.connected.stateDescription.unavailable":
    "The selected connection or model is not currently available. Aptiloop will not substitute another provider or Mock.",
  "authoring.connected.stateDescription.unknown":
    "Aptiloop has no current capability snapshot for this eligible connection. You may continue; the server will validate the exact role and return a structured failure if needed.",
  "authoring.connected.stateDescription.unsupported":
    "The exact model or connection is missing a required capability: {capability}.",
  "authoring.connected.refresh": "Refresh",
  "authoring.connected.evidence.model": "Exact model",
  "authoring.connected.evidence.tools": "Typed tools",
  "authoring.connected.evidence.transport": "Stream and cancel",
  "authoring.connected.evidence.observedAt": "Capability snapshot",
  "authoring.connected.evidence.observed": "Observed",
  "authoring.connected.evidence.notAvailable": "Not available",
  "authoring.connected.qualityNote":
    "Technical readiness is not a weak/strong model rating. If this model has limited context, search, or reasoning, use the external instruction-file path.",
  "authoring.connected.create": "Create Draft and open Designer",
  "authoring.connected.openSettings": "Open AI settings",
  "authoring.connected.nextStep":
    "This action creates one local editable Draft. Provider disclosure, proposal Apply, Preview, and Publish remain separate later actions.",
  "authoring.connected.alternatives": "Continue another way",
  "authoring.brief.title": "Authoring brief",
  "authoring.brief.description":
    "The same brief works for either assisted path and stays in this browser until you explicitly clear it.",
  "authoring.brief.topicGoal": "Topic or learning goal",
  "authoring.brief.topicGoalPlaceholder":
    "For example: Practical asynchronous JavaScript",
  "authoring.brief.targetOutcome": "Target outcome",
  "authoring.brief.targetOutcomePlaceholder":
    "What should the learner be able to explain, decide, or build independently?",
  "authoring.brief.currentLevel": "Current level",
  "authoring.brief.currentLevelPlaceholder":
    "For example: Comfortable with JavaScript syntax, new to concurrency",
  "authoring.brief.primaryLocale": "Primary Course locale",
  "authoring.brief.primaryLocalePlaceholder": "Select a Course language",
  "authoring.brief.primaryLocaleOther": "Other BCP 47 locale…",
  "authoring.brief.primaryLocaleCustomLabel": "Custom Course locale",
  "authoring.brief.primaryLocaleDescription":
    "Use a BCP 47 locale such as en-US, ru-RU, de-DE, or ja-JP. This is independent from the interface language.",
  "authoring.brief.primaryLocaleError":
    "Enter a valid BCP 47 Course locale, such as en-US or ru-RU.",
  "authoring.brief.pacing": "Pacing and available time",
  "authoring.brief.pacingPlaceholder":
    "For example: 30 minutes per day for four weeks",
  "authoring.brief.tools": "Tools and access",
  "authoring.brief.accessibility": "Accessibility needs",
  "authoring.brief.constraints": "Other constraints",
  "authoring.brief.optionalPlaceholder": "Optional — add only what matters",
  "authoring.brief.clear": "Clear brief",
  "authoring.brief.savedLocally":
    "Saved locally in this browser. It is not sent anywhere by entering it here.",
  "authoring.brief.storageErrorTitle": "Brief persistence is unavailable",
  "authoring.brief.storageErrorDescription":
    "You can continue in this tab, but the brief may not survive a reload. Copy important details before leaving.",
  "authoring.brief.validationError":
    "Complete the required brief fields and use a valid BCP 47 Course locale before continuing.",
  "authoring.manual.fallback": "Create manually without AI",
  "authoring.manual.fallbackDescription":
    "Create a blank local Draft and use the complete structured editor. This path remains available regardless of provider state.",
  "authoring.manual.start": "Create a blank Draft",
  "authoring.manual.form": "Manual Course Draft details",
  "authoring.creation.error": "The local Draft could not be created.",
  "authoring.details.title": "Course details",
  "authoring.details.manualTitle": "Course details",
  "authoring.details.designerTitle": "Learning goal",
  "authoring.creation.learningGoal": "What should the learner achieve?",
  "authoring.creation.learningGoalPlaceholder":
    "For example: Build and explain a small asynchronous JavaScript workflow without relying on step-by-step hints.",
  "authoring.creation.designerGuardrailTitle": "Editable Draft first",
  "authoring.creation.designerGuardrailDescription":
    "Designer can propose changes only. You review and explicitly apply them; publishing remains a separate action.",
  "authoring.manual.eyebrow": "Manual authoring",
  "authoring.manual.title": "Course structure",
  "authoring.manual.description":
    "Edit every typed week, day, and unit directly. Manual authoring remains complete when AI is Off.",
  "authoring.workspace.aria": "Course Studio workspace",
  "authoring.workspace.program": "Program",
  "authoring.workspace.designer": "Designer",
  "authoring.workspace.preview": "Preview",
  "authoring.workspace.release": "Release",
  "authoring.workspace.history": "History & adaptation",
  "authoring.workspace.designerUnavailable.title":
    "Designer needs an editable Draft",
  "authoring.workspace.designerUnavailable.description":
    "Clone this immutable revision into a Draft before requesting or applying a proposal.",
  "authoring.workspace.releaseUnavailable.title":
    "This revision is already immutable",
  "authoring.workspace.releaseUnavailable.description":
    "Published revisions cannot be released again. Clone it into a Draft to prepare another revision.",
  "authoring.preview.eyebrow": "Learner preview",
  "authoring.preview.loading": "Loading the learner preview",
  "authoring.preview.unavailable":
    "The learner preview is unavailable. Your Course revision was not changed.",
  "authoring.preview.emptyTitle": "Nothing to preview yet",
  "authoring.preview.emptyDescription":
    "Add a lesson and at least one learner activity in Program, then return to Preview.",
  "authoring.preview.lessonMeta": "Activities: {activities} · {minutes} min",
  "authoring.error.actionTitle": "The Studio action did not complete",
  "authoring.release.checking": "Checking…",
  "authoring.release.ready": "Ready for explicit Publish",
  "authoring.publish.publishing": "Publishing immutable revision…",
  "authoring.current.draftCreatedAt": "Draft created {date}",
  "authoring.current.label": "Current Course",
  "authoring.current.publishedAt": "Published {date}",
  "authoring.current.structure": "{weeks} · {days}",
  "authoring.current.structureLoading": "Loading weeks and days…",
  "authoring.current.primaryLocale": "Course locale: {locale}",
  "authoring.current.branchUpstream": "Upstream branch",
  "authoring.current.branchPersonal": "Personal branch",
  "authoring.current.parent": "Parent: {id}",
  "authoring.current.saving": "Saving…",
  "authoring.current.saved": "Saved",
  "authoring.current.saveFailed": "Save failed",
  "authoring.current.hashDetails": "Revision integrity details",
  "authoring.current.contentHash": "Published content hash",
  "authoring.current.baseHash": "Immutable base hash",
  "authoring.adaptation.confirm.description":
    "A new personal draft will be created. The current published personal revision and upstream revision remain unchanged until you review and Publish it.",
  "authoring.adaptation.confirm.keep-personal":
    "Keep the personal content and rebase its comparison point to the newer upstream revision?",
  "authoring.adaptation.confirm.use-upstream":
    "Start the next personal draft from the newer upstream content?",
  "authoring.adaptation.conflicts": "Review {count} overlapping changes",
  "authoring.adaptation.create": "Create personal adaptation",
  "authoring.adaptation.currentDescription":
    "The personal branch is based on the current upstream revision.",
  "authoring.adaptation.description":
    "Edit on your local personal branch. Personal Publish never replaces the Course's upstream revision.",
  "authoring.adaptation.eyebrow": "Local branch",
  "authoring.adaptation.integrate": "Create integration draft",
  "authoring.adaptation.keepPersonal": "Keep personal version",
  "authoring.adaptation.personal.empty": "No personal revisions yet.",
  "authoring.adaptation.personal.title": "Personal revisions",
  "authoring.adaptation.status.clean": "Upstream update · clean",
  "authoring.adaptation.status.conflict": "Upstream update · review conflicts",
  "authoring.adaptation.status.current": "Current",
  "authoring.adaptation.title": "Personal adaptation",
  "authoring.adaptation.unavailable": "Personal adaptation is unavailable.",
  "authoring.adaptation.upstream.empty": "No published upstream revision.",
  "authoring.adaptation.upstream.title": "Upstream revisions",
  "authoring.adaptation.useUpstream": "Use upstream version",
  "authoring.revision.short": "rev. {revision}",
  "authoring.day.add": "Add day",
  "authoring.day.form.add": "Add day",
  "authoring.day.form.edit": "Edit day {title}",
  "authoring.day.meta": "Day {number} · {id} · {minutes} min",
  "authoring.day.save": "Save day",
  "authoring.delete.button": "Delete {label}",
  "authoring.delete.confirm": "Confirm deletion",
  "authoring.delete.confirmation": "Delete confirmation: {label}",
  "authoring.delete.dayConsequence":
    "The day and all its units will be deleted. This action cannot be undone.",
  "authoring.delete.unitConsequence":
    "The unit will be deleted from the draft. This action cannot be undone.",
  "authoring.delete.weekConsequence":
    "The week and all its days and units will be deleted. This action cannot be undone.",
  "authoring.emptyProgram.description": "There are no revisions yet.",
  "authoring.emptyProgram.title": "Course not created yet",
  "authoring.entity.day": "day {title}",
  "authoring.entity.unit": "unit {title}",
  "authoring.entity.week": "week {title}",
  "authoring.error.graphUnavailable":
    "The revision graph is unavailable or contains unsafe fields.",
  "authoring.error.invalidJson": "{label}: valid JSON is required.",
  "authoring.error.invalidStructure":
    "{label}: structure does not match the contract.",
  "authoring.error.payloadTypeMismatch":
    "Payload: type must match the unit type.",
  "authoring.error.requestFailed": "Request failed ({status})",
  "authoring.error.saveFailed": "Could not save the change.",
  "authoring.error.unsafeResponseField": "Unsafe response field: {path}",
  "authoring.error.unsafeServerResponse":
    "The server response did not pass local safety validation.",
  "authoring.error.versionsUnavailable": "The revision list is unavailable.",
  "authoring.designer.apply": "Apply proposal",
  "authoring.designer.action.answerDiagnostic": "Continue with answers",
  "authoring.designer.action.completeDiscovery": "Complete discovery",
  "authoring.designer.action.confirm": "Confirm for compilation",
  "authoring.designer.action.requestRevision": "Request revision",
  "authoring.designer.action.retry": "Retry from failed step",
  "authoring.designer.action.cancelGeneration": "Cancel generation",
  "authoring.designer.action.configureAi": "Configure AI or provider",
  "authoring.designer.action.continueManually": "Continue manually",
  "authoring.designer.action.skipDiagnostic": "Skip diagnostic",
  "authoring.designer.action.submitRequest": "Submit request",
  "authoring.designer.attribution": "{provider} · {model} · prompt {version}",
  "authoring.designer.change.add-day": "Add day",
  "authoring.designer.change.add-unit": "Add activity",
  "authoring.designer.change.add-week": "Add week",
  "authoring.designer.change.update-day": "Update day",
  "authoring.designer.change.update-unit": "Update activity",
  "authoring.designer.change.update-week": "Update week",
  "authoring.designer.changeCount": "{count} proposed changes",
  "authoring.designer.description":
    "Optional AI reads this draft and returns a typed proposal. It cannot apply changes or publish a revision.",
  "authoring.designer.diagnosticTitle": "Optional diagnostic",
  "authoring.designer.disclosureApprove": "Approve and generate",
  "authoring.designer.disclosureCancel": "Cancel",
  "authoring.designer.disclosureDescription":
    "Review the exact one-time scope before any data is sent.",
  "authoring.designer.disclosureTitle": "External provider disclosure",
  "authoring.designer.disclosure.role": "AI role",
  "authoring.designer.disclosure.connection": "Connection ID",
  "authoring.designer.disclosure.provider": "Provider type",
  "authoring.designer.disclosure.model": "Exact model",
  "authoring.designer.disclosure.destination": "Destination",
  "authoring.designer.disclosure.payload": "Payload categories",
  "authoring.designer.disclosure.bytes": "Payload size (bytes)",
  "authoring.designer.disclosure.scope": "Draft, entity, and source scope",
  "authoring.designer.disclosure.sources": "Approved source scope",
  "authoring.designer.disclosure.exclusions": "Not sent",
  "authoring.designer.disclosure.expires": "Approval expires",
  "authoring.designer.disclosure.retention":
    "Approval is valid only for this named operation until the displayed expiry and is consumed once. Aptiloop does not receive provider retention terms through this contract.",
  "authoring.designer.cancelled":
    "Generation was cancelled. The draft and authoring request were preserved.",
  "authoring.designer.empty": "No Course Designer proposals yet.",
  "authoring.designer.failed":
    "Course Designer failed without changing the draft.",
  "authoring.designer.form.activities": "Preferred activity types",
  "authoring.designer.form.constraints": "Constraints",
  "authoring.designer.form.currentLevel": "Current level",
  "authoring.designer.form.goal": "Learning goal",
  "authoring.designer.form.onePerLine": "One item per line",
  "authoring.designer.form.runtime": "Runtime requirements",
  "authoring.designer.form.sources": "Approved source references",
  "authoring.designer.form.sourcesHint":
    "One provided text or URL reference per line. URLs are recorded, never fetched.",
  "authoring.designer.form.start": "Start guided design",
  "authoring.designer.form.targetOutcome": "Target outcome",
  "authoring.designer.eyebrow": "Adaptive Studio · Course Designer",
  "authoring.designer.generate": "Generate proposal",
  "authoring.designer.generating": "Generating proposal…",
  "authoring.designer.loading": "Loading guided design state…",
  "authoring.designer.prompt": "Authoring request",
  "authoring.designer.promptPlaceholder":
    "For example: add a foundation week with a recall activity.",
  "authoring.designer.proposalOnly": "Proposal only",
  "authoring.designer.invalidProposal":
    "Blocked: {errors} errors · {warnings} warnings",
  "authoring.designer.proposalsTitle": "Review proposals",
  "authoring.designer.proposalsUnavailable":
    "Course Designer proposals are unavailable.",
  "authoring.designer.provenance": "Approved sources: {count}",
  "authoring.designer.revisionLabel": "Revision request",
  "authoring.designer.state.COMPILATION": "Compilation",
  "authoring.designer.state.CURRICULUM_PROPOSAL": "Curriculum proposal",
  "authoring.designer.state.DIAGNOSTIC": "Diagnostic",
  "authoring.designer.state.DISCOVERY": "Discovery",
  "authoring.designer.state.DRAFT_REQUEST": "Draft request",
  "authoring.designer.state.FAILED": "Failed",
  "authoring.designer.state.PUBLISHED": "Published",
  "authoring.designer.state.USER_REVIEW": "User review",
  "authoring.designer.state.VALIDATION": "Validation",
  "authoring.designer.reject": "Reject",
  "authoring.designer.status.applied": "Applied",
  "authoring.designer.status.proposed": "Needs review",
  "authoring.designer.status.rejected": "Rejected",
  "authoring.designer.title": "Course Designer",
  "authoring.designer.validProposal":
    "Validated proposal: {errors} errors · {warnings} warnings",
  "authoring.designer.validationPending":
    "The applied proposal is in deterministic validation. Resolve diagnostics, review the preview, then publish manually.",
  "authoring.field.checklist": "Checklist",
  "authoring.field.checklistJson": "Checklist items",
  "authoring.field.completionCriteria": "Completion criteria",
  "authoring.field.completionCriteriaJson": "Completion criteria",
  "authoring.field.curriculumDescription": "Course description",
  "authoring.field.curriculumId": "Course ID",
  "authoring.field.curriculumTitle": "Course title",
  "authoring.field.depth": "Depth",
  "authoring.field.description": "Description",
  "authoring.field.expectedOutcomes": "Expected outcomes",
  "authoring.field.expectedOutcomesJson": "Expected outcomes",
  "authoring.field.goal": "Goal",
  "authoring.field.inherit": "Inherit",
  "authoring.field.minutes": "Minutes",
  "authoring.field.misconceptions": "Common misconceptions",
  "authoring.field.misconceptionsJson": "Common misconceptions",
  "authoring.field.objectives": "Objectives",
  "authoring.field.objectivesJson": "Objectives",
  "authoring.field.optionalUnit": "Optional unit",
  "authoring.field.outOfScope": "Out of scope",
  "authoring.field.outOfScopeJson": "Out of scope",
  "authoring.field.payload": "Payload",
  "authoring.field.payloadJson": "Typed activity payload",
  "authoring.field.prerequisites": "Prerequisites",
  "authoring.field.prerequisitesJson": "Prerequisites",
  "authoring.field.questions": "Questions",
  "authoring.field.questionsJson": "Questions and protected answer keys",
  "authoring.field.referenceAnswer": "Reference answer · authoring only",
  "authoring.field.revisionDescription": "Revision description",
  "authoring.field.revisionTitle": "Revision title",
  "authoring.field.slug": "Slug",
  "authoring.field.sources": "Sources",
  "authoring.field.sourcesJson": "Sources",
  "authoring.field.stableId": "Stable ID",
  "authoring.field.title": "Title",
  "authoring.field.topics": "Topics",
  "authoring.field.topicsJson": "Topics",
  "authoring.field.type": "Type",
  "authoring.field.unlockRules": "Unlock rules",
  "authoring.field.unlockRulesJson": "Unlock rules",
  "authoring.graph.empty.description":
    "Add the first week, then a day and learning units.",
  "authoring.graph.empty.title": "This draft has no weeks yet",
  "authoring.graph.readOnly.description":
    "The published revision is protected from changes.",
  "authoring.graph.readOnly.title": "Read-only.",
  "authoring.graph.selectedRevision": "Selected revision graph",
  "authoring.history.createdAt": "Created: {date}",
  "authoring.history.description": "Description: {description}",
  "authoring.history.details": "Dates and description",
  "authoring.history.empty": "There are no other revisions.",
  "authoring.history.publishedAt": "Published: {date}",
  "authoring.history.title": "Revision history",
  "authoring.loading.graph": "Loading Course graph",
  "authoring.loading.versions": "Loading revisions",
  "authoring.structured.addItem": "Add item",
  "authoring.structured.removeItem": "Remove item",
  "authoring.structured.optionalEmpty": "Leave empty for none",

  "authoring.release.eyebrow": "Adaptive Studio · release pipeline",
  "authoring.release.validateTitle": "1. Validate draft",
  "authoring.release.validateDescription":
    "Check structure, typed activities, completion criteria, and graph finiteness.",
  "authoring.release.validateAction": "Run validation",
  "authoring.release.previewTitle": "2. Learner preview",
  "authoring.release.previewDescription":
    "Inspect the learner-visible outline without protected answers or evaluation material.",
  "authoring.release.previewAction": "Open learner preview",
  "authoring.release.reviewTitle": "3. Review changes",
  "authoring.release.reviewDescription":
    "Compare stable entities with the immutable parent revision.",
  "authoring.release.reviewAction": "Review changes",
  "authoring.release.passed": "Passed",
  "authoring.release.blocked": "Blocked",
  "authoring.release.diagnosticCounts":
    "Errors: {errors} · Warnings: {warnings}",
  "authoring.release.dayCount": "{count} days",
  "authoring.release.changeCounts":
    "Added: {added} · Changed: {changed} · Removed: {removed}",
  "authoring.release.change.added": "Added",
  "authoring.release.change.changed": "Changed",
  "authoring.release.change.removed": "Removed",
  "authoring.release.entity.week": "Week",
  "authoring.release.entity.day": "Lesson",
  "authoring.release.entity.unit": "Activity",
  "authoring.release.required":
    "Validation, learner preview, and change review must match the current draft before publication.",

  "authoring.publish.confirmation":
    "I understand that a published revision cannot be edited.",
  "authoring.publish.description":
    "After publishing, the revision becomes immutable. Clone it into a new draft for further changes.",
  "authoring.publish.submit": "Publish immutable revision",
  "authoring.publish.title": "Publish revision",
  "authoring.quantity.day.few": "{count} days",
  "authoring.quantity.day.many": "{count} days",
  "authoring.quantity.day.one": "{count} day",
  "authoring.quantity.day.other": "{count} days",
  "authoring.quantity.week.few": "{count} weeks",
  "authoring.quantity.week.many": "{count} weeks",
  "authoring.quantity.week.one": "{count} week",
  "authoring.quantity.week.other": "{count} weeks",
  "authoring.reorder.down": "Move {label} down",
  "authoring.reorder.group": "Order: {label}",
  "authoring.reorder.up": "Move {label} up",
  "authoring.revision.heading": "Version {revision} · {title}",
  "authoring.revision.label": "Version {revision}",
  "authoring.missingRevision.description":
    "This Studio link points to a revision that is no longer available. No other Course was opened.",
  "authoring.missingRevision.title": "Course revision not found",
  "authoring.selectRevision.description":
    "Choose a Course revision from Courses or create a new Draft. Studio will not open another Course automatically.",
  "authoring.selectRevision.title": "Select a revision",
  "authoring.status.archived": "Archived",
  "authoring.status.draft": "Draft",
  "authoring.status.published": "Published",
  "authoring.status.publishedReadOnly": "Published · read-only",
  "authoring.unit.add": "Add unit",
  "authoring.unit.form.add": "Add unit",
  "authoring.unit.form.edit": "Edit unit {title}",
  "authoring.unit.save": "Save unit",
  "authoring.week.add": "Add week",
  "authoring.week.form.add": "Add week",
  "authoring.week.form.edit": "Edit week {title}",
  "authoring.week.meta": "Week {number} · {id}",
  "authoring.week.save": "Save week",
} as const;

export type MessageKey = keyof typeof enUS;

const ruRU: Record<MessageKey, string> = {
  "brand.name": "Aptiloop",
  "brand.tagline": "Локальная учебная мастерская",
  "a11y.skipToContent": "К основному содержимому",
  "a11y.primaryNavigation": "Основная навигация",
  "a11y.mobileNavigation": "Мобильная навигация",
  "a11y.breadcrumbs": "Навигационная цепочка",
  "toast.notifications": "Уведомления",
  "toast.close": "Закрыть уведомление",
  "shell.workspace": "Рабочая область",
  "shell.theme.system": "Системная",
  "shell.theme.light": "Светлая",
  "shell.theme.dark": "Тёмная",
  "shell.theme.change": "Включить тему: {theme}",
  "shell.theme.current": "Тема: {theme}",
  "shell.sidebar.collapse": "Свернуть боковую панель",
  "shell.sidebar.expand": "Развернуть боковую панель",
  "shell.route.course": "Курс",
  "shell.route.lesson": "Урок",
  "shell.route.studio": "Adaptive Studio",
  "nav.home": "Главная",
  "nav.courses": "Курсы",
  "nav.review": "Повторение",
  "nav.skills": "Навыки",
  "nav.settings": "Настройки",
  "page.home.description":
    "Продолжи следующее действие детерминированного учебного маршрута активного курса.",
  "page.lesson.description":
    "Следуйте сохранённому плану урока и продолжайте с текущей активности.",
  "page.exercise.description":
    "Пройдите доверенный локальный сценарий практики для текущего урока.",
  "page.interview.description":
    "Настройте, продолжите или изучите техническое интервью без прямого изменения уровня освоения.",
  "home.loading": "Загружаю учебный маршрут…",
  "home.unavailable": "Aptiloop Core недоступен.",
  "home.noCourse.title": "Нет активного курса",
  "home.noCourse.description":
    "Выберите существующий курс, создайте новый в Adaptive Studio или импортируйте проверенный Course Pack, чтобы начать.",
  "home.openCourses": "Открыть курсы",
  "home.chooseCourse": "Выбрать курс",
  "home.createCourse": "Создать курс",
  "home.importCoursePack": "Импортировать Course Pack",
  "home.currentCourse": "Текущий курс",
  "home.switchCourse": "Сменить курс",
  "home.focus.lessonProgress": "Прогресс урока",
  "home.focus.time": "Время",
  "home.focus.courseProgress": "Прогресс курса",
  "home.courseProgress": "Завершено уроков: {complete} из {total}",
  "home.courseRoadmap": "Дорожная карта курса",
  "courses.revisionSurface.current":
    "Текущий курс · Опубликованная ревизия {revision}",
  "courses.revisionSurface.preview":
    "Предпросмотр курса · Опубликованная ревизия {revision}",
  "home.focus.phase": "Текущий этап",
  "home.focus.evidenceBasis": "Основа данных",
  "home.revision": "Опубликованная ревизия {revision}",
  "home.defaultCourseDescription":
    "Конечный маршрут от понимания до самостоятельного объяснения и практики.",
  "home.startError": "Не удалось начать занятие.",
  "home.nextAction": "Следующее действие",
  "home.lesson": "Урок {number}",
  "home.remaining": "Осталось {minutes} мин",
  "home.estimated": "Около {minutes} мин",
  "home.starting": "Запускаю…",
  "home.start": "Начать занятие",
  "home.resume": "Продолжить занятие",
  "home.selectCourse.title": "Выбрать эту ревизию курса",
  "home.selectCourse.description":
    "Сделайте её активным курсом перед началом или продолжением занятий.",
  "home.selectCourse.action": "Выбрать курс",
  "home.selectCourse.selecting": "Выбираю…",
  "home.selectCourse.error": "Не удалось выбрать эту ревизию курса.",
  "home.complete": "Курс завершён",
  "home.phases": "Этапы обучения",
  "home.phase.study": "Понять",
  "home.phase.check": "Подтвердить",
  "home.phase.practice": "Практика и повторение",
  "home.phase.complete": "Завершено",
  "home.phase.current": "Сейчас",
  "home.phase.ready": "Доступно",
  "home.phase.locked": "Заблокировано",
  "home.phase.progress": "Активностей: {complete} из {total}",
  "home.upcoming": "Следующие уроки",
  "home.locked": "Сначала выполните зависимости",
  "unit.type.briefing": "Брифинг",
  "unit.type.study": "Изучение",
  "unit.type.recall": "Воспроизведение по памяти",
  "unit.type.teacherDialogue": "Разбор с преподавателем",
  "unit.type.quiz": "Короткая проверка",
  "unit.type.codeReading": "Чтение кода",
  "unit.type.exercise": "Практическое задание",
  "unit.type.review": "Проверка решения",
  "unit.type.interview": "Интервью",
  "unit.type.summary": "Итоги занятия",
  "unit.type.checkpoint": "Контрольная точка",
  "unit.type.spacedReview": "Интервальное повторение",
  "unit.status.locked": "Заблокировано",
  "unit.status.ready": "Доступно",
  "unit.status.inProgress": "Сейчас",
  "unit.status.completed": "Готово",
  "unit.status.skipped": "Пропущено",
  "unit.depth.foundation": "Фундамент",
  "unit.depth.interviewReady": "Для собеседования",
  "unit.depth.deepDive": "Углублённо",
  "source.book": "Книга",
  "source.documentation": "Документация",
  "source.video": "Видео",
  "source.article": "Статья",
  "source.note": "Локальная заметка",
  "source.course": "Курс",
  "source.podcast": "Подкаст",
  "dayPlan.title": "Урок {order} · {title}",
  "dayPlan.meta": "{duration} · Глубина: {depth}",
  "dayPlan.phases": "Этапы обучения",
  "dayPlan.phaseIndex": "Этап {current} из {total}",
  "dayPlan.goal": "Цель",
  "dayPlan.topics": "Темы",
  "dayPlan.outcomes": "Ожидаемые результаты",
  "dayPlan.prerequisites": "Зависимости",
  "dayPlan.noPrerequisites": "Зависимостей нет.",
  "dayPlan.outOfScope": "Вне занятия",
  "activity.unsupported.title": "Активность недоступна",
  "activity.unsupported.description":
    "Эта версия Aptiloop не поддерживает такой тип активности. Прогресс не изменён.",
  "home.completed": "Завершено",
  "page.courses.description":
    "Создавайте курсы вручную или импортируйте Course Pack. Все материалы остаются на этом устройстве.",
  "page.review.description":
    "Разбирай назначенные подтверждения, исправления, очередь повторения и интервью.",
  "page.skills.description":
    "Проверяй подтверждения по независимым измерениям. Единого придуманного балла нет.",
  "page.settings.description":
    "Локальное оформление, язык, среды выполнения и необязательные AI-подключения.",
  "locale.dialog.title": "Выберите язык интерфейса",
  "locale.dialog.description":
    "Он меняет только элементы Aptiloop и их доступные имена. Язык курса выбирается отдельно.",
  "locale.field.label": "Язык интерфейса",
  "locale.field.description":
    "Предварительно выбран по языку браузера. До подтверждения ничего не сохраняется.",
  "locale.option.english": "English (United States)",
  "locale.option.russian": "Русский (Россия)",
  "locale.confirm": "Использовать этот язык",
  "locale.saving": "Сохраняю…",
  "locale.saveError":
    "Не удалось сохранить язык интерфейса. Повторите попытку.",
  "settings.section.interface": "Интерфейс",
  "settings.section.interfaceDescription":
    "Оформление и язык хранятся как локальные настройки.",
  "settings.theme": "Тема",
  "settings.theme.help": "Применяется сразу и сохраняется в этом браузере.",
  "settings.locale": "Язык интерфейса",
  "settings.locale.help":
    "Остаётся черновиком до сохранения. Не меняет содержимое и основной язык курса.",
  "settings.section.local": "Core и локальные пути",
  "settings.section.localDescription":
    "Диагностические значения принадлежат Aptiloop и не отправляются браузером.",
  "settings.workspace": "Рабочее пространство упражнений",
  "settings.editor": "Исполняемый файл редактора",
  "settings.section.ai": "AI-роли",
  "settings.section.aiDescription":
    "Выберите одно точное проверенное подключение и модель или оставьте AI выключенным. Подмены на Mock нет.",
  "settings.serverPolicy": "Серверная политика",
  "settings.aiOff": "AI выключен",
  "settings.aiMixedConfiguration": "Смешанная конфигурация",
  "settings.defaultModel": "Модель по умолчанию",
  "settings.model.search": "Искать подключения и ID моделей…",
  "settings.model.noMatches": "Подходящие модели не найдены.",
  "settings.roleOverrides": "Модели для ролей (расширенные)",
  "settings.roleOverridesDescription":
    "Настройте только те роли, которым нужна другая точная модель.",
  "settings.customizeRoles": "Настроить роли",
  "settings.externalDisclosure":
    "Внешний запрос требует одноразового подтверждения передачи данных",
  "settings.aiSaved": "Профили AI-ролей сохранены",
  "settings.aiSaveError": "Не удалось сохранить профили AI-ролей",
  "settings.saveAi": "Сохранить AI-роли",
  "settings.saving": "Сохраняю…",
  "settings.section.connections": "Подключения",
  "settings.section.connectionsDescription":
    "Готовность проверяется и устаревает. Учётные данные остаются в хранилище провайдера.",
  "settings.connection.add": "Добавить подключение",
  "settings.connection.details": "Подробнее",
  "settings.connection.legacyReadOnly":
    "Для этого устаревшего подключения доступны только диагностические данные: безопасных метаданных для управления учётными данными нет. Добавьте управляемое подключение, чтобы войти или заменить данные доступа.",
  "settings.connection.addManaged": "Добавить управляемое подключение",
  "settings.connection.cancelAdd": "Отмена",
  "settings.connection.provider": "Провайдер",
  "settings.connection.name": "Название подключения",
  "settings.connection.apiKey": "{label}",
  "settings.connection.apiKeyDefault": "API-ключ",
  "settings.connection.secretHelp":
    "Хранится только в локальном хранилище учётных данных Aptiloop и не возвращается в браузер.",
  "settings.connection.subscriptionHelp":
    "Создайте подключение, затем завершите авторизацию подписки на стороне провайдера.",
  "settings.connection.recommendation.overall":
    "Основная рекомендация: подписка OpenAI — высокое общее качество без отдельной оплаты API.",
  "settings.connection.recommendation.free":
    "Рекомендуемый бесплатный старт: OpenCode Zen предлагает проверенные бесплатные ID моделей; лимиты провайдера могут измениться.",
  "settings.connection.recommendation.private":
    "Рекомендация для приватности: Ollama оставляет обмен с моделью на этом компьютере.",
  "settings.connection.baseUrl": "Локальный OpenAI-совместимый URL",
  "settings.connection.loopbackOnly":
    "Принимаются только loopback HTTP-адреса, оканчивающиеся на /v1.",
  "settings.connection.externalBaseUrl": "Внешний OpenAI-совместимый HTTPS URL",
  "settings.connection.publicHttpsOnly":
    "Принимаются только публичные HTTPS-имена на порту 443 с путём, оканчивающимся на /v1. Для внешних запросов всё равно требуется подтверждение передачи данных.",
  "settings.connection.modelIds": "Точные ID моделей",
  "settings.connection.addError": "Не удалось добавить подключение",
  "settings.connection.adding": "Добавляю…",
  "settings.connection.addConfirm": "Добавить подключение",
  "settings.connection.newApiKey": "Новый API-ключ",
  "settings.connection.saveKey": "Сохранить ключ",
  "settings.connection.replaceKey": "Заменить ключ",
  "settings.connection.setKey": "Указать ключ",
  "settings.connection.signIn": "Войти",
  "settings.connection.enable": "Включить",
  "settings.connection.disable": "Отключить",
  "settings.connection.actionError": "Не удалось выполнить действие",
  "settings.connection.signingIn": "Запускаю авторизацию у провайдера…",
  "settings.connection.openSignIn": "Открыть авторизацию провайдера",
  "settings.connection.deviceCode": "Используйте код {code}.",
  "settings.connection.chooseOption": "Выберите вариант",
  "settings.connection.continue": "Продолжить",
  "settings.connection.signInComplete": "Подписка подключена",
  "settings.connection.signInFailed": "Авторизация у провайдера не удалась",
  "settings.connection.cancelSignIn": "Отменить авторизацию",
  "settings.external": "Внешнее",
  "settings.localDevelopment": "Локальная разработка",
  "settings.models": "Моделей: {count}",
  "settings.developerDiagnostics": "Диагностика разработчика",
  "settings.saved": "Язык интерфейса сохранён в этом браузере",
  "settings.saveError": "Не удалось сохранить настройки",
  "settings.localOnly":
    "Тема сохраняется сразу. Изменение языка требует сохранения и остаётся в этом браузере.",
  "settings.localStorageUnavailable":
    "Хранилище браузера недоступно. Черновик языка нельзя сохранить; текущий язык не изменён.",
  "settings.locale.unsaved": "Есть несохранённое изменение языка интерфейса.",
  "settings.save": "Сохранить язык",
  "settings.cancel": "Отменить изменение языка",
  "settings.status.off": "Выключено",
  "settings.status.starting": "Запускается",
  "settings.status.connected": "Подключено",
  "query.failed": "Не удалось получить данные",
  "query.offline": "Нет подключения к сети",
  "query.offlineDescription":
    "Браузер сообщает, что подключения к сети нет. Восстановите подключение и повторите попытку.",
  "query.technicalDetails": "Технические подробности",
  "query.technical.httpStatus": "Статус HTTP: {status}",
  "query.technical.diagnosticId": "Идентификатор диагностики: {diagnosticId}",
  "query.technical.code": "Код: {code}",
  "failure.operation.session.load": "Не удалось загрузить это занятие.",
  "failure.operation.session.action":
    "Не удалось сохранить изменение занятия. Повторите попытку.",
  "failure.operation.exercise.load": "Не удалось загрузить это упражнение.",
  "failure.operation.exercise.action":
    "Действие с упражнением не завершилось. Повторите попытку.",
  "failure.operation.settingsAiSave":
    "Не удалось сохранить настройки AI-ролей. Повторите попытку.",
  "failure.operation.courseCreate":
    "Не удалось создать локальный черновик курса. Повторите попытку.",
  "failure.operation.courseInstructionsDownload":
    "Не удалось скачать инструкции по авторингу. Повторите попытку.",
  "failure.operation.studioLoad": "Не удалось загрузить Curriculum Studio.",
  "failure.operation.studioAction":
    "Действие Studio не завершилось. Повторите попытку.",
  "ai.failure.disabled": "AI выключен для этой роли.",
  "ai.failure.connectionNotFound": "Выбранное AI-подключение не найдено.",
  "ai.failure.connectionDisabled": "Выбранное AI-подключение отключено.",
  "ai.failure.authenticationRequired":
    "Для выбранного AI-подключения требуется аутентификация.",
  "ai.failure.misconfigured": "Выбранное AI-подключение не настроено.",
  "ai.failure.providerUnavailable": "Выбранный AI-провайдер недоступен.",
  "ai.failure.modelUnavailable": "Выбранная AI-модель недоступна.",
  "ai.failure.capabilityUnknown":
    "Возможности выбранной модели ещё не проверены.",
  "ai.failure.capabilityMissing":
    "Выбранная модель не поддерживает эту операцию.",
  "ai.failure.toolPolicyUnavailable":
    "Требуемая политика AI-инструментов недоступна.",
  "ai.failure.disclosureRequired":
    "Чтобы продолжить, проверьте и подтвердите раскрытие данных внешнему AI.",
  "ai.failure.disclosureMismatch":
    "Раскрытие данных AI больше не соответствует этой операции. Проверьте его снова.",
  "ai.failure.invalidOutput": "Ответ AI нельзя безопасно использовать.",
  "ai.failure.budgetExceeded": "AI-операция превысила допустимый бюджет.",
  "ai.failure.cancelled": "AI-операция отменена.",
  "ai.failure.timeout":
    "Время ожидания AI-операции истекло. Повторите попытку.",
  "ai.failure.providerError": "AI-провайдер не смог завершить операцию.",
  "routeBoundary.retry": "Повторить",
  "routeBoundary.back": "Назад",
  "routeBoundary.home": "На главную",
  "routeBoundary.technicalDetails": "Технические подробности",
  "routeBoundary.error.eyebrow": "Восстановление",
  "routeBoundary.error.title": "Не удалось показать эту страницу",
  "routeBoundary.error.description":
    "Aptiloop не смог завершить загрузку этой страницы. Сохранённые учебные данные не изменены. Повторите попытку, вернитесь на предыдущую страницу или откройте главную.",
  "routeBoundary.error.reference": "Идентификатор ошибки: {digest}",
  "routeBoundary.notFound.eyebrow": "Страница не найдена",
  "routeBoundary.notFound.title": "Эта страница недоступна",
  "routeBoundary.notFound.description":
    "Ссылка могла устареть или страница могла быть перемещена. Вернитесь назад или откройте главную, чтобы продолжить обучение.",
  "ui.developerTools.title": "Инструменты разработчика",
  "ui.developerTools.description":
    "Диагностика и ручные инструменты для проверки provider lifecycle. Они не входят в основной учебный маршрут.",
  "ui.developerTools.playgroundTitle": "Agent Playground",
  "ui.developerTools.playgroundDescription":
    "Ручной диалог с выбранной ролью, моделью и видимыми tool events. Reviewer остаётся read-only и не может применять изменения.",
  "ui.developerTools.openPlayground": "Открыть Playground",
  "ui.developerTools.boundaryNote":
    "Встроенного terminal UI и произвольного shell-доступа здесь нет. Исполняемые команды выбирает только серверный allowlist.",
  "ui.messageScroller.toLast": "К последнему сообщению",
  "ui.messageScroller.toStart": "К началу",
  "ui.close": "Закрыть",
  "settings.status.degraded": "Нужна проверка",
  "settings.status.authentication": "Нужна авторизация",
  "settings.status.unavailable": "Недоступно",
  "settings.status.misconfigured": "Нужна настройка",
  "settings.status.error": "Ошибка",
  "settings.savedRoleSummary": "Сохранено: {connection} · {model}",
  "settings.unsavedWarning":
    "Есть несохранённые настройки интерфейса или назначения ролей. Сохраните их перед уходом со страницы.",
  "settings.connection.requirements":
    "Учётные данные остаются в локальном хранилище провайдера и никогда не возвращаются на эту страницу.",
  "settings.connection.emptyTitle": "Подключений пока нет",
  "settings.connection.emptyDescription":
    "Добавьте провайдера, чтобы проверить готовность и увидеть точные доступные ID моделей.",
  "settings.connection.providerKind": "Тип провайдера",
  "settings.connection.scope": "Область трафика",
  "settings.connection.modelsObserved": "Обнаружено доступных моделей",
  "settings.connection.lastChecked": "Последняя проверка готовности",
  "settings.connection.notChecked": "Ещё не проверялось",
  "settings.connection.endpoint": "Точка доступа",
  "settings.connection.credentialState": "Состояние учётных данных",
  "settings.connection.credentialStored": "Сохранены",
  "settings.connection.credentialMissing": "Требуются",
  "settings.connection.loginUnavailable":
    "Состояние авторизации у провайдера недоступно. Запустите авторизацию снова.",
  "settings.connection.answering": "Отправляю ответ…",
  "settings.connection.loginRunning": "Ожидаю ответ провайдера…",
  "settings.connection.progressUpdate":
    "Авторизация у провайдера продолжается.",
  "settings.connection.promptText": "Введите значение, запрошенное провайдером",
  "settings.connection.promptSecret": "Введите секрет, запрошенный провайдером",
  "settings.connection.promptSelect": "Выберите вариант авторизации провайдера",
  "settings.connection.promptCode": "Введите код авторизации провайдера",
  "settings.connection.promptGithubDomain": "Домен GitHub Enterprise",
  "settings.connection.promptGithubDomainDescription":
    "Необязательно. Оставьте поле пустым для входа через github.com.",
  "settings.connection.promptGithubDomainPlaceholder": "company.ghe.com",
  "settings.connection.promptGithubDomainUnsupported":
    "Домены GitHub Enterprise пока не поддерживаются. Оставьте поле пустым, чтобы использовать github.com.",
  "settings.connection.promptOpenAiLoginMethod":
    "Способ авторизации OpenAI Codex",
  "settings.connection.promptOptionBrowser":
    "Авторизация в браузере (рекомендуется)",
  "settings.connection.promptOptionDeviceCode":
    "Авторизация по коду устройства",
  "settings.connection.updating": "Обновляю…",
  "settings.connection.cancelling": "Отменяю…",
  "settings.connection.loginCancelled":
    "Авторизация у провайдера отменена. Подключение не авторизовано.",
  "ui.developerTools.compatibilityBadge": "Режим совместимости",
  "ui.developerTools.boundaryTitle": "Явные границы выполнения",
  "ui.developerTools.executionBoundary": "Выполнение команд",
  "ui.developerTools.serverAllowlist": "Только серверный список разрешений",
  "ui.developerTools.reviewerBoundary": "Роль Reviewer",
  "ui.developerTools.readOnly": "Только чтение · не применяет изменения",
  "role.courseDesigner": "Дизайнер курса",
  "role.courseDesigner.help":
    "Только предложения для черновика. Применение и публикация остаются отдельными действиями.",
  "role.tutor": "Тьютор",
  "role.tutor.help": "Безопасные объяснения и сократические подсказки.",
  "role.evaluator": "Оценщик",
  "role.evaluator.help":
    "Ограниченный вывод интервью и оценки без изменения уровня освоения.",
  "role.reviewer": "Ревьюер",
  "role.reviewer.help":
    "Только анализ подтверждений, без патчей и доступа к локальным файлам.",
  "provider.checking": "Проверяю статус AI…",
  "provider.statusUnavailable": "Статус AI недоступен",
  "provider.statusDetails": "Статус AI: открыть подробности",
  "provider.ready": "AI готов",
  "provider.off": "AI выключен",
  "provider.needsAttention": "AI требует внимания",
  "provider.title": "Необязательная AI-помощь",
  "provider.rolesReady": "Готово настроенных AI-ролей: {ready} из {total}",
  "provider.unavailable": "Недоступно",
  "provider.noModel": "Модель не выбрана",
  "provider.problem": "Одно или несколько подключений требуют настройки.",
  "provider.recoverConnections": "Проверить подключения",
  "provider.fullDiagnostics": "Открыть диагностику разработчика",
  "query.loadingSettings": "Загружаю настройки…",
  "query.settingsUnavailable": "Настройки недоступны",
  "query.retry": "Повторить",
  "chat.page.title": "Диагностика с агентом",
  "chat.page.description":
    "Необязательный ограниченный диалог для проверки рассуждений или выбранных подтверждений. Основной учебный путь остаётся в курсах и занятиях.",
  "chat.error.response": "Не удалось получить ответ.",
  "chat.status.cancelled": "Ответ остановлен.",
  "chat.status.loading": "Загружаю диалог…",
  "chat.label.you": "Ты",
  "chat.role.teacher": "Тьютор",
  "chat.role.reviewer": "Ревьюер решения",
  "chat.role.interviewer": "Интервьюер",
  "chat.role.curator": "Куратор обучения",
  "chat.role.codexExpert": "Эксперт по архитектуре",
  "chat.error.prepare":
    "Не удалось подготовить запрос. Сообщение сохранено для повторной отправки.",
  "chat.error.send":
    "Не удалось отправить запрос. Сообщение сохранено для повторной отправки.",
  "chat.error.responseDetail":
    "Не удалось получить ответ. Сообщение сохранено для повторной отправки.",
  "chat.error.emptyResponse": "Агент завершил ответ без текста.",
  "chat.a11y.roleSelector": "Роль агента",
  "chat.a11y.transcript": "История диалога с агентом",
  "chat.error.history": "История диалога временно недоступна.",
  "chat.error.settings": "Настройки провайдера временно недоступны.",
  "chat.error.recovery":
    "Не удалось проверить ожидающее разрешение на отправку внешнему AI. Данные не отправлены.",
  "chat.error.cancelDisclosure":
    "Не удалось отменить ожидающее разрешение на отправку внешнему AI. Данные не отправлены — повтори попытку.",
  "chat.error.dataUnavailable": "Данные агента временно недоступны.",
  "chat.retry": "Повторить",
  "chat.status.generating": "Агент формирует ответ",
  "chat.status.failed": "Ответ не получен",
  "chat.status.ready": "Ответ готов",
  "chat.empty.title": "Сначала сформулируй свой вопрос или ответ",
  "chat.empty.description":
    "Агент не будет писать практическое решение вместо тебя. Проверка решения работает только с зафиксированным diff.",
  "chat.empty.reloadLimitation":
    "Перезагрузка не восстанавливает неотправленный черновик или формируемый ответ.",
  "chat.a11y.typing": "Агент печатает",
  "chat.composer.label": "Сообщение агенту",
  "chat.composer.placeholder":
    "Напиши свой ответ или попроси уточняющий вопрос…",
  "chat.composer.stop": "Остановить ответ",
  "chat.composer.send": "Отправить",
  "chat.composer.configureAi": "Настроить AI",
  "chat.composer.unavailablePlaceholder":
    "Настройте доступного провайдера и модель, чтобы использовать эту диагностику.",
  "chat.composer.context": "Контекст диалога: {context}",
  "chat.tools.title": "События инструментов ({count})",
  "chat.tools.boundary": "Только чтение",
  "chat.disclosure.title": "Отправить данные внешнему AI?",
  "chat.disclosure.description":
    "Разрешение действует один раз только для указанного запроса.",
  "chat.disclosure.destination": "Получатель",
  "chat.disclosure.data": "Данные",
  "chat.disclosure.payload": "{categories} · {bytes} Б",
  "chat.disclosure.exclusions": "Не отправляется",
  "chat.disclosure.cancel": "Не отправлять",
  "chat.disclosure.approve": "Разрешить один раз",
  "review.view.due": "К повторению",
  "review.view.mistakes": "Исправления",
  "review.view.cards": "Очередь повторения",
  "review.view.interviews": "Интервью",
  "review.empty.title": "Пока ничего не назначено",
  "review.empty.description":
    "Сейчас ничего не назначено. Будущие и прошлые задания остаются в очереди повторения.",
  "review.goToCourses": "Открыть курсы",
  "review.viewDescription.due":
    "Назначенные повторения, время которых наступило, в порядке срока выполнения.",
  "review.viewDescription.mistakes":
    "Открытые исправления показывают семейство ошибки, число подтверждений и следующее детерминированное действие.",
  "review.viewDescription.cards":
    "Полная детерминированная очередь, включая выполненные, отложенные и заменённые задания.",
  "review.viewDescription.interviews":
    "Структурированная практика интервью и сохранённые наблюдения об ответах.",
  "review.dueCount": "Сейчас назначено: {count}",
  "review.actionUnavailable":
    "Повторение назначено, но безопасная активность для него пока недоступна. Aptiloop не будет подменять её повторным открытием исходного занятия.",
  "skills.loading": "Загружаю навыки…",
  "skills.unavailable": "Навыки недоступны",
  "skills.empty.title": "Подтверждений навыков пока нет",
  "skills.empty.description":
    "Выполните активность, которая записывает подтверждение. Посещение страниц не считается освоением.",
  "skills.topic": "Тема",
  "skills.evidence": "Подтверждения",
  "skills.evidenceCount": "Подтверждений: {count}",
  "skills.reviewDue": "Нужно повторить",
  "skills.level": "{value} из 5",
  "skills.scaleDescription":
    "Для каждой темы шесть независимых измерений с подтверждениями по шкале от 0 до 5.",
  "skills.dimension.understanding": "Понимание",
  "skills.dimension.explanation": "Объяснение",
  "skills.dimension.codeReading": "Чтение кода",
  "skills.dimension.implementation": "Реализация",
  "skills.dimension.debugging": "Отладка",
  "skills.dimension.interview": "Интервью",
  "mistakes.loading": "Загружаю исправления…",
  "mistakes.unavailable": "Исправления недоступны",
  "mistakes.empty.title": "Исправлений пока нет",
  "mistakes.empty.description":
    "Активности с подтверждениями могут создать детерминированные исправления и даты повторения.",
  "mistakes.repeated": "Повторилась",
  "mistakes.previous": "Семейство ошибки",
  "mistakes.correction": "Следующее исправление",
  "mistakes.occurrences": "Зафиксировано случаев: {count}",
  "mistakes.correctThroughReview":
    "Выполните назначенную активность исправления: детерминированное ядро оценит новые подтверждения.",
  "mistakes.dueDate": "Срок: {date}",
  "mistakes.whyDue": "Почему назначено",
  "mistakes.evidenceBasis": "Основа подтверждения",
  "cards.loading": "Загружаю очередь повторения…",
  "cards.unavailable": "Очередь повторения недоступна",
  "cards.empty.title": "Заданий для повторения пока нет",
  "cards.empty.description":
    "Детерминированные задания для повторения появляются после активностей с подтверждениями.",
  "cards.status.pending": "Назначено",
  "cards.status.completed": "Выполнено",
  "cards.status.dismissed": "Отложено",
  "cards.status.superseded": "Заменено",
  "cards.topic": "Узел знаний",
  "cards.reviewReason": "Причина повторения",
  "cards.reviewDetail": "{dimension} · {reason}",
  "cards.dueAt": "Срок: {date}",
  "cards.dimensionValue": "Измерение: {dimension}",
  "cards.evidenceBasis": "Основа подтверждения",
  "cards.sourceSession": "Исходная сессия {session}",
  "cards.reason.mistake": "Зафиксированная ошибка назначила это исправление.",
  "cards.reason.lowMastery":
    "Существующие подтверждения ниже детерминированного порога повторения.",
  "cards.activity.recall": "Подтверждение воспроизведением",
  "cards.activity.correction": "Подтверждение исправлением",
  "cards.dismiss": "Убрать задание из очереди",
  "cards.saveError": "Не удалось убрать задание из очереди.",
  "session.error.unknown": "Неизвестная ошибка",
  "session.loading": "Загружаю занятие…",
  "session.empty.title": "Активного занятия нет",
  "session.empty.description":
    "Откройте Главную и начните доступный урок. Здесь появится сохранённый прогресс.",
  "session.openHome": "Открыть Главную",
  "session.error.noActivities": "Snapshot занятия не содержит активностей.",
  "session.error.noProgress": "Прогресс текущей активности отсутствует.",
  "session.close": "Закрыть",
  "session.ready.description":
    "Активность доступна. Начало будет сохранено, поэтому после перезапуска занятие продолжится с этого места.",
  "session.starting": "Начинаю…",
  "session.startActivity": "Начать активность",
  "session.locked": "Сначала завершите предыдущую обязательную активность.",
  "session.lessonTitle": "Урок {order} · {title}",
  "session.phaseProgress":
    "Этап {phase} из {phaseTotal} · {name} · Активность {activity} из {activityTotal}",
  "session.lessonComplete": "Урок завершён",
  "session.phaseRemaining": "Осталось на этапе: {duration}",
  "session.plan": "Шаги урока",
  "session.continueLater": "Продолжить позже",
  "session.progress": "Прогресс урока",
  "session.transition.complete": "Этап {phase} из {total} завершён",
  "session.transition.title": "Далее: {name}",
  "session.transition.covered": "Вы разобрали:",
  "session.transition.next": "Следующий этап",
  "session.transition.meta": "{name} · Активностей: {count} · {duration}",
  "session.transition.continue": "Продолжить сейчас",
  "session.transition.back": "Вернуться позже",
  "session.transition.saved":
    "Прогресс сохранён. Занятие продолжится с этого этапа.",
  "session.checklist.title": "Что нужно сделать",
  "session.checklist.help": "Отмечайте каждый выполненный пункт.",
  "session.checklist.requiredHelp":
    " Обязательные пункты нужно отметить до завершения.",
  "session.checklist.required": "обязательно",
  "session.checklist.count": "Отмечено {checked} из {total}",
  "session.briefing.topics": "Сегодня разберём",
  "session.briefing.topicsEmpty": "Темы появятся в плане урока.",
  "session.briefing.outcomes": "После занятия сможете",
  "session.briefing.outcomesEmpty": "Результаты появятся в плане урока.",
  "session.briefing.level": "Глубина",
  "session.briefing.levelDescription":
    "Понять механизм, объяснить его самостоятельно, увидеть типичные ошибки и написать небольшой пример.",
  "session.briefing.scope": "Не рассматриваем",
  "session.briefing.scopeEmpty": "Границы записаны в плане урока.",
  "session.briefing.plan": "План",
  "session.activitiesCount": "Активностей: {count} · {duration}",
  "session.briefing.skipDescription":
    "Здесь ничего отмечать не нужно. Переходите к материалу, когда будете готовы.",
  "session.briefing.diagnostic": "Пройти диагностику без изучения",
  "session.briefing.opening": "Открываю…",
  "session.briefing.startStudy": "Перейти к изучению",
  "session.study.notes": "Заметки",
  "session.study.placeholder": "Коротко зафиксируйте механизм и вопросы…",
  "session.study.save": "Сохранить заметки",
  "session.study.complete": "Завершить изучение",
  "session.recall.saveAnswer": "Сохранить ответ {number}",
  "session.recall.firstAttempt":
    "Первая попытка для каждого вопроса сохраняется отдельно и не перезаписывается.",
  "session.recall.complete": "Завершить воспроизведение",
  "session.recall.count":
    "Сохранено ответов: {saved} из {total}. Завершение станет доступно после ответа на каждый вопрос.",
  "session.tutor.defaultPrompt": "Уточните объяснение.",
  "session.tutor.generating": "Преподаватель формулирует уточнение…",
  "session.tutor.stopped": "Ответ преподавателя остановлен",
  "session.tutor.unavailable": "Преподаватель недоступен",
  "session.tutor.emptyResponse": "Преподаватель вернул пустой ответ",
  "session.tutor.received": "Ответ преподавателя получен",
  "session.tutor.task": "Задача преподавателя",
  "session.tutor.history": "История диалога с преподавателем",
  "session.tutor.you": "Вы",
  "session.tutor.name": "Преподаватель",
  "session.tutor.emptyHistory":
    "История пуста. Отправьте уточнённое объяснение — преподаватель ответит без раскрытия эталона.",
  "session.tutor.retry": "Повторить",
  "session.tutor.followUpLabel": "Ответ на уточнение преподавателя",
  "session.tutor.revisionLabel": "Уточнённое объяснение",
  "session.tutor.followUpPlaceholder":
    "Ответьте на последний вопрос преподавателя своими словами…",
  "session.tutor.revisionPlaceholder":
    "Перепишите механизм точнее — преподаватель задаст уточняющий вопрос…",
  "session.tutor.stop": "Остановить преподавателя",
  "session.tutor.complete": "Завершить диалог",
  "session.tutor.answer": "Ответить на уточнение",
  "session.tutor.send": "Отправить объяснение",
  "session.quiz.invalid":
    "Quiz настроен некорректно: у каждого вопроса должно быть минимум два варианта ответа.",
  "session.quiz.correct": "Верно",
  "session.quiz.retryNeeded": "Нужно повторить",
  "session.quiz.score": "Серверная оценка: {score}%. Порог: {minimum}%.",
  "session.quiz.complete": "Завершить проверку",
  "session.quiz.retryDescription":
    "Первая попытка сохранена. Повторите материал и ответьте ещё раз — для прогресса учитывается последняя попытка.",
  "session.quiz.retry": "Пересдать квиз",
  "session.quiz.submitAgain": "Проверить повторно",
  "session.quiz.submit": "Проверить ответы",
  "session.code.prediction": "Предсказание",
  "session.code.explanation": "Объяснение механизма",
  "session.code.verbalFix": "Исправление словами",
  "session.code.complete": "Завершить чтение кода",
  "session.code.save": "Сохранить разбор",
  "session.practice.reviewCriteria": "Условия проверки решения",
  "session.practice.acceptance": "Критерии приёмки",
  "session.practice.constraints": "Ограничения",
  "session.practice.description":
    "Код редактируется только во внешнем редакторе. Diff, разрешённые проверки и read-only Reviewer открываются в Практике.",
  "session.practice.openReview": "Открыть проверку решения",
  "session.practice.open": "Открыть практику",
  "session.interview.topics": "Темы",
  "session.interview.reportReady":
    "Отчёт по интервью сохранён. Откройте его, затем завершите активность.",
  "session.interview.openReport": "Открыть отчёт",
  "session.interview.complete": "Завершить активность",
  "session.interview.open": "Открыть интервью",
  "session.summary.prompts": "Итоговые вопросы",
  "session.summary.quiz": "Квиз",
  "session.summary.evidence": "Подтверждения навыка",
  "session.summary.hints": "Подсказки",
  "session.summary.strengths": "Что уже получается",
  "session.summary.noStrengths": "Пока недостаточно подтверждений навыка",
  "session.summary.gaps": "Что закрепить",
  "session.summary.noGaps": "Новых пробелов не зафиксировано",
  "session.summary.counts":
    "Добавлено исправлений: {mistakes}. Кандидатов в карточки: {cards}.",
  "session.summary.completing": "Завершаю…",
  "session.summary.complete": "Завершить урок",
  "session.summary.restoreError":
    "Не удалось восстановить сохранённый итог: {error}",
  "session.summary.retry": "Повторить загрузку",
  "session.summary.loading": "Загружаю итог…",
  "session.summary.generating": "Формирую итог…",
  "session.summary.generate": "Сформировать итог",
  "session.summary.description":
    "Итог строится только из сохранённых ответов, проверок и review evidence. Браузер не выставляет мастерство и не придумывает подтверждения.",
  "session.checkpoint.confirm": "Подтвердить checkpoint",
  "session.spaced.topics": "Темы повторения",
  "session.spaced.description":
    "Повторение станет доступно в Повторении после появления серверных подтверждений навыка.",
  "session.spaced.start": "Начать серверное повторение",
  "session.sources.title": "Источники",
  "session.sources.empty": "Для этой активности источник ещё не назначен.",
  "session.sources.own":
    "Используйте свой источник рядом с Aptiloop и отмечайте пункты, когда найдёте ответы.",
  "session.sources.openEditor": "Открыть редактор курса",
  "session.sources.primary": "Основной",
  "session.sources.additional": "Дополнительный",
  "session.sources.focus": "Обратите внимание",
  "session.learningBrief.title": "Что изучить",
  "session.learningBrief.completion": "Подтверждения завершения",
  "session.completionEvidence.description":
    "Прогресс изменится только после того, как Aptiloop сохранит указанные ниже подтверждения.",
  "session.criteria.acknowledgement": "Подтвердить ознакомление с активностью",
  "session.criteria.checklist": "Отметить обязательные пункты: {count}",
  "session.criteria.attempts": "Отправить минимум попыток: {count}",
  "session.criteria.dialogue":
    "Завершить минимум реплик в диалоге с преподавателем: {count}",
  "session.criteria.dialogueWithRevision":
    "Завершить минимум реплик: {count} — и доработать ответ",
  "session.criteria.score":
    "Минимальный результат: {score}; минимум попыток: {attempts}",
  "session.criteria.fields": "Заполнить обязательные поля: {fields}",
  "session.criteria.exercise": "Завершить практическую активность",
  "session.criteria.exerciseTests": "Пройти доверенные проверки",
  "session.criteria.exerciseReview":
    "Получить принятую проверку решения в режиме только чтения",
  "session.criteria.exerciseTestsAndReview":
    "Пройти доверенные проверки и получить принятую проверку решения",
  "session.criteria.custom": "Выполнить требование курса {key}",
  "session.sources.open": "Открыть материал",
  "session.completed": "Активность завершена и сохранена",
  "courses.status.draft": "Черновик",
  "courses.status.published": "Опубликован",
  "courses.status.archived": "Архивный",
  "courses.error.validateFirst": "Сначала проверьте Course Pack.",
  "courses.error.activeSessionPinned":
    "Вернитесь к активному занятию и завершите его перед удалением Course Pack. Текущая сессия и прогресс остаются доступны.",
  "courses.notice.installed": "Course Pack установлен. Открываем учебный путь.",
  "courses.notice.draftSaved": "Course Pack сохранён как черновик.",
  "courses.notice.alreadyInstalled":
    "Эта точная ревизия Course Pack уже установлена. Открываем существующий учебный путь.",
  "courses.notice.draftAlreadySaved":
    "Этот Course Pack уже сохранён как локальный черновик. Открываем существующий черновик.",
  "courses.notice.uninstalled":
    "Course Pack удалён из активной библиотеки. История сохранена.",
  "courses.notice.selected":
    "Эта ревизия курса стала текущей. Главная будет использовать её детерминированный маршрут и следующее действие.",
  "courses.create.primaryPath": "Основной путь создания",
  "courses.create.title": "Создать курс",
  "courses.create.description":
    "Выберите, с чего начать. До публикации можно изменить всё.",
  "courses.create.action": "Создать курс",
  "courses.current.title": "Текущий курс",
  "courses.current.loading": "Загружаю текущий курс",
  "courses.current.unavailable": "Текущий курс недоступен",
  "courses.current.unavailableDescription":
    "Локальная библиотека доступна, но подтвердить текущий выбор не удалось.",
  "courses.current.revision": "Опубликованная ревизия {revision}",
  "courses.current.revisionUnavailable": "Ревизия курса недоступна",
  "courses.current.sessionActive": "Занятие продолжается",
  "courses.current.none": "Текущий курс не выбран",
  "courses.current.noneDescription":
    "Создайте курс, импортируйте Course Pack или сделайте текущей подходящую опубликованную ревизию из библиотеки.",
  "courses.page.title": "Курсы",
  "courses.page.description":
    "Проверяйте декларативный Course Pack до установки. Файл не может передавать команды, пути, учётные данные или настройки провайдера.",
  "courses.import.title": "Импорт Course Pack",
  "courses.import.description":
    "Сначала — локальная проверка и предпросмотр. Установка выполняется только отдельным подтверждённым действием.",
  "courses.import.secondaryPath": "Другой путь: импорт готового Pack",
  "courses.import.fileLabel": "JSON-файл",
  "courses.import.fileDescription":
    "UTF-8 JSON, не более 1 MiB. Невалидные исходные байты не сохраняются.",
  "courses.import.validationFailed":
    "Не удалось проверить файл {filename}. Выбранный файл сохранён: проверьте его и повторите попытку.",
  "courses.import.validate": "Проверить Pack",
  "courses.intake.title": "Проверка Course Pack",
  "courses.intake.description":
    "Этот временный результат серверной проверки восстанавливает предпросмотр и диагностику, не сохраняя байты Pack в браузере и ничего не устанавливая при загрузке.",
  "courses.intake.selectAnother": "Импортировать другой Pack",
  "courses.intake.loading": "Загружаю сохранённую проверку Course Pack",
  "courses.intake.unavailable.title":
    "Эта сохранённая проверка больше недоступна",
  "courses.intake.unavailable.description":
    "Она уже использована, истекла или неизвестна. Выберите локальный файл повторно, чтобы создать новую проверку.",
  "courses.intake.loadFailed.title": "Не удалось восстановить проверку",
  "courses.intake.loadFailed.description":
    "Безопасно прочитать сохранённую проверку не удалось. Повторите чтение или снова выберите локальный файл.",
  "courses.intake.retry": "Повторить",
  "courses.intake.reselect": "Выбрать файл повторно",
  "courses.storageUnavailable.title": "Локальное хранилище курсов недоступно",
  "courses.storageUnavailable.description":
    "Предпросмотр работает, но Aptiloop не сможет установить Course Pack или создать черновик, пока локальное хранилище недоступно. Проверьте раздел «Core и локальные пути» в Настройках и повторите попытку.",
  "courses.storageUnavailable.settings": "Открыть Core и локальные пути",
  "courses.storageUnavailable.retry": "Повторить проверку хранилища",
  "courses.alert.errorTitle": "Операция не выполнена",
  "courses.alert.successTitle": "Готово",
  "courses.library.title": "Локальная библиотека",
  "courses.library.description":
    "Все локально созданные и импортированные ревизии курсов. Выбор текущей меняет Главную и будущие сессии; действия экспорта и удаления доступны только для Course Pack.",
  "courses.library.revisionMeta": "Ревизия {revision} · {locale}",
  "courses.library.revisionNumber": "Ревизия {revision}",
  "courses.library.details": "Технические сведения",
  "courses.library.courseId": "ID курса",
  "courses.library.personalRevision": "Личная адаптация",
  "courses.library.upstreamRevision": "Исходная ревизия",
  "courses.library.branch": "Ветка ревизии",
  "courses.library.source": "Источник",
  "courses.library.revisionId": "ID ревизии",
  "courses.library.importedAt": "Импортировано из Course Pack {date}",
  "courses.library.localRevision": "Локально созданная ревизия",
  "courses.library.hashUnavailable": "Недоступен",
  "courses.library.currentHelp":
    "Главная и учебные сессии сейчас используют именно эту ревизию.",
  "courses.library.draftHelp":
    "Этот редактируемый черновик открывается в Adaptive Studio. Сделать его текущим можно только после явной публикации.",
  "courses.library.selectHelp":
    "Предпросмотр не меняет текущий курс. Действие «Сделать текущей» переключит Главную и будущие сессии на эту ревизию.",
  "courses.library.selectionUnknownHelp":
    "Текущий выбор недоступен, поэтому сейчас переключиться на эту ревизию здесь нельзя.",
  "courses.library.notSelectableHelp":
    "Эта запись библиотеки не является подходящей опубликованной ревизией. Предпросмотр остаётся доступен только для чтения.",
  "courses.library.revisions": "Ревизий: {count}",
  "courses.library.loading": "Загрузка библиотеки курсов",
  "courses.library.empty.title": "Локальных курсов пока нет",
  "courses.library.empty.description":
    "Создайте курс в Adaptive Studio или выберите JSON Course Pack выше, чтобы проверить происхождение и требования перед установкой.",
  "courses.library.filteredEmpty.title": "Курсы не найдены",
  "courses.library.filteredEmpty.description":
    "Измените запрос или сбросьте фильтр статуса.",
  "courses.library.results": "Показано {start}–{end} из {total}",
  "courses.search.label": "Поиск курсов",
  "courses.search.placeholder": "Найти курс…",
  "courses.filter.action": "Фильтр",
  "courses.filter.label": "Статус курса",
  "courses.filter.all": "Все курсы",
  "courses.filter.clear": "Сбросить фильтры",
  "courses.table.course": "Курс",
  "courses.table.revisionStatus": "Ревизия и статус",
  "courses.table.progress": "Прогресс",
  "courses.table.actions": "Действия",
  "courses.progress.notStarted": "Не начат",
  "courses.progress.inProgress": "В процессе",
  "courses.progress.completed": "Завершён",
  "courses.progress.neverOpened": "Учебной активности ещё не было",
  "courses.progress.lastActivity": "Последняя активность: {date}",
  "courses.progress.label":
    "Выполнено {percent}%, уроков завершено: {completed} из {total}",
  "courses.pagination.label": "Страницы курсов",
  "courses.pagination.previous": "Предыдущая страница",
  "courses.pagination.next": "Следующая страница",
  "courses.preview.empty.title": "Предпросмотр появится здесь",
  "courses.preview.empty.description":
    "Установка недоступна, пока схема, ссылки, граф, хэши и policy gates не пройдут проверку.",
  "courses.preview.rejected": "Pack отклонён",
  "courses.preview.errors": "Ошибок: {count}",
  "courses.preview.validated": "Проверенный предпросмотр",
  "courses.preview.ready": "Готов к установке",
  "courses.validation.expired.badge": "Проверка истекла",
  "courses.validation.expired.title": "Срок проверки истёк",
  "courses.validation.expired.description":
    "Этот результат проверки больше нельзя использовать. Снова выберите и проверьте локальный файл перед установкой или созданием черновика.",
  "courses.validation.expired.revalidate": "Проверить файл повторно",
  "courses.revision": "{courseKey} · ревизия {revision}",
  "courses.preview.metric.lessons": "Уроки",
  "courses.preview.metric.activities": "Активности",
  "courses.preview.metric.language": "Язык",
  "courses.preview.metric.sources": "Источники",
  "courses.preview.sourcesValue":
    "{publicCount} открытых / {privateCount} закрытых",
  "courses.preview.contentHash": "Хэш содержимого",
  "courses.preview.requirement.activityTypes": "Типы активностей",
  "courses.preview.requirement.trustedChecks": "Доверенные проверки",
  "courses.preview.requirement.environments": "Контракты сред",
  "courses.preview.requirement.provenance": "Происхождение",
  "courses.preview.noLicenseClaim": "Лицензия проекта не заявлена",
  "courses.preview.notRequired": "Не требуются",
  "courses.action.installAndOpen": "Установить и открыть",
  "courses.action.openAsDraft": "Открыть как черновик",
  "courses.confirm.description":
    "Перед продолжением проверьте точную ревизию, локальное назначение и последствие действия.",
  "courses.confirm.revision": "Ревизия",
  "courses.confirm.contentHash": "Хэш содержимого",
  "courses.confirm.destination": "Назначение",
  "courses.confirm.consequence": "Последствие",
  "courses.confirm.install.title": "Установить эту неизменяемую ревизию?",
  "courses.confirm.install.destination":
    "Локальная библиотека курсов, затем учебный маршрут только для чтения",
  "courses.confirm.install.consequence":
    "Импортированная опубликованная ревизия неизменяема: её нельзя редактировать на месте.",
  "courses.confirm.install.action": "Установить неизменяемую ревизию",
  "courses.confirm.draft.title": "Создать этот локальный черновик?",
  "courses.confirm.draft.destination":
    "Локальный редактируемый черновик в Adaptive Studio",
  "courses.confirm.draft.consequence":
    "Исходный Pack останется неизменным; публикация выполняется отдельным явным действием.",
  "courses.confirm.draft.action": "Создать локальный черновик",
  "courses.commitFailed.title": "Локальное изменение не завершено",
  "courses.commitFailed.description":
    "Запрос отклонён или Aptiloop не смог подтвердить его завершение. Проверка и окно подтверждения сохранены. Повторите попытку, когда будете готовы: повторный запрос безопасен.",
  "courses.commitFailed.retry": "Повторить локальное изменение",
  "courses.action.open": "Открыть",
  "courses.action.continue": "Продолжить",
  "courses.action.edit": "Редактировать",
  "courses.action.unavailable": "Недоступно",
  "courses.action.openCurrent": "Открыть текущий курс",
  "courses.action.openStudio": "Открыть в Adaptive Studio",
  "courses.action.previewRevision": "Предпросмотр ревизии",
  "courses.action.makeCurrent": "Сделать текущей",
  "courses.action.export": "Экспорт",
  "courses.action.remove": "Удалить",
  "courses.action.more": "Другие действия для курса «{title}»",
  "courses.remove.title": "Удалить Course Pack из библиотеки?",
  "courses.remove.description":
    "Ревизия {revisionId} станет архивной. Course Pack, сессии и факты обучения не удаляются, чтобы replay и история оставались проверяемыми.",
  "courses.action.cancel": "Отмена",
  "courses.action.removeFromLibrary": "Удалить из библиотеки",
  "courses.export.error": "Не удалось экспортировать ({status})",
  "practice.error.protectedField":
    "Получено защищённое поле учебного материала",
  "practice.error.noActiveSession": "Активного занятия нет",
  "practice.error.exerciseNotLoaded": "Упражнение ещё не загружено",
  "practice.error.attemptRequired": "Сначала создайте попытку",
  "practice.error.diffChanged":
    "Файлы изменились после последнего diff. Обновите diff и снова запустите тесты.",
  "practice.error.zedUnavailable": "Zed недоступен для этой рабочей области.",
  "practice.error.completionEvidenceUnavailable":
    "Серверные подтверждения навыка для завершения ещё не готовы",
  "practice.error.unavailable": "Упражнение недоступно",
  "practice.error.disclosureApprovalFailed":
    "Не удалось подтвердить отправку данных.",
  "practice.loading": "Загружаю практику…",
  "practice.locked.title": "Практика откроется по ходу занятия",
  "practice.locked.description":
    "Сначала завершите обязательные объяснения, recall, квиз и чтение кода. Условие упражнения появится только на своём шаге.",
  "practice.locked.emptyTitle": "Текущий шаг ещё не практика",
  "practice.locked.emptyDescription":
    "Вернитесь в занятие: там уже отмечен один следующий доступный шаг.",
  "practice.backToLesson": "Вернуться к занятию",
  "practice.nextAction.createAttempt": "Создайте изолированную попытку.",
  "practice.nextAction.editAndRefreshDiff":
    "Внесите самостоятельную правку в Zed, затем обновите Git diff.",
  "practice.nextAction.runTests":
    "Запустите разрешённые тесты на текущем diff.",
  "practice.nextAction.fixAndRetest": "Исправьте код и снова запустите тесты.",
  "practice.nextAction.retestChangedWorkspace":
    "Код изменился после теста — запустите тесты повторно.",
  "practice.nextAction.requestReview":
    "Тесты прошли. Теперь запросите проверку решения.",
  "practice.nextAction.applyFindings":
    "Примените замечания самостоятельно и повторите diff → тесты → проверку решения.",
  "practice.nextAction.accepted":
    "Проверка решения принята — сохраните подтверждения навыка и вернитесь к занятию.",
  "practice.workspace.copied": "Идентификатор рабочей области скопирован.",
  "practice.workspace.copyFailed": "Не удалось скопировать идентификатор.",
  "practice.disclosure.cancelled":
    "Данные не отправлены. Проверку можно запросить позже.",
  "practice.duration": "≈ {duration}",
  "practice.work.label": "Работа над упражнением",
  "practice.completionCriteria": "Готово, когда",
  "practice.constraints": "Ограничения",
  "practice.workspace.title": "Изолированная рабочая область",
  "practice.workspace.identity": "{id} · поколение {generation}",
  "practice.workspace.pending": "Будет создана сервером после начала попытки.",
  "practice.workspace.copyId": "Скопировать ID",
  "practice.workspace.opening": "Открываю…",
  "practice.workspace.open": "Открыть в Zed",
  "practice.workspace.creating": "Создаю…",
  "practice.workspace.create": "Создать попытку",
  "practice.nextAction.label": "Следующий шаг:",
  "practice.diff.refreshing": "Обновляю diff…",
  "practice.diff.refresh": "Обновить Git diff",
  "practice.tests.running": "Тестирую…",
  "practice.tests.run": "Запустить тесты",
  "practice.tests.stop": "Остановить тесты",
  "practice.review.running": "Проверка читает…",
  "practice.review.request": "Запросить проверку",
  "practice.review.stop": "Остановить проверку",
  "practice.operation.stopped":
    "Остановлено. Результат этой операции не применён.",
  "practice.diff.title": "Diff от baseline",
  "practice.diff.empty": "Diff появится после первой самостоятельной правки.",
  "practice.diff.truncated": "Diff обрезан серверным лимитом.",
  "practice.testRun.title": "Последний test run",
  "practice.testRun.output": "{output}\n\nexit code: {exitCode}",
  "practice.testRun.empty": "Тесты ещё не запускались.",
  "practice.testRun.status.passed": "Тесты прошли на текущем diff",
  "practice.testRun.status.failed": "Тесты не прошли",
  "practice.testRun.status.running": "Тесты выполняются",
  "practice.testRun.status.cancelled": "Запуск тестов отменён",
  "practice.testRun.status.timedOut": "Время запуска тестов истекло",
  "practice.testRun.status.resourceLimit": "Достигнут лимит вывода тестов",
  "practice.testRun.status.unsupportedEnvironment":
    "Доверенная среда недоступна",
  "practice.testRun.status.backendError": "Trusted check недоступен",
  "practice.testRun.status.stale": "Код изменён после теста",
  "practice.sidebar.label": "Проверка и темы",
  "practice.topics.title": "Тренируемые темы",
  "practice.reviewer.title": "Reviewer",
  "practice.reviewer.status.accepted": "Принято",
  "practice.reviewer.status.changesRequested": "Нужны изменения",
  "practice.reviewer.status.notRun": "Не запускался",
  "practice.evidenceBundle.title": "Капсула доказательств",
  "practice.evidenceBundle.snapshot": "snapshot {hash}",
  "practice.reviewer.hint": "hint {level}",
  "practice.reviewer.empty":
    "Review становится доступен после изменённого diff и успешного теста на текущих файлах. Он остаётся read-only.",
  "practice.reviewer.accepting": "Сохраняю подтверждения навыка…",
  "practice.reviewer.accept": "Принять проверку и продолжить",
  "practice.reviewer.changesRequested":
    "Исправьте код в Zed, снова запустите тесты и запросите новое review. Текущее review не завершает юнит.",
  "practice.disclosure.title": "Отправить evidence внешнему AI?",
  "practice.disclosure.description":
    "Reviewer получит только зафиксированный bundle. Разрешение действует один раз.",
  "practice.disclosure.destination": "Получатель",
  "practice.disclosure.data": "Данные",
  "practice.disclosure.dataSummary": "{categories} · {bytes} bytes",
  "practice.disclosure.exclusions": "Не отправляется",
  "practice.disclosure.cancel": "Не отправлять",
  "practice.disclosure.approveOnce": "Разрешить один раз",
  "interview.title": "Техническое интервью",
  "interview.returnToSession": "Вернуться к занятию",
  "interview.loading": "Загружаю интервью…",
  "interview.error.validation.manualTopics":
    "Укажите хотя бы одну тему через запятую.",
  "interview.error.validation.emptyScope":
    "Для этого режима пока нет тем — выберите «Выбрать вручную».",
  "interview.error.validation.setup":
    "Проверьте темы, сложность и количество вопросов.",
  "interview.error.start": "Не удалось начать интервью.",
  "interview.error.answerRetry":
    "{error} Ответ сохранён в форме — можно повторить запрос.",
  "interview.error.answer":
    "Следующий вопрос не получен. Ответ сохранён в форме.",
  "interview.error.finish": "Не удалось завершить интервью.",
  "interview.error.disclosureApprove":
    "Не удалось подтвердить отправку данных.",
  "interview.error.disclosureCancel":
    "Не удалось отменить ожидающую отправку. Данные не отправлены.",
  "interview.error.disclosureCanceled":
    "Данные не отправлены. Интервью можно продолжить позже.",
  "interview.error.invalidPayload":
    "Сохранённые данные интервью не прошли проверку. Защищённые данные не показаны.",
  "interview.error.scopeMismatch":
    "Не удалось подтвердить сессию интервью. Вернитесь к занятию и повторите попытку.",
  "interview.error.associationMismatch":
    "Это интервью не относится к запрошенной сессии занятия.",
  "interview.error.load": "Не удалось загрузить интервью. Повторите попытку.",
  "interview.error.unknown": "Неизвестная ошибка",
  "interview.scope.studied.label": "Только изученные",
  "interview.scope.studied.description":
    "Темы дней, где уже есть начатые или завершённые шаги.",
  "interview.scope.currentWeek.label": "Текущая неделя",
  "interview.scope.currentWeek.description":
    "Темы недели с текущим или ближайшим доступным днём (по умолчанию — неделя 1).",
  "interview.scope.manual.label": "Выбрать вручную",
  "interview.scope.manual.description": "Свои темы через запятую.",
  "interview.scope.all.label": "Полная диагностика",
  "interview.scope.all.description": "Все темы всех дней маршрута.",
  "interview.disclosure.title": "Отправить данные внешнему AI?",
  "interview.disclosure.description":
    "Разрешение действует один раз для следующего вопроса интервью.",
  "interview.disclosure.recipient": "Получатель",
  "interview.disclosure.data": "Данные",
  "interview.disclosure.payload": "{categories} · {bytes} Б",
  "interview.disclosure.exclusions": "Не отправляется",
  "interview.disclosure.decline": "Не отправлять",
  "interview.disclosure.approve": "Разрешить один раз",
  "interview.setup.description":
    "Настрой темы и формат. Интервьюер задаёт по одному вопросу; отчёт фиксирует наблюдения об ответах, но не подтверждает техническую корректность.",
  "interview.setup.workflow": "Отдельный процесс",
  "interview.setup.title": "Настройка интервью",
  "interview.setup.help":
    "Здесь задаётся только учебная рамка: область тем, сложность и количество вопросов.",
  "interview.setup.scope": "Область тем",
  "interview.setup.manualTopics": "Темы через запятую",
  "interview.setup.topics": "Темы для интервью",
  "interview.setup.selectedTopicsAria": "Темы выбранного режима",
  "interview.setup.loadingTopics": "Загружаю темы учебного маршрута…",
  "interview.setup.topicsLoadError":
    "Не удалось загрузить темы маршрута. Можно повторить или выбрать темы вручную.",
  "interview.setup.retryTopics": "Повторить",
  "interview.setup.chooseManual": "Выбрать вручную",
  "interview.setup.noStudiedTopics":
    "Пока нет изученных тем: в маршруте нет дней с начатыми или завершёнными шагами. Начни занятие на учебном пути или выбери темы вручную.",
  "interview.setup.noTopics": "В маршруте пока нет тем для этого режима.",
  "interview.setup.durationEstimate":
    "Оценка длительности: {duration} · Вопросов: {count} × ~5 мин",
  "interview.setup.reportLimit":
    "Отчёт оценивает структуру и полноту ответа, а не техническую корректность.",
  "interview.setup.difficulty": "Сложность",
  "interview.setup.difficulty.foundation": "Фундамент",
  "interview.setup.difficulty.interviewReady": "Готовность к интервью",
  "interview.setup.difficulty.deepDive": "Глубокий разбор",
  "interview.setup.questionCount": "Количество вопросов",
  "interview.setup.starting": "Формирую первый вопрос…",
  "interview.setup.start": "Начать интервью",
  "interview.opening.description":
    "Настройка сохранена, но первый вопрос ещё не получен.",
  "interview.opening.status": "Ожидает запуска",
  "interview.opening.errorTitle": "Не удалось получить первый вопрос",
  "interview.opening.retryDescription":
    "Темы: {topics}. Повтор использует тот же operation ID и не создаёт дубликат.",
  "interview.opening.retrying": "Повторяю…",
  "interview.opening.retry": "Повторить запуск",
  "interview.session.description":
    "Отвечай на текущий вопрос. История диалога и прогресс сохраняются сервером после каждого шага.",
  "interview.session.questionProgress": "Вопрос {current} из {total}",
  "interview.session.answeredProgress": "Отвечено: {answered} из {total}",
  "interview.chat.interviewer": "Интервьюер",
  "interview.chat.you": "Вы",
  "interview.chat.typing": "Интервьюер печатает…",
  "interview.chat.transcript": "История технического интервью",
  "interview.chat.readyDescription":
    "Сервер сформирует честный отчёт по сохранённой истории диалога. Без отдельной проверки техническая корректность не считается подтверждённой.",
  "interview.chat.finishing": "Формирую отчёт…",
  "interview.chat.finish": "Завершить и открыть отчёт",
  "interview.chat.messageLabel": "Сообщение",
  "interview.chat.placeholder": "Напиши ответ на вопрос интервьюера…",
  "interview.chat.sendAria": "Отправить ответ",
  "interview.chat.retryAria": "Повторить запрос",
  "interview.report.title": "Отчёт по интервью",
  "interview.report.description":
    "Что получилось и что стоит повторить. Оценка структуры и полноты ответов.",
  "interview.report.completed": "Завершено",
  "interview.report.limitsAria": "Границы оценки",
  "interview.report.limits":
    "Оценена структура и полнота ответа. Техническая корректность не проверялась.",
  "interview.report.summary": "Наблюдения об ответах",
  "interview.report.metricsAria": "Метрики интервью",
  "interview.report.metric.asked": "Задано",
  "interview.report.metric.answered": "Отвечено",
  "interview.report.metric.completion": "Полнота",
  "interview.report.strengths": "Сильные стороны",
  "interview.report.growthAreas": "Зоны роста",
  "interview.report.evidence": "Фрагменты ответов и наблюдения",
  "interview.report.question": "Вопрос {number}",
  "interview.report.answerExcerpt": "«{excerpt}»",
  "interview.report.new": "Новое интервью",
  "interview.report.nextTitle": "Продолжить практику",
  "interview.report.nextDescription":
    "Начните новое интервью, когда будете готовы разобрать следующую тему.",
  "authoring.page.title": "Редактор программы",
  "authoring.page.description":
    "Создавайте версионный граф недель, дней и юнитов. Опубликованные ревизии неизменяемы; продолжение работы начинается с клона-черновика.",
  "authoring.addWeek.aiUnavailable":
    "AI-генерация черновика недоступна в этой сборке.",
  "authoring.addWeek.cardDescription":
    "Название, цель, темы и количество дней. Черновик-ревизия, неделя и дни создадутся автоматически.",
  "authoring.addWeek.commaSeparated": "Через запятую.",
  "authoring.addWeek.create": "Создать неделю и дни",
  "authoring.addWeek.creating": "Создаю…",
  "authoring.addWeek.daysCount": "Количество дней",
  "authoring.addWeek.goalPlaceholder": "Чему научится ученик за эту неделю",
  "authoring.addWeek.outcomesPlaceholder":
    "Объяснить Event Loop, применить async/await",
  "authoring.addWeek.sheetDescription":
    "Черновик-ревизия (при необходимости), неделя и дни создаются автоматически. Правки и публикация — вручную, как обычно.",
  "authoring.addWeek.title": "Добавить следующую неделю",
  "authoring.addWeek.titlePlaceholder": "Например: Асинхронность в JavaScript",
  "authoring.addWeek.topicsPlaceholder": "Promise, async/await, Event Loop",
  "authoring.addWeek.weekGoal": "Цель недели",
  "authoring.addWeek.weekTitle": "Название недели",
  "authoring.clone.submit": "Клонировать в черновик",
  "authoring.common.back": "Назад",
  "authoring.common.cancel": "Отмена",
  "authoring.common.continue": "Продолжить",
  "authoring.common.edit": "Изменить",
  "authoring.createDraft.submit": "Создать черновик",
  "authoring.createDraft.summary": "Создать новую редакцию",
  "authoring.createDraft.creating": "Создаю локальный черновик…",
  "authoring.entry.eyebrow": "Adaptive Studio",
  "authoring.entry.title": "Выберите, как начать этот курс",
  "authoring.entry.description":
    "Выберите вариант, который подходит вашей модели. Внешний путь возвращает Course Pack для импорта, а подключённый начинается с явного локального черновика. Ни один путь не публикует курс.",
  "authoring.entry.choose": "Выберите один путь создания курса",
  "authoring.entry.manual.title": "Создать вручную",
  "authoring.entry.manual.badge": "Работает без AI",
  "authoring.entry.manual.description":
    "Начните с полного типизированного редактора недель, дней, юнитов и защищённых полей авторинга.",
  "authoring.entry.manual.next":
    "Создайте локальный черновик ниже, затем соберите его структуру в полном ручном редакторе.",
  "authoring.entry.designer.title": "Описать учебную цель",
  "authoring.entry.designer.badge": "AI необязателен · нужна проверка",
  "authoring.entry.designer.description":
    "Начните с направляемого Course Designer. AI возвращает только типизированное предложение, которое вы проверяете перед применением.",
  "authoring.entry.designer.next":
    "Назовите курс и опишите учебную цель. Будет создан редактируемый локальный черновик, а Designer откроется с готовой целью для предложения.",
  "authoring.entry.unselected":
    "Выберите путь, чтобы открыть общие данные локального черновика. Ни один вариант не выбран заранее.",
  "authoring.entry.continueHint": "Выберите путь, чтобы продолжить",
  "authoring.entry.continueReady": "Перейти к общему брифу курса",
  "authoring.entry.assistedTitle": "Выберите вариант с помощником",
  "authoring.entry.assistedDescription":
    "Ориентируйтесь на модель, которая у вас действительно есть. Aptiloop проверяет техническую совместимость подключённых моделей, но не оценивает их силу и качество результата.",
  "authoring.external.title": "Использовать внешнюю модель",
  "authoring.external.description":
    "Опишите курс один раз и скачайте самодостаточную инструкцию с точной схемой и шаблоном Course Pack V1.",
  "authoring.external.guidance":
    "Выберите этот путь, если другая модель лучше рассуждает, держит больше контекста, умеет искать в интернете или располагает нужными инструментами.",
  "authoring.external.badge": "Aptiloop ничего не отправляет",
  "authoring.external.start": "Подготовить инструкцию",
  "authoring.external.pageDescription":
    "Заполните бриф и скачайте один файл-инструкцию. Передайте его выбранной модели, а полученный JSON загрузите только через импорт Course Pack.",
  "authoring.external.form": "Бриф для внешней модели",
  "authoring.external.privacyTitle": "Передача внешней модели",
  "authoring.external.privacyDescription":
    "В скачанном файле будут только этот бриф и встроенные правила совместимого формата. Aptiloop не связывается с моделью и не получает результат автоматически. Не добавляйте в бриф секреты.",
  "authoring.external.download": "Скачать файл-инструкцию",
  "authoring.external.downloaded": "Инструкция для авторинга скачана.",
  "authoring.external.downloadError":
    "Не удалось подготовить файл-инструкцию для авторинга.",
  "authoring.external.uploadResult": "Загрузить полученный Course Pack",
  "authoring.external.nextStep":
    "Модель должна вернуть один UTF-8 JSON-документ. Считайте его недоверенным и проверьте на /courses/import.",
  "authoring.connected.title": "Использовать подключённый Course Designer",
  "authoring.connected.description":
    "Создайте явный локальный черновик из того же брифа и откройте Designer для типизированных предложений к этому черновику.",
  "authoring.connected.guidance":
    "Выберите этот путь, если настроенная модель технически готова, а её контекст и качество рассуждений подходят для курса. Готовность проверяется на следующем экране.",
  "authoring.connected.badge": "Нужна проверка возможностей",
  "authoring.connected.start": "Проверить подключённую модель",
  "authoring.connected.pageDescription":
    "Перед созданием локального черновика Aptiloop покажет точного провайдера, модель и наблюдаемые технические возможности. Качество модели оцениваете вы.",
  "authoring.connected.form": "Бриф для подключённого Course Designer",
  "authoring.connected.readinessTitle": "Готовность Course Designer",
  "authoring.connected.state.checking": "Проверка",
  "authoring.connected.state.ready": "Технически готово",
  "authoring.connected.state.off": "AI выключен",
  "authoring.connected.state.unavailable": "Недоступно",
  "authoring.connected.state.unknown": "Возможности неизвестны",
  "authoring.connected.state.unsupported": "Возможность недоступна",
  "authoring.connected.stateDescription.checking":
    "Читаем серверные данные о провайдере, модели и её возможностях.",
  "authoring.connected.stateDescription.ready":
    "Точная выбранная модель доступна, а наблюдаемые возможности провайдера соответствуют сохранённому контракту роли Course Designer.",
  "authoring.connected.stateDescription.off":
    "Для Course Designer выбран режим без AI. Внешняя инструкция и полный ручной авторинг остаются доступны.",
  "authoring.connected.stateDescription.unavailable":
    "Выбранное подключение или модель сейчас недоступны. Aptiloop не подменит провайдера и не включит Mock.",
  "authoring.connected.stateDescription.unknown":
    "У Aptiloop нет актуального снимка возможностей этого допустимого подключения. Можно продолжить: сервер проверит точную роль и при необходимости вернёт структурированную ошибку.",
  "authoring.connected.stateDescription.unsupported":
    "У точной модели или подключения нет обязательной возможности: {capability}.",
  "authoring.connected.refresh": "Обновить",
  "authoring.connected.evidence.model": "Точная модель",
  "authoring.connected.evidence.tools": "Типизированные инструменты",
  "authoring.connected.evidence.transport": "Поток и отмена",
  "authoring.connected.evidence.observedAt": "Снимок возможностей",
  "authoring.connected.evidence.observed": "Подтверждено",
  "authoring.connected.evidence.notAvailable": "Недоступно",
  "authoring.connected.qualityNote":
    "Техническая готовность — не оценка силы модели. Если ей не хватает контекста, поиска или рассуждений, используйте путь с внешним файлом-инструкцией.",
  "authoring.connected.create": "Создать черновик и открыть Designer",
  "authoring.connected.openSettings": "Открыть настройки AI",
  "authoring.connected.nextStep":
    "Это действие создаст один локальный редактируемый черновик. Передача провайдеру, применение предложения, Preview и публикация останутся отдельными действиями.",
  "authoring.connected.alternatives": "Продолжить другим способом",
  "authoring.brief.title": "Бриф курса",
  "authoring.brief.description":
    "Один и тот же бриф подходит для обоих вариантов и хранится в этом браузере, пока вы явно его не очистите.",
  "authoring.brief.topicGoal": "Тема или учебная цель",
  "authoring.brief.topicGoalPlaceholder":
    "Например: Практический асинхронный JavaScript",
  "authoring.brief.targetOutcome": "Целевой результат",
  "authoring.brief.targetOutcomePlaceholder":
    "Что ученик должен уметь самостоятельно объяснить, выбрать или собрать?",
  "authoring.brief.currentLevel": "Текущий уровень",
  "authoring.brief.currentLevelPlaceholder":
    "Например: Знает синтаксис JavaScript, но не знаком с конкурентностью",
  "authoring.brief.primaryLocale": "Основная локаль курса",
  "authoring.brief.primaryLocalePlaceholder": "Выберите язык курса",
  "authoring.brief.primaryLocaleOther": "Другая локаль BCP 47…",
  "authoring.brief.primaryLocaleCustomLabel": "Пользовательская локаль курса",
  "authoring.brief.primaryLocaleDescription":
    "Укажите локаль BCP 47, например en-US, ru-RU, de-DE или ja-JP. Она не зависит от языка интерфейса.",
  "authoring.brief.primaryLocaleError":
    "Укажите корректную локаль курса BCP 47, например en-US или ru-RU.",
  "authoring.brief.pacing": "Темп и доступное время",
  "authoring.brief.pacingPlaceholder":
    "Например: 30 минут в день в течение четырёх недель",
  "authoring.brief.tools": "Инструменты и доступ",
  "authoring.brief.accessibility": "Потребности доступности",
  "authoring.brief.constraints": "Другие ограничения",
  "authoring.brief.optionalPlaceholder":
    "Необязательно — только важные условия",
  "authoring.brief.clear": "Очистить бриф",
  "authoring.brief.savedLocally":
    "Сохранено локально в этом браузере. Ввод текста сам по себе никуда его не отправляет.",
  "authoring.brief.storageErrorTitle": "Не удалось сохранить бриф",
  "authoring.brief.storageErrorDescription":
    "Можно продолжить в этой вкладке, но после перезагрузки бриф может пропасть. Скопируйте важные данные перед выходом.",
  "authoring.brief.validationError":
    "Заполните обязательные поля брифа и укажите корректную локаль курса BCP 47.",
  "authoring.manual.fallback": "Создать вручную без AI",
  "authoring.manual.fallbackDescription":
    "Создайте пустой локальный черновик и используйте полный структурированный редактор. Этот путь доступен при любом состоянии провайдера.",
  "authoring.manual.start": "Создать пустой черновик",
  "authoring.manual.form": "Данные ручного черновика курса",
  "authoring.creation.error": "Не удалось создать локальный черновик.",
  "authoring.details.title": "Данные курса",
  "authoring.details.manualTitle": "Данные курса",
  "authoring.details.designerTitle": "Учебная цель",
  "authoring.creation.learningGoal": "Чего должен достичь ученик?",
  "authoring.creation.learningGoalPlaceholder":
    "Например: самостоятельно собрать и объяснить небольшой асинхронный сценарий на JavaScript без пошаговых подсказок.",
  "authoring.creation.designerGuardrailTitle": "Сначала редактируемый черновик",
  "authoring.creation.designerGuardrailDescription":
    "Designer может только предложить изменения. Вы проверяете и явно применяете их; публикация остаётся отдельным действием.",
  "authoring.manual.eyebrow": "Ручной авторинг",
  "authoring.manual.title": "Структура курса",
  "authoring.manual.description":
    "Редактируйте каждую типизированную неделю, день и юнит напрямую. Ручной авторинг полностью доступен при выключенном AI.",
  "authoring.workspace.aria": "Рабочая область Course Studio",
  "authoring.workspace.program": "Программа",
  "authoring.workspace.designer": "Designer",
  "authoring.workspace.preview": "Предпросмотр",
  "authoring.workspace.release": "Выпуск",
  "authoring.workspace.history": "История и адаптация",
  "authoring.workspace.designerUnavailable.title":
    "Для Designer нужен редактируемый черновик",
  "authoring.workspace.designerUnavailable.description":
    "Клонируйте неизменяемую ревизию в черновик, прежде чем запрашивать или применять предложение.",
  "authoring.workspace.releaseUnavailable.title": "Эта ревизия уже неизменяема",
  "authoring.workspace.releaseUnavailable.description":
    "Опубликованную ревизию нельзя выпустить повторно. Клонируйте её в черновик, чтобы подготовить новую.",
  "authoring.preview.eyebrow": "Предпросмотр ученика",
  "authoring.preview.loading": "Загружаю предпросмотр ученика",
  "authoring.preview.unavailable":
    "Предпросмотр ученика недоступен. Ревизия курса не была изменена.",
  "authoring.preview.emptyTitle": "Пока нечего показывать",
  "authoring.preview.emptyDescription":
    "Добавьте занятие и хотя бы одну учебную активность в «Программе», затем вернитесь в предпросмотр.",
  "authoring.preview.lessonMeta": "Активностей: {activities} · {minutes} мин",
  "authoring.error.actionTitle": "Действие Studio не завершилось",
  "authoring.release.checking": "Проверяю…",
  "authoring.release.ready": "Готово к явной публикации",
  "authoring.publish.publishing": "Публикую неизменяемую ревизию…",
  "authoring.current.draftCreatedAt": "Черновик создан {date}",
  "authoring.current.label": "Текущая программа",
  "authoring.current.publishedAt": "Опубликована {date}",
  "authoring.current.structure": "{weeks} · {days}",
  "authoring.current.structureLoading": "Недели и дни загружаются…",
  "authoring.current.primaryLocale": "Язык курса: {locale}",
  "authoring.current.branchUpstream": "Исходная ветка",
  "authoring.current.branchPersonal": "Личная ветка",
  "authoring.current.parent": "Родитель: {id}",
  "authoring.current.saving": "Сохраняю…",
  "authoring.current.saved": "Сохранено",
  "authoring.current.saveFailed": "Сохранение не удалось",
  "authoring.current.hashDetails": "Данные целостности ревизии",
  "authoring.current.contentHash": "Хеш опубликованного содержимого",
  "authoring.current.baseHash": "Неизменяемый базовый хеш",
  "authoring.adaptation.confirm.description":
    "Будет создан новый личный черновик. Текущая опубликованная личная ревизия и исходная ревизия не изменятся, пока вы не проверите и не опубликуете его.",
  "authoring.adaptation.confirm.keep-personal":
    "Сохранить личный материал и перенести точку сравнения на новую исходную ревизию?",
  "authoring.adaptation.confirm.use-upstream":
    "Начать следующий личный черновик с материала новой исходной ревизии?",
  "authoring.adaptation.conflicts":
    "Проверьте пересекающиеся изменения: {count}",
  "authoring.adaptation.create": "Создать личную адаптацию",
  "authoring.adaptation.currentDescription":
    "Личная ветка основана на текущей исходной ревизии.",
  "authoring.adaptation.description":
    "Редактируйте локальную личную ветку. Личная публикация никогда не заменяет исходную ревизию курса.",
  "authoring.adaptation.eyebrow": "Локальная ветка",
  "authoring.adaptation.integrate": "Создать черновик интеграции",
  "authoring.adaptation.keepPersonal": "Сохранить личную версию",
  "authoring.adaptation.personal.empty": "Личных ревизий пока нет.",
  "authoring.adaptation.personal.title": "Личные ревизии",
  "authoring.adaptation.status.clean": "Есть обновление · без конфликтов",
  "authoring.adaptation.status.conflict":
    "Есть обновление · проверьте конфликты",
  "authoring.adaptation.status.current": "Актуально",
  "authoring.adaptation.title": "Личная адаптация",
  "authoring.adaptation.unavailable": "Личная адаптация недоступна.",
  "authoring.adaptation.upstream.empty": "Нет опубликованной исходной ревизии.",
  "authoring.adaptation.upstream.title": "Исходные ревизии",
  "authoring.adaptation.useUpstream": "Использовать исходную версию",
  "authoring.revision.short": "рев. {revision}",
  "authoring.day.add": "Добавить день",
  "authoring.day.form.add": "Добавить день",
  "authoring.day.form.edit": "Редактировать день {title}",
  "authoring.day.meta": "День {number} · {id} · {minutes} мин",
  "authoring.day.save": "Сохранить день",
  "authoring.delete.button": "Удалить {label}",
  "authoring.delete.confirm": "Подтвердить удаление",
  "authoring.delete.confirmation": "Подтверждение удаления: {label}",
  "authoring.delete.dayConsequence":
    "День будет удалён вместе со всеми его юнитами. Это действие нельзя отменить.",
  "authoring.delete.unitConsequence":
    "Юнит будет удалён из черновика. Это действие нельзя отменить.",
  "authoring.delete.weekConsequence":
    "Неделя будет удалена вместе со всеми её днями и юнитами. Это действие нельзя отменить.",
  "authoring.emptyProgram.description": "Ревизий пока нет.",
  "authoring.emptyProgram.title": "Программа ещё не создана",
  "authoring.entity.day": "день {title}",
  "authoring.entity.unit": "юнит {title}",
  "authoring.entity.week": "неделю {title}",
  "authoring.error.graphUnavailable":
    "Граф ревизии недоступен или содержит небезопасные поля.",
  "authoring.error.invalidJson": "{label}: требуется корректный JSON.",
  "authoring.error.invalidStructure":
    "{label}: структура не соответствует контракту.",
  "authoring.error.payloadTypeMismatch":
    "Payload: type должен совпадать с типом юнита.",
  "authoring.error.requestFailed": "Запрос не выполнен ({status})",
  "authoring.error.saveFailed": "Изменение не удалось сохранить.",
  "authoring.error.unsafeResponseField": "Небезопасное поле ответа: {path}",
  "authoring.error.unsafeServerResponse":
    "Ответ сервера не прошёл локальную проверку безопасности.",
  "authoring.error.versionsUnavailable": "Список ревизий недоступен.",
  "authoring.designer.apply": "Применить предложение",
  "authoring.designer.action.answerDiagnostic": "Продолжить с ответами",
  "authoring.designer.action.completeDiscovery": "Завершить уточнение",
  "authoring.designer.action.confirm": "Подтвердить для компиляции",
  "authoring.designer.action.requestRevision": "Запросить доработку",
  "authoring.designer.action.retry": "Повторить с места сбоя",
  "authoring.designer.action.cancelGeneration": "Отменить генерацию",
  "authoring.designer.action.configureAi": "Настроить AI или провайдера",
  "authoring.designer.action.continueManually": "Продолжить вручную",
  "authoring.designer.action.skipDiagnostic": "Пропустить диагностику",
  "authoring.designer.action.submitRequest": "Отправить запрос",
  "authoring.designer.attribution": "{provider} · {model} · промпт {version}",
  "authoring.designer.change.add-day": "Добавить день",
  "authoring.designer.change.add-unit": "Добавить активность",
  "authoring.designer.change.add-week": "Добавить неделю",
  "authoring.designer.change.update-day": "Обновить день",
  "authoring.designer.change.update-unit": "Обновить активность",
  "authoring.designer.change.update-week": "Обновить неделю",
  "authoring.designer.changeCount": "Предложено изменений: {count}",
  "authoring.designer.description":
    "Необязательный ИИ читает этот черновик и возвращает типизированное предложение. Он не может применить изменения или опубликовать ревизию.",
  "authoring.designer.diagnosticTitle": "Необязательная диагностика",
  "authoring.designer.disclosureApprove": "Разрешить и сгенерировать",
  "authoring.designer.disclosureCancel": "Отмена",
  "authoring.designer.disclosureDescription":
    "Проверьте точную одноразовую область передачи до отправки данных.",
  "authoring.designer.disclosureTitle": "Передача внешнему провайдеру",
  "authoring.designer.disclosure.role": "AI-роль",
  "authoring.designer.disclosure.connection": "ID подключения",
  "authoring.designer.disclosure.provider": "Тип провайдера",
  "authoring.designer.disclosure.model": "Точная модель",
  "authoring.designer.disclosure.destination": "Получатель",
  "authoring.designer.disclosure.payload": "Категории данных",
  "authoring.designer.disclosure.bytes": "Размер данных (байт)",
  "authoring.designer.disclosure.scope":
    "Область черновика, сущностей и источников",
  "authoring.designer.disclosure.sources": "Область одобренных источников",
  "authoring.designer.disclosure.exclusions": "Не отправляется",
  "authoring.designer.disclosure.expires": "Срок разрешения",
  "authoring.designer.disclosure.retention":
    "Разрешение действует только для указанной операции до показанного срока и используется один раз. Контракт не передаёт Aptiloop условия хранения данных у провайдера.",
  "authoring.designer.cancelled":
    "Генерация отменена. Черновик и запрос на авторинг сохранены.",
  "authoring.designer.empty": "Предложений Course Designer пока нет.",
  "authoring.designer.failed":
    "Course Designer завершился с ошибкой и не изменил черновик.",
  "authoring.designer.form.activities": "Предпочтительные типы активностей",
  "authoring.designer.form.constraints": "Ограничения",
  "authoring.designer.form.currentLevel": "Текущий уровень",
  "authoring.designer.form.goal": "Учебная цель",
  "authoring.designer.form.onePerLine": "Один пункт на строку",
  "authoring.designer.form.runtime": "Требования к среде выполнения",
  "authoring.designer.form.sources": "Одобренные источники",
  "authoring.designer.form.sourcesHint":
    "Один предоставленный текст или URL на строку. URL записывается, но не загружается.",
  "authoring.designer.form.start": "Начать пошаговое проектирование",
  "authoring.designer.form.targetOutcome": "Целевой результат",
  "authoring.designer.eyebrow": "Adaptive Studio · Course Designer",
  "authoring.designer.generate": "Сгенерировать предложение",
  "authoring.designer.generating": "Генерирую предложение…",
  "authoring.designer.loading": "Загружаю состояние пошагового проектирования…",
  "authoring.designer.prompt": "Запрос на авторинг",
  "authoring.designer.promptPlaceholder":
    "Например: добавь вводную неделю с активностью на воспроизведение.",
  "authoring.designer.proposalOnly": "Только предложение",
  "authoring.designer.invalidProposal":
    "Заблокировано: ошибок {errors} · предупреждений {warnings}",
  "authoring.designer.proposalsTitle": "Проверка предложений",
  "authoring.designer.proposalsUnavailable":
    "Предложения Course Designer недоступны.",
  "authoring.designer.provenance": "Одобренных источников: {count}",
  "authoring.designer.revisionLabel": "Запрос на доработку",
  "authoring.designer.state.COMPILATION": "Компиляция",
  "authoring.designer.state.CURRICULUM_PROPOSAL": "Предложение программы",
  "authoring.designer.state.DIAGNOSTIC": "Диагностика",
  "authoring.designer.state.DISCOVERY": "Уточнение",
  "authoring.designer.state.DRAFT_REQUEST": "Черновик запроса",
  "authoring.designer.state.FAILED": "Ошибка",
  "authoring.designer.state.PUBLISHED": "Опубликовано",
  "authoring.designer.state.USER_REVIEW": "Проверка пользователем",
  "authoring.designer.state.VALIDATION": "Валидация",
  "authoring.designer.reject": "Отклонить",
  "authoring.designer.status.applied": "Применено",
  "authoring.designer.status.proposed": "Нужна проверка",
  "authoring.designer.status.rejected": "Отклонено",
  "authoring.designer.title": "Course Designer",
  "authoring.designer.validProposal":
    "Предложение проверено: ошибок {errors} · предупреждений {warnings}",
  "authoring.designer.validationPending":
    "Предложение применено и проходит детерминированную валидацию. Устраните замечания, проверьте превью и опубликуйте вручную.",
  "authoring.field.checklist": "Чеклист",
  "authoring.field.checklistJson": "Пункты чеклиста",
  "authoring.field.completionCriteria": "Критерии завершения",
  "authoring.field.completionCriteriaJson": "Критерии завершения",
  "authoring.field.curriculumDescription": "Описание программы",
  "authoring.field.curriculumId": "ID программы",
  "authoring.field.curriculumTitle": "Название программы",
  "authoring.field.depth": "Глубина",
  "authoring.field.description": "Описание",
  "authoring.field.expectedOutcomes": "Ожидаемые результаты",
  "authoring.field.expectedOutcomesJson": "Ожидаемые результаты",
  "authoring.field.goal": "Цель",
  "authoring.field.inherit": "Наследовать",
  "authoring.field.minutes": "Минуты",
  "authoring.field.misconceptions": "Типичные ошибки",
  "authoring.field.misconceptionsJson": "Типичные ошибки",
  "authoring.field.objectives": "Цели",
  "authoring.field.objectivesJson": "Цели",
  "authoring.field.optionalUnit": "Необязательный юнит",
  "authoring.field.outOfScope": "Вне рамок",
  "authoring.field.outOfScopeJson": "Вне рамок",
  "authoring.field.payload": "Payload",
  "authoring.field.payloadJson": "Типизированный payload активности",
  "authoring.field.prerequisites": "Предпосылки",
  "authoring.field.prerequisitesJson": "Предпосылки",
  "authoring.field.questions": "Вопросы",
  "authoring.field.questionsJson": "Вопросы и защищённые ключи ответов",
  "authoring.field.referenceAnswer": "Эталонный ответ · только для авторинга",
  "authoring.field.revisionDescription": "Описание ревизии",
  "authoring.field.revisionTitle": "Название ревизии",
  "authoring.field.slug": "Slug",
  "authoring.field.sources": "Источники",
  "authoring.field.sourcesJson": "Источники",
  "authoring.field.stableId": "Стабильный ID",
  "authoring.field.title": "Название",
  "authoring.field.topics": "Темы",
  "authoring.field.topicsJson": "Темы",
  "authoring.field.type": "Тип",
  "authoring.field.unlockRules": "Правила открытия",
  "authoring.field.unlockRulesJson": "Правила открытия",
  "authoring.graph.empty.description":
    "Добавьте первую неделю, затем день и учебные юниты.",
  "authoring.graph.empty.title": "В черновике пока нет недель",
  "authoring.graph.readOnly.description":
    "Опубликованная ревизия защищена от изменений.",
  "authoring.graph.readOnly.title": "Только чтение.",
  "authoring.graph.selectedRevision": "Граф выбранной ревизии",
  "authoring.history.createdAt": "Создана: {date}",
  "authoring.history.description": "Описание: {description}",
  "authoring.history.details": "Даты и описание",
  "authoring.history.empty": "Других версий нет.",
  "authoring.history.publishedAt": "Опубликована: {date}",
  "authoring.history.title": "История версий",
  "authoring.loading.graph": "Загружаю граф программы",
  "authoring.loading.versions": "Загружаю ревизии",
  "authoring.structured.addItem": "Добавить элемент",
  "authoring.structured.removeItem": "Удалить элемент",
  "authoring.structured.optionalEmpty": "Оставьте пустым, если значения нет",
  "authoring.release.eyebrow": "Adaptive Studio · выпуск",
  "authoring.release.validateTitle": "1. Проверить черновик",
  "authoring.release.validateDescription":
    "Проверяет структуру, типизированные активности, критерии завершения и конечность графа.",
  "authoring.release.validateAction": "Запустить проверку",
  "authoring.release.previewTitle": "2. Предпросмотр ученика",
  "authoring.release.previewDescription":
    "Показывает видимую ученику структуру без защищённых ответов и материалов оценки.",
  "authoring.release.previewAction": "Открыть предпросмотр",
  "authoring.release.reviewTitle": "3. Проверить изменения",
  "authoring.release.reviewDescription":
    "Сравнивает стабильные сущности с неизменяемой родительской ревизией.",
  "authoring.release.reviewAction": "Проверить изменения",
  "authoring.release.passed": "Проверка пройдена",
  "authoring.release.blocked": "Есть блокировки",
  "authoring.release.diagnosticCounts":
    "Ошибки: {errors} · Предупреждения: {warnings}",
  "authoring.release.dayCount": "Дней: {count}",
  "authoring.release.changeCounts":
    "Добавлено: {added} · Изменено: {changed} · Удалено: {removed}",
  "authoring.release.change.added": "Добавлено",
  "authoring.release.change.changed": "Изменено",
  "authoring.release.change.removed": "Удалено",
  "authoring.release.entity.week": "Неделя",
  "authoring.release.entity.day": "Урок",
  "authoring.release.entity.unit": "Активность",
  "authoring.release.required":
    "Проверка, предпросмотр ученика и обзор изменений должны соответствовать текущему черновику.",
  "authoring.publish.confirmation":
    "Я понимаю, что опубликованную ревизию нельзя редактировать.",
  "authoring.publish.description":
    "После публикации ревизия становится неизменяемой. Для следующих правок клонируйте её в новый черновик.",
  "authoring.publish.submit": "Опубликовать неизменяемую ревизию",
  "authoring.publish.title": "Публикация ревизии",
  "authoring.quantity.day.few": "{count} дня",
  "authoring.quantity.day.many": "{count} дней",
  "authoring.quantity.day.one": "{count} день",
  "authoring.quantity.day.other": "{count} дня",
  "authoring.quantity.week.few": "{count} недели",
  "authoring.quantity.week.many": "{count} недель",
  "authoring.quantity.week.one": "{count} неделя",
  "authoring.quantity.week.other": "{count} недели",
  "authoring.reorder.down": "Опустить {label}",
  "authoring.reorder.group": "Порядок: {label}",
  "authoring.reorder.up": "Поднять {label}",
  "authoring.revision.heading": "Версия {revision} · {title}",
  "authoring.revision.label": "Версия {revision}",
  "authoring.missingRevision.description":
    "Ссылка Studio ведёт на ревизию, которой больше нет. Другой курс не был открыт вместо неё.",
  "authoring.missingRevision.title": "Ревизия курса не найдена",
  "authoring.selectRevision.description":
    "Выберите ревизию курса в разделе «Курсы» или создайте новый черновик. Studio не откроет другой курс автоматически.",
  "authoring.selectRevision.title": "Выберите ревизию",
  "authoring.status.archived": "Архив",
  "authoring.status.draft": "Черновик",
  "authoring.status.published": "Опубликована",
  "authoring.status.publishedReadOnly": "Опубликована · только чтение",
  "authoring.unit.add": "Добавить юнит",
  "authoring.unit.form.add": "Добавить юнит",
  "authoring.unit.form.edit": "Редактировать юнит {title}",
  "authoring.unit.save": "Сохранить юнит",
  "authoring.week.add": "Добавить неделю",
  "authoring.week.form.add": "Добавить неделю",
  "authoring.week.form.edit": "Редактировать неделю {title}",
  "authoring.week.meta": "Неделя {number} · {id}",
  "authoring.week.save": "Сохранить неделю",
};

export const catalogs: Readonly<
  Record<UiLocale, Readonly<Record<MessageKey, string>>>
> = {
  "en-US": enUS,
  "ru-RU": ruRU,
};

type LocaleContextValue = {
  locale: UiLocale;
  setLocale: (locale: UiLocale) => boolean;
  t: (
    key: MessageKey,
    values?: Readonly<Record<string, string | number>>,
  ) => string;
  formatDate: (
    value: Date | string | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function browserLocale(): UiLocale {
  if (typeof navigator === "undefined") return "en-US";
  const preferred = navigator.languages?.[0] ?? navigator.language;
  return /^ru(?:-|$)/iu.test(preferred) ? "ru-RU" : "en-US";
}

function readLocaleCookie(): UiLocale | null {
  if (typeof document === "undefined") return null;
  const prefix = `${uiLocaleCookieName}=`;
  for (const part of document.cookie.split(";")) {
    const candidate = part.trim();
    if (!candidate.startsWith(prefix)) continue;
    try {
      const value = decodeURIComponent(candidate.slice(prefix.length));
      return isUiLocale(value) ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

function writeLocaleCookie(locale: UiLocale): void {
  document.cookie = `${uiLocaleCookieName}=${locale}; Path=/; Max-Age=31536000; SameSite=Strict`;
}

function clearLocaleCookie(): void {
  document.cookie = `${uiLocaleCookieName}=; Path=/; Max-Age=0; SameSite=Strict`;
}

function readStoredLocale(): { available: boolean; value: string | null } {
  try {
    return {
      available: true,
      value: window.localStorage.getItem(uiLocaleStorageKey),
    };
  } catch {
    return { available: false, value: null };
  }
}

function persistStoredLocale(locale: UiLocale): boolean {
  try {
    window.localStorage.setItem(uiLocaleStorageKey, locale);
    return true;
  } catch {
    return false;
  }
}

function discardMalformedStoredLocale(): void {
  try {
    window.localStorage.removeItem(uiLocaleStorageKey);
  } catch {
    // A blocked storage API needs no further recovery here.
  }
}

function interpolate(
  message: string,
  values?: Readonly<Record<string, string | number>>,
): string {
  if (!values) return message;
  return message.replace(/\{([^}]+)\}/gu, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

export function LocaleProvider({
  children,
  initialLocale = "en-US",
  syncSettings = true,
}: {
  children: React.ReactNode;
  initialLocale?: UiLocale;
  syncSettings?: boolean;
}) {
  const [locale, setLocaleState] = useState<UiLocale>(initialLocale);
  const [draftLocale, setDraftLocale] = useState<UiLocale>(initialLocale);
  const [showFirstRun, setShowFirstRun] = useState(false);
  const [firstRunSaveError, setFirstRunSaveError] = useState(false);

  const setLocale = useCallback((nextLocale: UiLocale) => {
    if (!isUiLocale(nextLocale)) return false;
    if (!persistStoredLocale(nextLocale)) return false;
    setLocaleState(nextLocale);
    setDraftLocale(nextLocale);
    document.documentElement.lang = nextLocale;
    writeLocaleCookie(nextLocale);
    return true;
  }, []);

  useEffect(() => {
    const stored = readStoredLocale();
    const resolveUnsavedLocale = () => {
      const resolved = syncSettings ? browserLocale() : initialLocale;
      setLocaleState(resolved);
      setDraftLocale(resolved);
      clearLocaleCookie();
      setShowFirstRun(syncSettings);
    };
    const applyConfirmedLocale = (confirmedLocale: UiLocale) => {
      setLocaleState(confirmedLocale);
      setDraftLocale(confirmedLocale);
      writeLocaleCookie(confirmedLocale);
      setShowFirstRun(false);
    };

    if (!stored.available) {
      const cookieLocale = readLocaleCookie();
      if (cookieLocale) {
        applyConfirmedLocale(cookieLocale);
      } else {
        resolveUnsavedLocale();
      }
    } else if (isUiLocale(stored.value)) {
      const storedLocale = stored.value;
      setLocaleState(storedLocale);
      setDraftLocale(storedLocale);
      writeLocaleCookie(storedLocale);
      setShowFirstRun(false);
    } else if (stored.value === null) {
      const cookieLocale = readLocaleCookie();
      if (cookieLocale) {
        applyConfirmedLocale(cookieLocale);
        persistStoredLocale(cookieLocale);
      } else {
        resolveUnsavedLocale();
      }
    } else {
      discardMalformedStoredLocale();
      resolveUnsavedLocale();
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== uiLocaleStorageKey) return;
      if (isUiLocale(event.newValue)) {
        applyConfirmedLocale(event.newValue);
        return;
      }
      if (event.newValue !== null) discardMalformedStoredLocale();
      resolveUnsavedLocale();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [initialLocale, syncSettings]);

  useEffect(() => {
    const cookieLocale = readLocaleCookie();
    if (cookieLocale && cookieLocale !== locale) {
      writeLocaleCookie(locale);
    }
    document.documentElement.lang = locale;
  }, [locale]);

  const value: LocaleContextValue = {
    locale,
    setLocale,
    t: (key, values) =>
      interpolate(
        catalogs[locale][key] ?? catalogs["en-US"][key] ?? key,
        values,
      ),
    formatDate: (date, options) =>
      new Intl.DateTimeFormat(locale, options).format(new Date(date)),
    formatNumber: (number, options) =>
      new Intl.NumberFormat(locale, options).format(number),
  };

  return (
    <LocaleContext.Provider value={value}>
      {children}
      <AlertDialog open={showFirstRun}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {value.t("locale.dialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {value.t("locale.dialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor="first-run-locale">
              {value.t("locale.field.label")}
            </FieldLabel>
            <select
              id="first-run-locale"
              value={draftLocale}
              onChange={(event) => {
                const next = event.target.value as UiLocale;
                setDraftLocale(next);
                setLocaleState(next);
                setFirstRunSaveError(false);
              }}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="en-US">{value.t("locale.option.english")}</option>
              <option value="ru-RU">{value.t("locale.option.russian")}</option>
            </select>
            <FieldDescription>
              {value.t("locale.field.description")}
            </FieldDescription>
            {firstRunSaveError ? (
              <p role="alert" className="text-sm text-destructive">
                {value.t("locale.saveError")}
              </p>
            ) : null}
          </Field>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                if (setLocale(draftLocale)) {
                  setFirstRunSaveError(false);
                  setShowFirstRun(false);
                } else {
                  setFirstRunSaveError(true);
                }
              }}
            >
              {value.t("locale.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </LocaleContext.Provider>
  );
}

export function useI18n(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useI18n must be used inside LocaleProvider");
  return value;
}
