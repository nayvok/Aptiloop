"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { z } from "zod";

const DRAFT_VERSION = 1 as const;
const MAX_DRAFT_TEXT_LENGTH = 50_000;
const MAX_DRAFT_ITEMS = 500;
const MAX_DRAFT_RECORD_TEXT_LENGTH = 250_000;
const MAX_STORED_DRAFT_LENGTH = 2_000_000;
const draftIdSchema = z.string().trim().min(1).max(1_024);
const draftTextSchema = z.string().max(MAX_DRAFT_TEXT_LENGTH);

function uniqueIds(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function boundedRecord<Value extends z.ZodType>(valueSchema: Value) {
  return z.record(draftIdSchema, valueSchema).superRefine((value, context) => {
    if (Object.keys(value).length > MAX_DRAFT_ITEMS) {
      context.addIssue({
        code: "custom",
        message: "Too many activity draft fields",
      });
    }
    if (
      Object.values(value).reduce(
        (length, item) => length + String(item).length,
        0,
      ) > MAX_DRAFT_RECORD_TEXT_LENGTH
    ) {
      context.addIssue({
        code: "custom",
        message: "Activity draft fields are too large",
      });
    }
  });
}

export const studyActivityDraftSchema = z
  .object({
    type: z.literal("study"),
    checkedItemIds: z
      .array(draftIdSchema)
      .max(MAX_DRAFT_ITEMS)
      .refine(uniqueIds),
    notes: draftTextSchema,
  })
  .strict();

export const recallActivityDraftSchema = z
  .object({
    type: z.literal("recall"),
    answers: boundedRecord(draftTextSchema),
  })
  .strict();

export const teacherDialogueActivityDraftSchema = z
  .object({
    type: z.literal("teacher-dialogue"),
    revision: draftTextSchema,
  })
  .strict();

export const quizActivityDraftSchema = z
  .object({
    type: z.literal("quiz"),
    answers: boundedRecord(draftIdSchema),
  })
  .strict();

export const codeReadingActivityDraftSchema = z
  .object({
    type: z.literal("code-reading"),
    prediction: draftTextSchema,
    explanation: draftTextSchema,
    verbalFix: draftTextSchema,
  })
  .strict();

export type LessonActivityDraftIdentity = {
  learningSessionId: string;
  currentStep: string;
  revisionId: string;
  snapshotId: string;
  snapshotHash: string;
  activityId: string;
  activityStableId: string;
  activityType: string;
};

const lessonActivityDraftIdentitySchema = z
  .object({
    learningSessionId: draftIdSchema,
    currentStep: draftIdSchema,
    revisionId: draftIdSchema,
    snapshotId: draftIdSchema,
    snapshotHash: draftIdSchema,
    activityId: draftIdSchema,
    activityStableId: draftIdSchema,
    activityType: draftIdSchema,
  })
  .strict();

const storedLessonActivityDraftSchema = z
  .object({
    version: z.literal(DRAFT_VERSION),
    identity: lessonActivityDraftIdentitySchema,
    draft: z.unknown(),
  })
  .strict();

export function lessonActivityDraftStorageKey(
  identity: LessonActivityDraftIdentity,
) {
  const fields = [
    identity.learningSessionId,
    identity.currentStep,
    identity.revisionId,
    identity.snapshotId,
    identity.snapshotHash,
    identity.activityId,
    identity.activityStableId,
    identity.activityType,
  ];
  return `aptiloop:lesson-activity-draft:v${DRAFT_VERSION}:${fields
    .map((field) => encodeURIComponent(field))
    .join(":")}`;
}

function sameIdentity(
  left: LessonActivityDraftIdentity,
  right: LessonActivityDraftIdentity,
) {
  return (
    left.learningSessionId === right.learningSessionId &&
    left.currentStep === right.currentStep &&
    left.revisionId === right.revisionId &&
    left.snapshotId === right.snapshotId &&
    left.snapshotHash === right.snapshotHash &&
    left.activityId === right.activityId &&
    left.activityStableId === right.activityStableId &&
    left.activityType === right.activityType
  );
}

function removeStoredDraft(storageKey: string) {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Storage is optional. The activity remains usable when it is unavailable.
  }
}

function readStoredDraft<Value>(
  storageKey: string,
  identity: LessonActivityDraftIdentity,
  schema: z.ZodType<Value>,
) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    if (raw.length > MAX_STORED_DRAFT_LENGTH) {
      removeStoredDraft(storageKey);
      return null;
    }
    const envelope = storedLessonActivityDraftSchema.safeParse(JSON.parse(raw));
    if (!envelope.success || !sameIdentity(envelope.data.identity, identity)) {
      removeStoredDraft(storageKey);
      return null;
    }
    const draft = schema.safeParse(envelope.data.draft);
    if (!draft.success) {
      removeStoredDraft(storageKey);
      return null;
    }
    return draft.data;
  } catch {
    removeStoredDraft(storageKey);
    return null;
  }
}

function writeStoredDraft<Value>(
  storageKey: string,
  identity: LessonActivityDraftIdentity,
  schema: z.ZodType<Value>,
  draft: Value,
) {
  const parsedIdentity = lessonActivityDraftIdentitySchema.safeParse(identity);
  const parsedDraft = schema.safeParse(draft);
  if (!parsedIdentity.success || !parsedDraft.success) {
    removeStoredDraft(storageKey);
    return;
  }
  try {
    const serialized = JSON.stringify({
      version: DRAFT_VERSION,
      identity: parsedIdentity.data,
      draft: parsedDraft.data,
    });
    if (serialized.length > MAX_STORED_DRAFT_LENGTH) {
      removeStoredDraft(storageKey);
      return;
    }
    window.localStorage.setItem(storageKey, serialized);
  } catch {
    removeStoredDraft(storageKey);
  }
}

type DraftState<Value> = {
  storageKey: string | null;
  value: Value;
  dirty: boolean;
};

export function useLessonActivityDraft<Value>(
  identity: LessonActivityDraftIdentity,
  schema: z.ZodType<Value>,
  initialValue: Value,
): {
  value: Value;
  setValue: Dispatch<SetStateAction<Value>>;
  clear: (nextValue?: Value) => void;
} {
  const storageKey = lessonActivityDraftStorageKey(identity);
  const identityRef = useRef(identity);
  const schemaRef = useRef(schema);
  const initialValueRef = useRef(initialValue);
  identityRef.current = identity;
  schemaRef.current = schema;
  initialValueRef.current = initialValue;
  const [state, setState] = useState<DraftState<Value>>({
    storageKey: null,
    value: initialValue,
    dirty: false,
  });

  useEffect(() => {
    const restored = readStoredDraft(
      storageKey,
      identityRef.current,
      schemaRef.current,
    );
    setState({
      storageKey,
      value: restored ?? initialValueRef.current,
      dirty: restored !== null,
    });
  }, [storageKey]);

  useEffect(() => {
    if (state.storageKey !== storageKey) return;
    if (!state.dirty) {
      removeStoredDraft(storageKey);
      return;
    }
    writeStoredDraft(
      storageKey,
      identityRef.current,
      schemaRef.current,
      state.value,
    );
  }, [state, storageKey]);

  const value = state.storageKey === storageKey ? state.value : initialValue;
  const setValue: Dispatch<SetStateAction<Value>> = (action) => {
    setState((current) => {
      const currentValue =
        current.storageKey === storageKey
          ? current.value
          : initialValueRef.current;
      const nextValue =
        typeof action === "function"
          ? (action as (current: Value) => Value)(currentValue)
          : action;
      return { storageKey, value: nextValue, dirty: true };
    });
  };
  const clear = (nextValue: Value = initialValueRef.current) => {
    removeStoredDraft(storageKey);
    setState({ storageKey, value: nextValue, dirty: false });
  };

  return { value, setValue, clear };
}
