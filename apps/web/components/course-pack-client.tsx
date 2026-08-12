"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowSquareOutIcon,
  BookOpenIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  DotsThreeVerticalIcon,
  FileArrowUpIcon,
  FileIcon,
  FunnelSimpleIcon,
  InfoIcon,
  MagnifyingGlassIcon,
  MapTrifoldIcon,
  PackageIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { EmptyState, QueryError } from "@/components/query-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldGroup } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { type MessageKey, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const hashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const courseRevisionHashSchema = z
  .string()
  .regex(/^(?:sha256:)?[0-9a-f]{64}$/u);
const diagnosticSchema = z
  .object({
    code: z.string(),
    severity: z.enum(["error", "warning"]),
    path: z.string(),
    entityId: z.string().nullable(),
    message: z.string(),
  })
  .strict();
const reportSchema = z
  .object({
    validatorVersion: z.string(),
    valid: z.boolean(),
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    diagnostics: z.array(diagnosticSchema),
    limits: z.record(z.string(), z.number()),
  })
  .strict();
const previewSchema = z
  .object({
    courseKey: z.string(),
    courseTitle: z.string(),
    revisionKey: z.string(),
    revisionNumber: z.number().int().positive(),
    contentHash: hashSchema,
    primaryLocale: z.string(),
    availableLocales: z.array(z.string()),
    lessonCount: z.number().int().nonnegative(),
    activityCount: z.number().int().nonnegative(),
    sourcePrivacyClasses: z.object({
      public: z.number().int().nonnegative(),
      private: z.number().int().nonnegative(),
    }),
    requirements: z.object({
      activityTypes: z.array(z.string()),
      capabilities: z.array(z.string()),
      environmentIds: z.array(z.string()),
      checkIds: z.array(z.string()),
    }),
    provenance: z
      .object({
        contentStatus: z.enum(["development-fixture", "personal"]),
        author: z.string(),
        origin: z.enum(["original", "adapted", "generated", "migration"]),
        ownership: z.enum(["owned", "licensed", "permission", "unresolved"]),
        licenseSpdx: z.string().nullable(),
        termsUrl: z.string().nullable(),
        attribution: z.string().nullable(),
        createdAt: z.string().datetime(),
        notes: z.string().nullable(),
      })
      .strict(),
  })
  .strict();
const validationResponseSchema = z.discriminatedUnion("valid", [
  z
    .object({
      valid: z.literal(true),
      storageAvailable: z.boolean(),
      validationId: z.string().uuid(),
      expiresAt: z.string().datetime(),
      preview: previewSchema,
      report: reportSchema,
    })
    .strict(),
  z
    .object({
      valid: z.literal(false),
      storageAvailable: z.boolean(),
      validationId: z.string().uuid(),
      expiresAt: z.string().datetime(),
      report: reportSchema,
    })
    .strict(),
]);
const libraryItemSchema = z
  .object({
    courseId: z.string(),
    courseKey: z.string(),
    title: z.string(),
    revisionId: z.string(),
    revisionNumber: z.number().int().positive(),
    contentHash: hashSchema,
    revisionStatus: z.enum(["draft", "published", "archived"]),
    lifecycleAction: z.enum(["install", "open-as-draft", "uninstall"]),
    importedAt: z.string().datetime(),
  })
  .strict();
const librarySchema = z
  .object({
    storageAvailable: z.boolean(),
    packs: z.array(libraryItemSchema),
  })
  .strict();
const learningCourseCollectionSchema = z
  .object({
    courses: z.array(
      z
        .object({
          id: z.string(),
          stableId: z.string(),
          title: z.string(),
          description: z.string().nullable(),
          primaryLocale: z.string(),
          selected: z.boolean(),
          activeRevisionId: z.string().nullable(),
          currentSessionId: z.string().nullable(),
          revisions: z.array(
            z
              .object({
                id: z.string(),
                revisionNumber: z.number().int().positive(),
                status: z.enum(["draft", "published", "archived"]),
                branchKind: z.enum(["upstream", "personal"]),
                contentHash: courseRevisionHashSchema.nullable(),
                learningSummary: z
                  .object({
                    state: z.enum(["not-started", "in-progress", "completed"]),
                    completedLessons: z.number().int().nonnegative(),
                    totalLessons: z.number().int().nonnegative(),
                    progressPercent: z.number().int().min(0).max(100),
                    lastActivityAt: z.string().datetime().nullable(),
                  })
                  .strict(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
const selectCourseResponseSchema = z
  .object({
    selected: z.literal(true),
    courseId: z.string(),
    revisionId: z.string(),
  })
  .strict();
const commitResponseSchema = z
  .object({
    result: z.object({
      courseId: z.string(),
      revisionId: z.string(),
      contentHash: hashSchema,
      action: z.enum(["install", "open-as-draft"]),
      revisionStatus: z.enum(["draft", "published", "archived"]),
      installed: z.boolean(),
      idempotent: z.boolean(),
    }),
    openPath: z.string().nullable(),
  })
  .strict();

type ValidationResponse = z.infer<typeof validationResponseSchema>;
type CoursePackLibraryItem = z.infer<typeof libraryItemSchema>;
type InstallAction = "install" | "open-as-draft";
type ValidationRequest = {
  selected: File;
  generation: number;
};
type LearningCourseCollection = z.infer<typeof learningCourseCollectionSchema>;
type LearningCourse = LearningCourseCollection["courses"][number];
type LearningCourseRevision = LearningCourse["revisions"][number];

const statusLabels: Readonly<
  Record<CoursePackLibraryItem["revisionStatus"], MessageKey>
> = {
  draft: "courses.status.draft",
  published: "courses.status.published",
  archived: "courses.status.archived",
};

const courseFilterSchema = z.enum([
  "all",
  "not-started",
  "in-progress",
  "completed",
  "draft",
  "published",
  "archived",
]);

type CourseFilter = z.infer<typeof courseFilterSchema>;

const courseFilterLabels: Readonly<Record<CourseFilter, MessageKey>> = {
  all: "courses.filter.all",
  "not-started": "courses.progress.notStarted",
  "in-progress": "courses.progress.inProgress",
  completed: "courses.progress.completed",
  draft: "courses.status.draft",
  published: "courses.status.published",
  archived: "courses.status.archived",
};

const learningStateLabels: Readonly<
  Record<LearningCourseRevision["learningSummary"]["state"], MessageKey>
> = {
  "not-started": "courses.progress.notStarted",
  "in-progress": "courses.progress.inProgress",
  completed: "courses.progress.completed",
};

const COURSE_PAGE_SIZE = 8;

function parseInstallAction(value: string | null): InstallAction | null {
  return value === "install" || value === "open-as-draft" ? value : null;
}

function getErrorStatus(error: unknown): number | null {
  return error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number"
    ? error.status
    : null;
}

function getErrorCode(error: unknown): string | null {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

function hasValidationExpired(validation: ValidationResponse): boolean {
  return Date.parse(validation.expiresAt) <= Date.now();
}

type CourseListItem = {
  course: LearningCourse;
  revision: LearningCourseRevision;
  current: boolean;
  importedRevisions: readonly CoursePackLibraryItem[];
  packItem?: CoursePackLibraryItem;
};

function parseCoursePage(value: string | null): number {
  if (!value || !/^\d+$/u.test(value)) return 1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

function courseLibraryHref(
  current: { toString(): string },
  {
    search,
    filter,
    page,
  }: { search: string; filter: CourseFilter; page: number },
): string {
  const next = new URLSearchParams(current.toString());
  if (search) next.set("q", search);
  else next.delete("q");
  if (filter === "all") next.delete("filter");
  else next.set("filter", filter);
  if (page === 1) next.delete("page");
  else next.set("page", String(page));
  const query = next.toString();
  return query ? `/courses?${query}` : "/courses";
}

function selectDisplayedRevision(
  course: LearningCourse,
): LearningCourseRevision | undefined {
  const activeRevision = course.revisions.find(
    (revision) => revision.id === course.activeRevisionId,
  );
  if (activeRevision) return activeRevision;

  let selected: LearningCourseRevision | undefined;
  for (const revision of course.revisions) {
    if (!selected) {
      selected = revision;
      continue;
    }
    const revisionPriority =
      revision.status === "published" ? 2 : revision.status === "draft" ? 1 : 0;
    const selectedPriority =
      selected.status === "published" ? 2 : selected.status === "draft" ? 1 : 0;
    if (
      revisionPriority > selectedPriority ||
      (revisionPriority === selectedPriority &&
        revision.revisionNumber > selected.revisionNumber)
    ) {
      selected = revision;
    }
  }
  return selected;
}

type CoursePackView = "import" | "intake" | "library";

export function CourseLibraryClient() {
  return <CoursePackClient view="library" />;
}

export function CoursePackImportClient() {
  return <CoursePackClient view="import" />;
}

export function CoursePackIntakeClient({
  operationId,
}: {
  operationId: string;
}) {
  return <CoursePackClient view="intake" operationId={operationId} />;
}

function CoursePackClient({
  view,
  operationId = null,
}: {
  view: CoursePackView;
  operationId?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { locale, t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [validationFailed, setValidationFailed] = useState(false);
  const [expiredValidationId, setExpiredValidationId] = useState<string | null>(
    null,
  );
  const [commitConfirmation, setCommitConfirmation] =
    useState<InstallAction | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentFileRef = useRef<File | null>(null);
  const validationGenerationRef = useRef(0);
  const urlCourseSearch = searchParams.get("q") ?? "";
  const parsedUrlCourseFilter = courseFilterSchema.safeParse(
    searchParams.get("filter"),
  );
  const urlCourseFilter = parsedUrlCourseFilter.success
    ? parsedUrlCourseFilter.data
    : "all";
  const urlCoursePage = parseCoursePage(searchParams.get("page"));
  const [courseSearch, setCourseSearch] = useState(urlCourseSearch);
  const [courseFilter, setCourseFilter] =
    useState<CourseFilter>(urlCourseFilter);
  const [coursePage, setCoursePage] = useState(urlCoursePage);
  const navigateCourseLibrary = (
    next: { search: string; filter: CourseFilter; page: number },
    history: "push" | "replace",
  ) => {
    const href = courseLibraryHref(searchParams, next);
    if (history === "push") router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
  };

  useEffect(() => {
    if (view !== "library") return;
    setCourseSearch(urlCourseSearch);
    setCourseFilter(urlCourseFilter);
    setCoursePage(urlCoursePage);
  }, [urlCourseFilter, urlCoursePage, urlCourseSearch, view]);

  const library = useQuery({
    queryKey: ["course-packs"],
    queryFn: async () => librarySchema.parse(await api("/course-packs")),
    enabled: view !== "intake",
  });
  const learningCourses = useQuery({
    queryKey: ["learning-courses"],
    queryFn: async () =>
      learningCourseCollectionSchema.parse(
        await api<unknown>("/learning/courses"),
      ),
    enabled: view === "library",
    retry: false,
  });
  const stagedValidation = useQuery({
    queryKey: ["course-pack-validation", operationId],
    queryFn: async () =>
      validationResponseSchema.parse(
        await api(
          `/course-packs/validations/${encodeURIComponent(operationId ?? "")}`,
        ),
      ),
    enabled: view === "intake" && operationId !== null,
    retry: false,
  });
  const activeValidation =
    view === "intake"
      ? stagedValidation.isError
        ? null
        : (stagedValidation.data ?? null)
      : validation;
  const validationExpired = activeValidation
    ? expiredValidationId === activeValidation.validationId ||
      hasValidationExpired(activeValidation)
    : false;
  const urlCommitConfirmation =
    view === "intake" ? parseInstallAction(searchParams.get("confirm")) : null;
  const activeCommitConfirmation =
    view === "intake"
      ? activeValidation?.valid &&
        activeValidation.storageAvailable &&
        !validationExpired
        ? urlCommitConfirmation
        : null
      : commitConfirmation;
  const validate = useMutation({
    mutationFn: async ({ selected }: ValidationRequest) =>
      validationResponseSchema.parse(
        await api("/course-packs/validate", {
          method: "POST",
          body: selected,
        }),
      ),
    onSuccess: (result, request) => {
      if (
        request.generation !== validationGenerationRef.current ||
        request.selected !== currentFileRef.current
      ) {
        return;
      }
      setValidationFailed(false);
      if (view === "import") {
        setExpiredValidationId(null);
        setCommitConfirmation(null);
        setValidation(null);
        router.push(
          `/courses/intake/${encodeURIComponent(result.validationId)}`,
        );
        return;
      }
      setExpiredValidationId(
        hasValidationExpired(result) ? result.validationId : null,
      );
      setCommitConfirmation(null);
      setValidation(result);
    },
    onError: (error: unknown, request) => {
      if (
        request.generation !== validationGenerationRef.current ||
        request.selected !== currentFileRef.current
      ) {
        return;
      }
      setValidationFailed(true);
      toast.error(
        error instanceof Error ? error.message : t("courses.alert.errorTitle"),
      );
    },
  });
  const commit = useMutation({
    mutationFn: async (action: InstallAction) => {
      if (!activeValidation?.valid) {
        throw new Error(t("courses.error.validateFirst"));
      }
      if (hasValidationExpired(activeValidation)) {
        throw new Error(t("courses.validation.expired.description"));
      }
      return commitResponseSchema.parse(
        await api(
          `/course-packs/validations/${encodeURIComponent(activeValidation.validationId)}/commit`,
          {
            method: "POST",
            body: JSON.stringify({
              operationId: globalThis.crypto.randomUUID(),
              action,
              expectedContentHash: activeValidation.preview.contentHash,
            }),
          },
        ),
      );
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["course-packs"] }),
        queryClient.invalidateQueries({ queryKey: ["learning-courses"] }),
        queryClient.invalidateQueries({ queryKey: ["learning-path"] }),
      ]);
      currentFileRef.current = null;
      validationGenerationRef.current += 1;
      setFile(null);
      setValidation(null);
      setExpiredValidationId(null);
      setCommitConfirmation(null);
      if (activeValidation) {
        queryClient.removeQueries({
          queryKey: ["course-pack-validation", activeValidation.validationId],
          exact: true,
        });
      }
      toast.success(
        t(
          result.result.idempotent
            ? result.result.action === "install"
              ? "courses.notice.alreadyInstalled"
              : "courses.notice.draftAlreadySaved"
            : result.result.action === "install"
              ? "courses.notice.installed"
              : "courses.notice.draftSaved",
        ),
      );
      const destination =
        result.result.action === "open-as-draft"
          ? `/courses/studio?version=${encodeURIComponent(result.result.revisionId)}`
          : (result.openPath ??
            `/courses/${encodeURIComponent(result.result.courseId)}/revisions/${encodeURIComponent(result.result.revisionId)}`);
      router.push(destination);
    },
    onError: (error: unknown) => {
      if (view === "intake" && getErrorStatus(error) === 404) {
        void stagedValidation.refetch();
        toast.error(t("courses.intake.unavailable.title"));
        return;
      }
      toast.error(
        error instanceof Error ? error.message : t("courses.alert.errorTitle"),
      );
    },
  });
  const selectCourse = useMutation({
    mutationFn: async ({
      courseId,
      revisionId,
    }: {
      courseId: string;
      revisionId: string;
    }) =>
      selectCourseResponseSchema.parse(
        await api(`/learning/courses/${encodeURIComponent(courseId)}/select`, {
          method: "POST",
          body: JSON.stringify({
            revisionId,
            operationId: globalThis.crypto.randomUUID(),
          }),
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["learning-courses"] }),
        queryClient.invalidateQueries({ queryKey: ["learning-path"] }),
      ]);
      toast.success(t("courses.notice.selected"));
    },
    onError: (error: unknown) =>
      toast.error(
        error instanceof Error ? error.message : t("courses.alert.errorTitle"),
      ),
  });
  const uninstall = useMutation({
    mutationFn: async (item: CoursePackLibraryItem) =>
      api("/course-packs/uninstall", {
        method: "POST",
        body: JSON.stringify({
          operationId: globalThis.crypto.randomUUID(),
          revisionId: item.revisionId,
          confirmRevisionKey: item.revisionId,
        }),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["course-packs"] }),
        queryClient.invalidateQueries({ queryKey: ["learning-courses"] }),
        queryClient.invalidateQueries({ queryKey: ["learning-path"] }),
      ]);
      toast.success(t("courses.notice.uninstalled"));
    },
    onError: (error: unknown) =>
      toast.error(
        getErrorCode(error) === "active_session"
          ? t("courses.error.activeSessionPinned")
          : error instanceof Error
            ? error.message
            : t("courses.alert.errorTitle"),
      ),
  });

  const currentCourse = learningCourses.data?.courses.find(
    (course) => course.selected,
  );
  const currentRevision = currentCourse?.revisions.find(
    (revision) => revision.id === currentCourse.activeRevisionId,
  );
  const currentCoursePath =
    currentCourse && currentRevision
      ? currentCourse.currentSessionId
        ? `/session?id=${encodeURIComponent(currentCourse.currentSessionId)}`
        : `/courses/${encodeURIComponent(currentCourse.id)}/revisions/${encodeURIComponent(currentRevision.id)}`
      : null;
  const currentCourseRoadmapPath =
    currentCourse && currentRevision
      ? `/courses/${encodeURIComponent(currentCourse.id)}/revisions/${encodeURIComponent(currentRevision.id)}`
      : null;
  const packItemsByCourse = useMemo(() => {
    const items = new Map<string, Map<string, CoursePackLibraryItem>>();
    for (const item of library.data?.packs ?? []) {
      const revisions = items.get(item.courseId);
      if (revisions) revisions.set(item.revisionId, item);
      else items.set(item.courseId, new Map([[item.revisionId, item]]));
    }
    return items;
  }, [library.data?.packs]);
  const courseItems = useMemo(() => {
    const items: CourseListItem[] = [];
    for (const course of learningCourses.data?.courses ?? []) {
      const revision = selectDisplayedRevision(course);
      if (!revision) continue;
      const current =
        course.selected && course.activeRevisionId === revision.id;
      const packItems = packItemsByCourse.get(course.id);
      const packItem = packItems?.get(revision.id);
      const importedRevisions = packItems
        ? [...packItems.values()].toSorted(
            (left, right) => right.revisionNumber - left.revisionNumber,
          )
        : [];
      items.push({
        course,
        revision,
        current,
        importedRevisions,
        ...(packItem ? { packItem } : {}),
      });
    }
    return items.toSorted(
      (left, right) => Number(right.current) - Number(left.current),
    );
  }, [learningCourses.data?.courses, packItemsByCourse]);
  const filteredCourseItems = useMemo(() => {
    const normalizedSearch = courseSearch.trim().toLocaleLowerCase(locale);
    return courseItems.filter(({ course, revision }) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        course.title.toLocaleLowerCase(locale).includes(normalizedSearch) ||
        (course.description ?? "")
          .toLocaleLowerCase(locale)
          .includes(normalizedSearch);
      const matchesFilter =
        courseFilter === "all" ||
        revision.status === courseFilter ||
        revision.learningSummary.state === courseFilter;
      return matchesSearch && matchesFilter;
    });
  }, [courseFilter, courseItems, courseSearch, locale]);
  const coursePageCount = Math.max(
    1,
    Math.ceil(filteredCourseItems.length / COURSE_PAGE_SIZE),
  );
  const effectiveCoursePage = Math.min(coursePage, coursePageCount);
  const coursePageStart = (effectiveCoursePage - 1) * COURSE_PAGE_SIZE;
  const visibleCourseItems = filteredCourseItems.slice(
    coursePageStart,
    coursePageStart + COURSE_PAGE_SIZE,
  );
  const currentCourseActionLabel = currentCourse?.currentSessionId
    ? t("courses.action.continue")
    : t("courses.action.open");

  useEffect(() => {
    if (
      view !== "library" ||
      !learningCourses.isSuccess ||
      !library.isSuccess ||
      coursePage === effectiveCoursePage
    ) {
      return;
    }
    setCoursePage(effectiveCoursePage);
    router.replace(
      courseLibraryHref(searchParams, {
        search: courseSearch,
        filter: courseFilter,
        page: effectiveCoursePage,
      }),
      { scroll: false },
    );
  }, [
    courseFilter,
    coursePage,
    courseSearch,
    effectiveCoursePage,
    learningCourses.isSuccess,
    library.isSuccess,
    router,
    searchParams,
    view,
  ]);

  useEffect(() => {
    if (!activeValidation || validationExpired) return;
    const expiresAt = Date.parse(activeValidation.expiresAt);
    const validationId = activeValidation.validationId;
    let timeout: number | undefined;
    const scheduleExpiry = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        setExpiredValidationId(validationId);
        setCommitConfirmation(null);
        return;
      }
      timeout = window.setTimeout(
        scheduleExpiry,
        Math.min(remaining, 2_147_483_647),
      );
    };
    scheduleExpiry();
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [activeValidation, validationExpired]);

  const startValidation = (selected: File) => {
    const generation = validationGenerationRef.current + 1;
    validationGenerationRef.current = generation;
    setValidationFailed(false);
    validate.mutate({ selected, generation });
  };

  const requestCommitConfirmation = (action: InstallAction) => {
    if (!activeValidation?.valid) return;
    if (hasValidationExpired(activeValidation)) {
      setExpiredValidationId(activeValidation.validationId);
      setCommitConfirmation(null);
      return;
    }
    if (view === "intake") {
      router.push(
        `/courses/intake/${encodeURIComponent(activeValidation.validationId)}?confirm=${action}`,
        { scroll: false },
      );
      return;
    }
    setCommitConfirmation(action);
  };

  const confirmCommit = () => {
    if (!activeCommitConfirmation || !activeValidation?.valid) return;
    if (hasValidationExpired(activeValidation)) {
      setExpiredValidationId(activeValidation.validationId);
      setCommitConfirmation(null);
      return;
    }
    commit.mutate(activeCommitConfirmation);
  };

  const cancelCommitConfirmation = () => {
    if (view === "intake" && activeValidation) {
      router.replace(
        `/courses/intake/${encodeURIComponent(activeValidation.validationId)}`,
        { scroll: false },
      );
      return;
    }
    setCommitConfirmation(null);
  };

  if (view === "intake") {
    const status = getErrorStatus(stagedValidation.error);
    const unavailable = status === 400 || status === 404;

    return (
      <div className="flex min-w-0 flex-col gap-7">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3">
            <Link href="/courses/import">
              <ArrowLeftIcon data-icon="inline-start" aria-hidden />
              {t("courses.intake.selectAnother")}
            </Link>
          </Button>
        </div>
        <PageHeader
          title={t("courses.intake.title")}
          description={t("courses.intake.description")}
        />

        {stagedValidation.isLoading ? (
          <div
            role="status"
            aria-label={t("courses.intake.loading")}
            className="grid gap-3"
          >
            <Skeleton aria-hidden className="h-8 w-48" />
            <Skeleton aria-hidden className="h-72 w-full rounded-panel" />
            <span className="sr-only">{t("courses.intake.loading")}</span>
          </div>
        ) : null}

        {stagedValidation.isError ? (
          <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-background p-5 sm:p-6">
            <Alert variant="destructive">
              <WarningCircleIcon aria-hidden />
              <AlertTitle>
                {t(
                  unavailable
                    ? "courses.intake.unavailable.title"
                    : "courses.intake.loadFailed.title",
                )}
              </AlertTitle>
              <AlertDescription>
                {t(
                  unavailable
                    ? "courses.intake.unavailable.description"
                    : "courses.intake.loadFailed.description",
                )}
              </AlertDescription>
            </Alert>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button asChild className="w-full sm:w-auto">
                <Link href="/courses/import">
                  {t("courses.intake.reselect")}
                </Link>
              </Button>
              {!unavailable ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => void stagedValidation.refetch()}
                >
                  {t("courses.intake.retry")}
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeValidation ? (
          <>
            {!activeValidation.storageAvailable ? (
              <Alert>
                <WarningCircleIcon aria-hidden />
                <AlertTitle>{t("courses.storageUnavailable.title")}</AlertTitle>
                <AlertDescription>
                  {t("courses.storageUnavailable.description")}
                </AlertDescription>
              </Alert>
            ) : null}
            <section className="min-w-0 rounded-lg border border-border bg-background p-5 sm:p-6 xl:p-8">
              <CoursePackPreviewPanel
                validation={activeValidation}
                pendingAction={
                  commit.isPending ? (commit.variables ?? null) : null
                }
                expired={validationExpired}
                expiredRecovery="reselect"
                revalidating={false}
                onRevalidate={() => router.push("/courses/import")}
                onCommit={requestCommitConfirmation}
              />
            </section>
            <CoursePackCommitDialog
              validation={activeValidation.valid ? activeValidation : null}
              action={activeCommitConfirmation}
              onCancel={cancelCommitConfirmation}
              onConfirm={confirmCommit}
            />
          </>
        ) : null}
      </div>
    );
  }

  if (view === "import") {
    return (
      <div className="flex min-w-0 flex-col gap-7">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3">
            <Link href="/courses">
              <ArrowLeftIcon data-icon="inline-start" aria-hidden />
              {t("nav.courses")}
            </Link>
          </Button>
        </div>
        <PageHeader
          title={t("courses.import.title")}
          description={t("courses.import.description")}
        />

        {library.isError ? (
          <QueryError
            message={library.error.message}
            retry={() => void library.refetch()}
          />
        ) : null}

        <section
          aria-labelledby="course-pack-import-title"
          className="grid min-w-0 grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]"
        >
          <div className="flex min-w-0 flex-col gap-6 bg-background p-5 sm:p-6 xl:p-8">
            <div className="flex min-w-0 flex-col gap-2">
              <h2
                id="course-pack-import-title"
                className="text-lg font-semibold"
              >
                {t("courses.import.validate")}
              </h2>
              <p className="max-w-[60ch] text-sm leading-6 text-muted-foreground">
                {t("courses.import.fileDescription")}
              </p>
            </div>

            <FieldGroup className="gap-5">
              <Field data-invalid={validationFailed || undefined}>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-fit"
                  disabled={validate.isPending || commit.isPending}
                  aria-invalid={validationFailed}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileArrowUpIcon data-icon="inline-start" aria-hidden />
                  {t("courses.import.fileLabel")}
                </Button>
                <input
                  ref={fileInputRef}
                  id="course-pack-file"
                  type="file"
                  accept="application/json,.json"
                  aria-hidden="true"
                  tabIndex={-1}
                  disabled={validate.isPending || commit.isPending}
                  hidden
                  onChange={(event) => {
                    const selected = event.currentTarget.files?.[0] ?? null;
                    currentFileRef.current = selected;
                    validationGenerationRef.current += 1;
                    setFile(selected);
                    setValidation(null);
                    setValidationFailed(false);
                    setExpiredValidationId(null);
                    setCommitConfirmation(null);
                    if (!validate.isPending) validate.reset();
                    commit.reset();
                  }}
                />
                {file ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface-soft px-3 py-3"
                  >
                    <FileIcon
                      aria-hidden
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 break-words text-sm font-medium">
                      {file.name}
                    </span>
                  </div>
                ) : null}
                <FieldDescription>
                  {t("courses.import.fileDescription")}
                </FieldDescription>
              </Field>
              <Field>
                <Button
                  type="button"
                  className="w-full sm:w-fit"
                  disabled={!file || validate.isPending || commit.isPending}
                  onClick={() => {
                    if (file) startValidation(file);
                  }}
                >
                  {validate.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  {t("courses.import.validate")}
                </Button>
              </Field>
            </FieldGroup>

            {library.data && !library.data.storageAvailable ? (
              <Alert>
                <WarningCircleIcon aria-hidden />
                <AlertTitle>{t("courses.storageUnavailable.title")}</AlertTitle>
                <AlertDescription>
                  {t("courses.storageUnavailable.description")}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>

          <div className="min-w-0 bg-background p-5 sm:p-6 xl:p-8">
            <CoursePackPreviewPanel
              validation={validation}
              pendingAction={
                commit.isPending ? (commit.variables ?? null) : null
              }
              expired={validationExpired}
              expiredRecovery="revalidate"
              revalidating={validate.isPending}
              onRevalidate={() => {
                if (file) startValidation(file);
              }}
              onCommit={requestCommitConfirmation}
            />
          </div>
        </section>

        <CoursePackCommitDialog
          validation={activeValidation?.valid ? activeValidation : null}
          action={activeCommitConfirmation}
          onCancel={cancelCommitConfirmation}
          onConfirm={confirmCommit}
        />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-7 lg:gap-9">
      <PageHeader
        title={t("courses.page.title")}
        description={t("page.courses.description")}
        actions={
          <>
            <Button asChild className="flex-1 sm:flex-none">
              <Link href="/courses/new">
                <PlusIcon data-icon="inline-start" aria-hidden />
                {t("courses.create.action")}
              </Link>
            </Button>
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <Link href="/courses/import">
                <FileArrowUpIcon data-icon="inline-start" aria-hidden />
                {t("courses.import.title")}
              </Link>
            </Button>
          </>
        }
      />

      <section aria-labelledby="current-course-title">
        <h2 id="current-course-title" className="sr-only">
          {t("courses.current.title")}
        </h2>
        {learningCourses.isLoading ? (
          <div role="status" aria-label={t("courses.current.loading")}>
            <Skeleton aria-hidden className="h-28 w-full rounded-panel" />
            <span className="sr-only">{t("courses.current.loading")}</span>
          </div>
        ) : null}
        {learningCourses.isError ? (
          <div className="flex flex-col gap-3 rounded-panel border border-destructive/25 bg-destructive/10 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {t("courses.current.unavailable")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("courses.current.unavailableDescription")}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full shrink-0 sm:w-auto"
              onClick={() => void learningCourses.refetch()}
            >
              {t("query.retry")}
            </Button>
          </div>
        ) : null}
        {learningCourses.isSuccess && currentCourse ? (
          <article
            data-slot="course-current-summary"
            className="relative flex min-w-0 flex-col gap-4 overflow-hidden rounded-panel bg-surface-soft/75 px-5 py-5 sm:min-h-[8.25rem] sm:flex-row sm:items-center sm:justify-between sm:px-6"
          >
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-[3px] bg-success"
            />
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">
                {t("courses.current.title")}
              </p>
              <p className="mt-1 min-w-0 break-words text-lg font-semibold">
                {currentCourse.title}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                <span>
                  {currentRevision
                    ? t("courses.library.revisionNumber", {
                        revision:
                          currentRevision.revisionNumber.toLocaleString(locale),
                      })
                    : t("courses.current.revisionUnavailable")}
                </span>
                {currentRevision ? <span aria-hidden>·</span> : null}
                {currentRevision ? (
                  <span>
                    {t(
                      learningStateLabels[
                        currentRevision.learningSummary.state
                      ],
                    )}
                  </span>
                ) : null}
                {currentCourse.currentSessionId ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>{t("courses.current.sessionActive")}</span>
                  </>
                ) : null}
              </p>
            </div>
            {currentCoursePath ? (
              <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                {currentCourseRoadmapPath &&
                currentCourseRoadmapPath !== currentCoursePath ? (
                  <Button
                    asChild
                    variant="ghost"
                    className="min-h-12 w-full px-4 sm:w-auto"
                  >
                    <Link href={currentCourseRoadmapPath}>
                      <MapTrifoldIcon aria-hidden />
                      {t("home.courseRoadmap")}
                    </Link>
                  </Button>
                ) : null}
                <Button
                  asChild
                  variant="outline"
                  className="min-h-12 w-full px-5 text-base sm:w-auto"
                >
                  <Link href={currentCoursePath}>
                    {currentCourseActionLabel}
                    <ArrowRightIcon data-icon="inline-end" aria-hidden />
                  </Link>
                </Button>
              </div>
            ) : null}
          </article>
        ) : null}
        {learningCourses.isSuccess && !currentCourse ? (
          <div className="rounded-panel bg-surface-soft/75 p-5">
            <p className="text-sm font-medium">{t("courses.current.none")}</p>
            <p className="mt-1 max-w-[68ch] text-sm leading-6 text-muted-foreground">
              {t("courses.current.noneDescription")}
            </p>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="course-library-title" className="min-w-0">
        <h2 id="course-library-title" className="sr-only">
          {t("courses.library.title")}
        </h2>

        {learningCourses.isLoading || library.isLoading ? (
          <CourseLibrarySkeleton />
        ) : null}
        {learningCourses.isError || library.isError ? (
          <QueryError
            message={
              library.error?.message ??
              learningCourses.error?.message ??
              t("courses.current.unavailable")
            }
            retry={() => {
              if (learningCourses.isError) void learningCourses.refetch();
              if (library.isError) void library.refetch();
            }}
          />
        ) : null}
        {learningCourses.isSuccess &&
        library.isSuccess &&
        courseItems.length === 0 ? (
          <EmptyState
            title={t("courses.library.empty.title")}
            description={t("courses.current.noneDescription")}
            action={
              <div className="flex w-full flex-col justify-center gap-2 sm:w-auto sm:flex-row">
                <Button asChild className="w-full sm:w-auto">
                  <Link href="/courses/new">{t("courses.create.action")}</Link>
                </Button>
                <Button asChild variant="outline" className="w-full sm:w-auto">
                  <Link href="/courses/import">
                    {t("courses.import.title")}
                  </Link>
                </Button>
              </div>
            }
          />
        ) : null}
        {learningCourses.isSuccess &&
        library.isSuccess &&
        courseItems.length > 0 ? (
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <InputGroup className="h-12 w-full rounded-control sm:max-w-sm">
                <InputGroupAddon aria-hidden>
                  <MagnifyingGlassIcon />
                </InputGroupAddon>
                <InputGroupInput
                  type="search"
                  value={courseSearch}
                  aria-label={t("courses.search.label")}
                  placeholder={t("courses.search.placeholder")}
                  className="text-base"
                  onChange={(event) => {
                    const nextSearch = event.currentTarget.value;
                    setCourseSearch(nextSearch);
                    setCoursePage(1);
                    navigateCourseLibrary(
                      {
                        search: nextSearch,
                        filter: courseFilter,
                        page: 1,
                      },
                      "replace",
                    );
                  }}
                />
              </InputGroup>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-12 w-full px-4 text-base sm:min-w-28 sm:w-auto"
                  >
                    <FunnelSimpleIcon data-icon="inline-start" aria-hidden />
                    {t("courses.filter.action")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      {t("courses.filter.label")}
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup
                    value={courseFilter}
                    onValueChange={(value) => {
                      const parsed = courseFilterSchema.safeParse(value);
                      if (!parsed.success) return;
                      setCourseFilter(parsed.data);
                      setCoursePage(1);
                      navigateCourseLibrary(
                        {
                          search: courseSearch,
                          filter: parsed.data,
                          page: 1,
                        },
                        "push",
                      );
                    }}
                  >
                    {courseFilterSchema.options.map((filter) => (
                      <DropdownMenuRadioItem key={filter} value={filter}>
                        {t(courseFilterLabels[filter])}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {filteredCourseItems.length === 0 ? (
              <EmptyState
                title={t("courses.library.filteredEmpty.title")}
                description={t("courses.library.filteredEmpty.description")}
                action={
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setCourseSearch("");
                      setCourseFilter("all");
                      setCoursePage(1);
                      navigateCourseLibrary(
                        { search: "", filter: "all", page: 1 },
                        "push",
                      );
                    }}
                  >
                    {t("courses.filter.clear")}
                  </Button>
                }
              />
            ) : (
              <div
                data-slot="course-library-table"
                className="min-w-0 overflow-hidden rounded-panel bg-surface-raised shadow-sm"
              >
                <Table className="table-fixed md:table-auto">
                  <TableHeader className="hidden md:table-header-group [&_th]:h-[3.75rem] [&_th]:text-[0.9375rem]">
                    <TableRow>
                      <TableHead className="w-[40%] px-6">
                        {t("courses.table.course")}
                      </TableHead>
                      <TableHead className="w-[18%]">
                        {t("courses.table.revisionStatus")}
                      </TableHead>
                      <TableHead className="w-[27%]">
                        {t("courses.table.progress")}
                      </TableHead>
                      <TableHead className="w-[15%] text-right">
                        {t("courses.table.actions")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="block md:table-row-group">
                    {visibleCourseItems.map(
                      ({
                        course,
                        revision,
                        current,
                        importedRevisions,
                        packItem,
                      }) => (
                        <CourseLibraryRow
                          key={course.id}
                          course={course}
                          revision={revision}
                          current={current}
                          importedRevisions={importedRevisions}
                          selecting={
                            selectCourse.isPending &&
                            selectCourse.variables?.courseId === course.id &&
                            selectCourse.variables.revisionId === revision.id
                          }
                          uninstallingRevisionId={
                            uninstall.isPending
                              ? (uninstall.variables?.revisionId ?? null)
                              : null
                          }
                          onSelect={() =>
                            selectCourse.mutate({
                              courseId: course.id,
                              revisionId: revision.id,
                            })
                          }
                          onExport={(item) => {
                            void exportPack(item, (status) =>
                              t("courses.export.error", {
                                status: status.toLocaleString(locale),
                              }),
                            ).catch((error: unknown) => {
                              toast.error(
                                error instanceof Error
                                  ? error.message
                                  : t("courses.alert.errorTitle"),
                              );
                            });
                          }}
                          onUninstall={(item) => uninstall.mutate(item)}
                          {...(packItem ? { packItem } : {})}
                        />
                      ),
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {filteredCourseItems.length > 0 ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {t("courses.library.results", {
                    start: (coursePageStart + 1).toLocaleString(locale),
                    end: Math.min(
                      coursePageStart + COURSE_PAGE_SIZE,
                      filteredCourseItems.length,
                    ).toLocaleString(locale),
                    total: filteredCourseItems.length.toLocaleString(locale),
                  })}
                </p>
                {coursePageCount > 1 ? (
                  <nav
                    className="flex items-center justify-end gap-2"
                    aria-label={t("courses.pagination.label")}
                  >
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      aria-label={t("courses.pagination.previous")}
                      disabled={effectiveCoursePage === 1}
                      onClick={() => {
                        const nextPage = Math.max(1, effectiveCoursePage - 1);
                        setCoursePage(nextPage);
                        navigateCourseLibrary(
                          {
                            search: courseSearch,
                            filter: courseFilter,
                            page: nextPage,
                          },
                          "push",
                        );
                      }}
                    >
                      <CaretLeftIcon aria-hidden />
                    </Button>
                    <span className="min-w-10 text-center text-sm font-medium">
                      {effectiveCoursePage.toLocaleString(locale)}
                    </span>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      aria-label={t("courses.pagination.next")}
                      disabled={effectiveCoursePage === coursePageCount}
                      onClick={() => {
                        const nextPage = Math.min(
                          coursePageCount,
                          effectiveCoursePage + 1,
                        );
                        setCoursePage(nextPage);
                        navigateCourseLibrary(
                          {
                            search: courseSearch,
                            filter: courseFilter,
                            page: nextPage,
                          },
                          "push",
                        );
                      }}
                    >
                      <CaretRightIcon aria-hidden />
                    </Button>
                  </nav>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function CoursePackPreviewPanel({
  validation,
  pendingAction,
  expired,
  expiredRecovery,
  revalidating,
  onRevalidate,
  onCommit,
}: {
  validation: ValidationResponse | null;
  pendingAction: InstallAction | null;
  expired: boolean;
  expiredRecovery: "reselect" | "revalidate";
  revalidating: boolean;
  onRevalidate: () => void;
  onCommit: (action: InstallAction) => void;
}) {
  const { locale, t } = useI18n();

  if (!validation) {
    return (
      <div className="flex min-h-64 min-w-0 flex-col items-center justify-center gap-3 px-4 py-10 text-center xl:min-h-[28rem]">
        <PackageIcon aria-hidden className="size-7 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">{t("courses.preview.empty.title")}</p>
          <p className="max-w-[42ch] text-sm leading-6 text-muted-foreground">
            {t("courses.preview.empty.description")}
          </p>
        </div>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="flex min-h-64 min-w-0 flex-col justify-center gap-4 xl:min-h-[28rem]">
        <Alert>
          <WarningCircleIcon aria-hidden />
          <AlertTitle>{t("courses.validation.expired.title")}</AlertTitle>
          <AlertDescription>
            {t("courses.validation.expired.description")}
          </AlertDescription>
        </Alert>
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-fit"
          disabled={revalidating}
          onClick={onRevalidate}
        >
          {revalidating ? <Spinner data-icon="inline-start" /> : null}
          {t(
            expiredRecovery === "reselect"
              ? "courses.intake.reselect"
              : "courses.validation.expired.revalidate",
          )}
        </Button>
      </div>
    );
  }

  if (!validation.valid) {
    return (
      <div className="flex min-h-64 min-w-0 flex-col gap-4 xl:min-h-[28rem]">
        <Alert variant="destructive">
          <WarningCircleIcon aria-hidden />
          <AlertTitle>{t("courses.preview.rejected")}</AlertTitle>
          <AlertDescription>
            {t("courses.preview.errors", {
              count: validation.report.errors.toLocaleString(locale),
            })}
          </AlertDescription>
        </Alert>
        <DiagnosticList diagnostics={validation.report.diagnostics} />
      </div>
    );
  }

  const preview = validation.preview;
  return (
    <div className="flex min-h-64 min-w-0 flex-col gap-5 xl:min-h-[28rem]">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {t("courses.preview.validated")}
          </p>
          <h3 className="min-w-0 break-words text-xl font-semibold">
            {preview.courseTitle}
          </h3>
          <p className="max-w-[60ch] break-all text-sm leading-6 text-muted-foreground">
            {t("courses.revision", {
              courseKey: preview.courseKey,
              revision: preview.revisionNumber.toLocaleString(locale),
            })}
          </p>
        </div>
        <Badge variant="success">{t("courses.preview.ready")}</Badge>
      </div>

      <Separator />

      <dl className="grid min-w-0 grid-cols-2 gap-x-5 gap-y-4 text-sm sm:grid-cols-4">
        <PreviewMetric
          label={t("courses.preview.metric.lessons")}
          value={preview.lessonCount.toLocaleString(locale)}
        />
        <PreviewMetric
          label={t("courses.preview.metric.activities")}
          value={preview.activityCount.toLocaleString(locale)}
        />
        <PreviewMetric
          label={t("courses.preview.metric.language")}
          value={preview.primaryLocale}
        />
        <PreviewMetric
          label={t("courses.preview.metric.sources")}
          value={t("courses.preview.sourcesValue", {
            publicCount:
              preview.sourcePrivacyClasses.public.toLocaleString(locale),
            privateCount:
              preview.sourcePrivacyClasses.private.toLocaleString(locale),
          })}
        />
      </dl>

      <details className="group min-w-0 rounded-lg border border-border bg-surface-soft">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
          {t("courses.library.details")}
          <CaretDownIcon
            aria-hidden
            className="shrink-0 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <Separator />
        <div className="flex min-w-0 flex-col gap-5 p-4">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              {t("courses.preview.contentHash")}
            </p>
            <code className="min-w-0 break-all font-mono text-xs">
              {preview.contentHash}
            </code>
          </div>

          <div className="grid min-w-0 gap-5 text-sm sm:grid-cols-2">
            <RequirementList
              label={t("courses.preview.requirement.activityTypes")}
              values={preview.requirements.activityTypes}
            />
            <RequirementList
              label={t("courses.preview.requirement.trustedChecks")}
              values={preview.requirements.checkIds}
            />
            <RequirementList
              label={t("courses.preview.requirement.environments")}
              values={preview.requirements.environmentIds}
            />
            <RequirementList
              label={t("courses.preview.requirement.provenance")}
              values={[
                preview.provenance.author,
                preview.provenance.ownership,
                preview.provenance.licenseSpdx ??
                  t("courses.preview.noLicenseClaim"),
              ]}
            />
          </div>

          {validation.report.diagnostics.length > 0 ? (
            <DiagnosticList diagnostics={validation.report.diagnostics} />
          ) : null}
        </div>
      </details>

      <Separator />

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          className="w-full sm:w-auto"
          disabled={pendingAction !== null || !validation.storageAvailable}
          onClick={() => onCommit("install")}
        >
          {pendingAction === "install" ? (
            <Spinner data-icon="inline-start" />
          ) : null}
          {t("courses.action.installAndOpen")}
        </Button>
        <Button
          variant="outline"
          className="w-full sm:w-auto"
          disabled={pendingAction !== null || !validation.storageAvailable}
          onClick={() => onCommit("open-as-draft")}
        >
          {pendingAction === "open-as-draft" ? (
            <Spinner data-icon="inline-start" />
          ) : null}
          {t("courses.action.openAsDraft")}
        </Button>
      </div>
    </div>
  );
}

function CoursePackCommitDialog({
  validation,
  action,
  onCancel,
  onConfirm,
}: {
  validation: Extract<ValidationResponse, { valid: true }> | null;
  action: InstallAction | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  if (!validation || !action) return null;

  const install = action === "install";
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(
              install
                ? "courses.confirm.install.title"
                : "courses.confirm.draft.title",
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("courses.confirm.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <dl className="grid min-w-0 gap-3 rounded-lg border border-border bg-surface-soft p-4 text-sm">
          <ConfirmationDetail
            label={t("courses.confirm.revision")}
            value={validation.preview.revisionKey}
            code
          />
          <ConfirmationDetail
            label={t("courses.confirm.contentHash")}
            value={validation.preview.contentHash}
            code
          />
          <ConfirmationDetail
            label={t("courses.confirm.destination")}
            value={t(
              install
                ? "courses.confirm.install.destination"
                : "courses.confirm.draft.destination",
            )}
          />
          <ConfirmationDetail
            label={t("courses.confirm.consequence")}
            value={t(
              install
                ? "courses.confirm.install.consequence"
                : "courses.confirm.draft.consequence",
            )}
          />
        </dl>

        <AlertDialogFooter>
          <AlertDialogCancel>{t("courses.action.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {t(
              install
                ? "courses.confirm.install.action"
                : "courses.confirm.draft.action",
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmationDetail({
  label,
  value,
  code = false,
}: {
  label: string;
  value: string;
  code?: boolean;
}) {
  return (
    <div className="grid min-w-0 gap-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 break-words font-medium",
          code && "break-all font-mono text-xs",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{value}</dd>
    </div>
  );
}

function RequirementList({
  label,
  values,
}: {
  label: string;
  values: readonly string[];
}) {
  const { t } = useI18n();

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.length > 0 ? (
          values.map((value) => (
            <Badge
              key={value}
              variant="outline"
              className="max-w-full whitespace-normal break-all text-left"
            >
              {value}
            </Badge>
          ))
        ) : (
          <span className="text-muted-foreground">
            {t("courses.preview.notRequired")}
          </span>
        )}
      </div>
    </div>
  );
}

function DiagnosticList({
  diagnostics,
}: {
  diagnostics: readonly z.infer<typeof diagnosticSchema>[];
}) {
  return (
    <ul className="flex max-h-64 min-w-0 flex-col gap-2 overflow-y-auto pr-1">
      {diagnostics.map((diagnostic, index) => (
        <li
          key={`${diagnostic.code}:${diagnostic.path}:${index}`}
          className="min-w-0 rounded-lg border border-border bg-surface-soft p-3 text-sm"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={diagnostic.severity === "error" ? "error" : "warning"}
            >
              {diagnostic.code}
            </Badge>
            <code className="break-all font-mono text-xs text-muted-foreground">
              {diagnostic.path}
            </code>
          </div>
          <p className="mt-2 break-words leading-5">{diagnostic.message}</p>
        </li>
      ))}
    </ul>
  );
}

function CourseLibraryRow({
  course,
  revision,
  importedRevisions,
  packItem,
  current,
  selecting,
  uninstallingRevisionId,
  onSelect,
  onExport,
  onUninstall,
}: {
  course: LearningCourse;
  revision: LearningCourseRevision;
  importedRevisions: readonly CoursePackLibraryItem[];
  packItem?: CoursePackLibraryItem;
  current: boolean;
  selecting: boolean;
  uninstallingRevisionId: string | null;
  onSelect: () => void;
  onExport: (item: CoursePackLibraryItem) => void;
  onUninstall: (item: CoursePackLibraryItem) => void;
}) {
  const { formatDate, locale, t } = useI18n();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const studioPath = `/courses/studio?version=${encodeURIComponent(revision.id)}`;
  const revisionPath = `/courses/${encodeURIComponent(course.id)}/revisions/${encodeURIComponent(revision.id)}`;
  const primaryPath =
    current && course.currentSessionId
      ? `/session?id=${encodeURIComponent(course.currentSessionId)}`
      : revision.status === "draft"
        ? studioPath
        : revision.status === "published"
          ? revisionPath
          : null;
  const primaryLabel =
    current && course.currentSessionId
      ? t("courses.action.continue")
      : revision.status === "draft"
        ? t("courses.action.edit")
        : t("courses.action.open");
  const selectable = revision.status === "published";
  const studioAvailable = !packItem && revision.status === "published";
  const exportable = Boolean(packItem);
  const removable = Boolean(
    packItem && packItem.lifecycleAction !== "uninstall",
  );
  const uninstalling = uninstallingRevisionId === revision.id;
  const maintenancePending = selecting || uninstalling;
  const statusDotClass =
    revision.status === "published"
      ? "bg-success"
      : revision.status === "draft"
        ? "bg-warning"
        : "bg-muted-foreground";
  const progress = revision.learningSummary;
  const progressLabel = t("courses.progress.label", {
    percent: progress.progressPercent.toLocaleString(locale),
    completed: progress.completedLessons.toLocaleString(locale),
    total: progress.totalLessons.toLocaleString(locale),
  });
  const lastActivity = progress.lastActivityAt
    ? t("courses.progress.lastActivity", {
        date: formatDate(progress.lastActivityAt),
      })
    : t("courses.progress.neverOpened");

  return (
    <>
      <TableRow
        data-state={current ? "selected" : undefined}
        className={cn(
          "grid min-h-0 grid-cols-1 gap-4 px-4 py-4 data-[state=selected]:bg-primary/[0.035] md:table-row md:h-[100px] md:px-0 md:py-0",
        )}
      >
        <TableCell className="relative min-w-0 whitespace-normal p-0 md:table-cell md:px-6 md:py-4">
          {current ? (
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-[3px] bg-success"
            />
          ) : null}
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-control bg-secondary text-muted-foreground">
              <BookOpenIcon aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="min-w-0 break-words text-base font-semibold leading-5">
                  {course.title}
                </h3>
                {current ? (
                  <Badge variant="success">{t("courses.current.title")}</Badge>
                ) : null}
              </div>
              {course.description ? (
                <p className="mt-1 line-clamp-2 break-words text-sm leading-5 text-muted-foreground md:line-clamp-1">
                  {course.description}
                </p>
              ) : null}
            </div>
          </div>
        </TableCell>
        <TableCell className="min-w-0 whitespace-normal p-0 md:table-cell md:px-2 md:py-4">
          <p className="mb-1 text-xs font-medium text-muted-foreground md:hidden">
            {t("courses.table.revisionStatus")}
          </p>
          <p className="text-sm">
            {t("courses.library.revisionNumber", {
              revision: revision.revisionNumber.toLocaleString(locale),
            })}
          </p>
          <p className="mt-1 flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <span
              aria-hidden
              className={cn("size-1.5 shrink-0 rounded-full", statusDotClass)}
            />
            <span className="min-w-0 break-words">
              {t(statusLabels[revision.status])}
            </span>
          </p>
        </TableCell>
        <TableCell className="min-w-0 whitespace-normal p-0 md:table-cell md:px-2 md:py-4">
          <p className="mb-1 text-xs font-medium text-muted-foreground md:hidden">
            {t("courses.table.progress")}
          </p>
          <div className="flex min-w-0 items-center gap-3">
            <CourseProgressRing
              percent={progress.progressPercent}
              label={progressLabel}
            />
            <div className="min-w-0">
              <p className="text-sm">
                {t(learningStateLabels[progress.state])}
              </p>
              <p className="mt-1 min-w-0 break-words text-xs text-muted-foreground">
                {lastActivity}
              </p>
            </div>
          </div>
        </TableCell>
        <TableCell className="min-w-0 whitespace-normal p-0 md:table-cell md:px-2 md:py-4 md:text-right">
          <p className="mb-1 text-xs font-medium text-muted-foreground md:hidden">
            {t("courses.table.actions")}
          </p>
          <div className="flex min-w-0 items-center gap-1 md:justify-end">
            {primaryPath ? (
              <Button
                asChild
                size="sm"
                variant="outline"
                className="min-w-0 flex-1 md:flex-none"
              >
                <Link href={primaryPath}>
                  {primaryLabel}
                  {current && course.currentSessionId ? (
                    <ArrowRightIcon data-icon="inline-end" aria-hidden />
                  ) : (
                    <ArrowSquareOutIcon data-icon="inline-end" aria-hidden />
                  )}
                </Link>
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-w-0 flex-1 md:flex-none"
                disabled
              >
                {t("courses.action.unavailable")}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={t("courses.action.more", {
                    title: course.title,
                  })}
                  aria-busy={maintenancePending}
                >
                  {maintenancePending ? (
                    <Spinner aria-hidden />
                  ) : (
                    <DotsThreeVerticalIcon aria-hidden weight="bold" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuGroup>
                  {studioAvailable ? (
                    <DropdownMenuItem asChild>
                      <Link href={studioPath}>
                        <PencilSimpleIcon aria-hidden />
                        {t("courses.action.openStudio")}
                      </Link>
                    </DropdownMenuItem>
                  ) : null}
                  {selectable && !current ? (
                    <DropdownMenuItem disabled={selecting} onSelect={onSelect}>
                      {selecting ? (
                        <Spinner aria-hidden />
                      ) : (
                        <CheckCircleIcon aria-hidden />
                      )}
                      {t("courses.action.makeCurrent")}
                    </DropdownMenuItem>
                  ) : null}
                  {exportable && packItem ? (
                    <DropdownMenuItem onSelect={() => onExport(packItem)}>
                      <DownloadSimpleIcon aria-hidden />
                      {t("courses.action.export")}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuGroup>
                {studioAvailable || (selectable && !current) || exportable ? (
                  <DropdownMenuSeparator />
                ) : null}
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onSelect={() => setDetailsOpen((open) => !open)}
                  >
                    <InfoIcon aria-hidden />
                    {t("courses.library.details")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                {removable ? <DropdownMenuSeparator /> : null}
                {removable ? (
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={uninstalling}
                      onSelect={() => setRemoveOpen(true)}
                    >
                      <TrashIcon aria-hidden />
                      {t("courses.action.remove")}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
      </TableRow>
      <ImportedRevisionDisclosure
        course={course}
        importedRevisions={importedRevisions}
        uninstallingRevisionId={uninstallingRevisionId}
        onExport={onExport}
        onUninstall={onUninstall}
      />
      {detailsOpen ? (
        <TableRow className="grid md:table-row">
          <TableCell
            colSpan={4}
            className="min-w-0 whitespace-normal bg-surface-soft px-4 py-4 md:px-6"
          >
            <CourseTechnicalDetails
              course={course}
              revision={revision}
              {...(packItem ? { packItem } : {})}
            />
          </TableCell>
        </TableRow>
      ) : null}
      {removable ? (
        <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("courses.remove.title")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("courses.remove.description", {
                  revisionId: revision.id,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t("courses.action.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={uninstalling}
                onClick={() => {
                  if (packItem) onUninstall(packItem);
                }}
              >
                {uninstalling ? <Spinner data-icon="inline-start" /> : null}
                {t("courses.action.removeFromLibrary")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}

function ImportedRevisionDisclosure({
  course,
  importedRevisions,
  uninstallingRevisionId,
  onExport,
  onUninstall,
}: {
  course: LearningCourse;
  importedRevisions: readonly CoursePackLibraryItem[];
  uninstallingRevisionId: string | null;
  onExport: (item: CoursePackLibraryItem) => void;
  onUninstall: (item: CoursePackLibraryItem) => void;
}) {
  const { formatDate, locale, t } = useI18n();
  const contentId = useId();
  const [open, setOpen] = useState(false);
  const [removeTarget, setRemoveTarget] =
    useState<CoursePackLibraryItem | null>(null);

  if (importedRevisions.length === 0) return null;

  const revisionsLabel = t("courses.library.revisions", {
    count: importedRevisions.length.toLocaleString(locale),
  });
  const removePending =
    removeTarget !== null && uninstallingRevisionId === removeTarget.revisionId;

  return (
    <>
      <TableRow className="grid md:table-row">
        <TableCell
          colSpan={4}
          className="min-w-0 whitespace-normal border-t-0 px-4 py-2 md:px-6"
        >
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-11 max-w-full justify-start px-2"
                aria-label={`${course.title}: ${revisionsLabel}`}
                aria-controls={contentId}
              >
                <PackageIcon data-icon="inline-start" aria-hidden />
                <span className="min-w-0 truncate">{revisionsLabel}</span>
                <CaretDownIcon
                  data-icon="inline-end"
                  aria-hidden
                  className={cn("transition-transform", open && "rotate-180")}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent id={contentId}>
              <ul className="mt-2 flex min-w-0 flex-col gap-2 pb-2">
                {importedRevisions.map((item) => {
                  const revisionLabel = t("courses.library.revisionNumber", {
                    revision: item.revisionNumber.toLocaleString(locale),
                  });
                  const openPath =
                    item.revisionStatus === "draft"
                      ? `/courses/studio?version=${encodeURIComponent(item.revisionId)}`
                      : item.revisionStatus === "published"
                        ? `/courses/${encodeURIComponent(course.id)}/revisions/${encodeURIComponent(item.revisionId)}`
                        : null;
                  const openLabel =
                    item.revisionStatus === "draft"
                      ? t("courses.action.edit")
                      : t("courses.action.open");
                  const itemUninstalling =
                    uninstallingRevisionId === item.revisionId;
                  const removable = item.lifecycleAction !== "uninstall";

                  return (
                    <li
                      key={item.revisionId}
                      aria-label={revisionLabel}
                      className="flex min-w-0 flex-col gap-3 rounded-control border border-border bg-surface-soft p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="font-medium">{revisionLabel}</span>
                          <Badge
                            variant={
                              item.revisionStatus === "published"
                                ? "success"
                                : item.revisionStatus === "draft"
                                  ? "warning"
                                  : "outline"
                            }
                          >
                            {t(statusLabels[item.revisionStatus])}
                          </Badge>
                        </div>
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          {t("courses.library.importedAt", {
                            date: formatDate(item.importedAt),
                          })}
                        </p>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                        {openPath ? (
                          <Button asChild size="sm" variant="outline">
                            <Link
                              href={openPath}
                              aria-label={`${openLabel} · ${revisionLabel}`}
                            >
                              {openLabel}
                              <ArrowSquareOutIcon
                                data-icon="inline-end"
                                aria-hidden
                              />
                            </Link>
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled
                            aria-label={`${t("courses.action.unavailable")} · ${revisionLabel}`}
                          >
                            {t("courses.action.unavailable")}
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={`${t("courses.action.export")} · ${revisionLabel}`}
                          onClick={() => onExport(item)}
                        >
                          <DownloadSimpleIcon
                            data-icon="inline-start"
                            aria-hidden
                          />
                          {t("courses.action.export")}
                        </Button>
                        {removable ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={itemUninstalling}
                            aria-busy={itemUninstalling}
                            aria-label={`${t("courses.action.remove")} · ${revisionLabel}`}
                            onClick={() => setRemoveTarget(item)}
                          >
                            {itemUninstalling ? (
                              <Spinner data-icon="inline-start" aria-hidden />
                            ) : (
                              <TrashIcon data-icon="inline-start" aria-hidden />
                            )}
                            {t("courses.action.remove")}
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        </TableCell>
      </TableRow>
      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setRemoveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("courses.remove.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("courses.remove.description", {
                revisionId: removeTarget?.revisionId ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("courses.action.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removePending}
              onClick={() => {
                if (removeTarget) onUninstall(removeTarget);
              }}
            >
              {removePending ? <Spinner data-icon="inline-start" /> : null}
              {t("courses.action.removeFromLibrary")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function CourseProgressRing({
  percent,
  label,
}: {
  percent: number;
  label: string;
}) {
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percent / 100);

  return (
    <div
      role="img"
      aria-label={label}
      className="flex shrink-0 items-center gap-2"
    >
      <svg aria-hidden viewBox="0 0 40 40" className="size-9 -rotate-90">
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          strokeWidth="4"
          className="stroke-muted"
        />
        <circle
          cx="20"
          cy="20"
          r={radius}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="stroke-success"
        />
      </svg>
      <span aria-hidden className="text-sm font-medium tabular-nums">
        {percent}%
      </span>
    </div>
  );
}

function CourseTechnicalDetails({
  course,
  revision,
  packItem,
}: {
  course: LearningCourse;
  revision: LearningCourseRevision;
  packItem?: CoursePackLibraryItem;
}) {
  const { formatDate, t } = useI18n();

  return (
    <dl className="grid min-w-0 gap-x-6 gap-y-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <div className="min-w-0">
        <dt className="text-muted-foreground">
          {t("courses.library.courseId")}
        </dt>
        <dd className="mt-1 break-all font-mono">{course.stableId}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-muted-foreground">
          {t("courses.library.revisionId")}
        </dt>
        <dd className="mt-1 break-all font-mono">{revision.id}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-muted-foreground">
          {t("courses.preview.contentHash")}
        </dt>
        <dd className="mt-1 break-all font-mono">
          {revision.contentHash ?? t("courses.library.hashUnavailable")}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-muted-foreground">{t("courses.library.source")}</dt>
        <dd className="mt-1 break-words">
          {packItem
            ? t("courses.library.importedAt", {
                date: formatDate(packItem.importedAt),
              })
            : t("courses.library.localRevision")}
        </dd>
      </div>
    </dl>
  );
}

function CourseLibrarySkeleton() {
  const { t } = useI18n();

  return (
    <div
      className="flex flex-col gap-5"
      role="status"
      aria-label={t("courses.library.loading")}
    >
      <span className="sr-only">{t("courses.library.loading")}</span>
      <div aria-hidden className="flex gap-3">
        <Skeleton className="h-10 w-full max-w-sm" />
        <Skeleton className="hidden h-10 w-24 sm:block" />
      </div>
      <div
        aria-hidden
        data-slot="course-library-skeleton"
        className="overflow-hidden rounded-panel bg-surface-raised shadow-sm"
      >
        {["course-skeleton-one", "course-skeleton-two"].map((key) => (
          <div
            key={key}
            className="grid min-h-[100px] gap-3 border-b border-border p-4 last:border-b-0 md:grid-cols-[minmax(0,2fr)_minmax(0,0.9fr)_minmax(0,1.3fr)_auto] md:items-center md:px-6"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="size-11 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-9 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}

async function exportPack(
  item: CoursePackLibraryItem,
  formatError: (status: number) => string,
): Promise<void> {
  const response = await fetch(
    `/api/course-packs/export?revisionId=${encodeURIComponent(item.revisionId)}`,
    { headers: { "X-Aptiloop-Client": "web" } },
  );
  if (!response.ok) throw new Error(formatError(response.status));
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${item.revisionId.replaceAll(/[^A-Za-z0-9._-]/gu, "-")}.course-pack.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
