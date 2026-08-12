"use client";

import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { api } from "@/lib/api";
import {
  type MessageKey,
  type UiLocale,
  useI18n,
  isUiLocale,
} from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/loading-state";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/components/ui/popover";
import { QueryError, SafeQueryError } from "@/components/query-state";
import {
  ProviderConnectionManager,
  type ProviderConnectionSummary,
  type ProviderManagementSettings,
} from "@/components/provider-connection-manager";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ThemePreference = "system" | "light" | "dark";
type AiRole = "course-designer" | "tutor" | "evaluator" | "reviewer";
type SettingsSection = "interface" | "ai" | "connections" | "advanced";
type ProviderCapability =
  "streaming" | "models" | "tools" | "structured-output" | "cancellation";
type RoleOverrides = Partial<Record<AiRole, string>>;
type RoleProfile = {
  role: AiRole;
  mode: "no-ai" | "connection";
  connectionId: string | null;
  modelId: string | null;
  requiredCapabilities: ProviderCapability[];
  toolPolicyId: string;
  budgets: {
    maxInputBytes: number;
    maxOutputBytes: number;
    maxEvents: number;
    maxToolCalls: number;
    deadlineMs: number;
  };
};
type ObservedCapabilityProfile = {
  providerType: string;
  adapterVersion: string;
  observedAt: string;
  models: Array<{
    modelId: string;
    available: boolean;
    contextTokens: number | null;
    outputTokens: number | null;
    typedToolCalls: "none" | "best-effort" | "schema-constrained";
    parallelToolCalls: boolean;
    attachments: Array<"text" | "image">;
  }>;
  connection: {
    authenticated: boolean;
    streaming: boolean;
    cancellation: boolean;
  };
};
type Connection = Omit<
  ProviderConnectionSummary,
  "providerType" | "lastCheckedAt" | "observedCapabilities"
> & {
  adapterId: string;
  providerType: string;
  credentialRef: string | null;
  endpointProfileId: string | null;
  lastCheckedAt: string | null;
  observedCapabilities: ObservedCapabilityProfile | null;
};
type SettingsQuery = {
  workspaceRoot: string;
  zedExecutable: string;
  opencodeBaseUrl: string;
  ai: {
    connections: Connection[];
    roleProfiles: RoleProfile[];
    management: ProviderManagementSettings;
  };
};

const roleMeta: ReadonlyArray<{
  role: AiRole;
  label: MessageKey;
  help: MessageKey;
}> = [
  {
    role: "course-designer",
    label: "role.courseDesigner",
    help: "role.courseDesigner.help",
  },
  { role: "tutor", label: "role.tutor", help: "role.tutor.help" },
  {
    role: "evaluator",
    label: "role.evaluator",
    help: "role.evaluator.help",
  },
  {
    role: "reviewer",
    label: "role.reviewer",
    help: "role.reviewer.help",
  },
];
const settingsSections: ReadonlyArray<{
  value: SettingsSection;
  label: MessageKey;
}> = [
  { value: "interface", label: "settings.section.interface" },
  { value: "ai", label: "settings.section.ai" },
  { value: "connections", label: "settings.section.connections" },
  { value: "advanced", label: "settings.section.local" },
];
type AssignmentReadiness = {
  state:
    | "off"
    | "ready"
    | "authentication"
    | "degraded"
    | "unknown"
    | "unavailable"
    | "unsupported";
  capability?: ProviderCapability;
};
type ModelOption = {
  value: string;
  label: string;
  disabled?: boolean;
  description?: string;
};

const readinessStateKeys: Readonly<
  Record<AssignmentReadiness["state"], MessageKey>
> = {
  off: "authoring.connected.state.off",
  ready: "authoring.connected.state.ready",
  authentication: "settings.status.authentication",
  degraded: "settings.status.degraded",
  unknown: "authoring.connected.state.unknown",
  unavailable: "authoring.connected.state.unavailable",
  unsupported: "authoring.connected.state.unsupported",
};

function isSettingsSection(value: string | null): value is SettingsSection {
  return settingsSections.some((section) => section.value === value);
}

function assignmentReadiness(
  profile: RoleProfile,
  connections: Connection[],
): AssignmentReadiness {
  if (profile.mode === "no-ai") return { state: "off" };
  if (!profile.connectionId || !profile.modelId) {
    return { state: "unavailable" };
  }

  const connection = connections.find(
    (candidate) => candidate.connectionId === profile.connectionId,
  );
  if (!connection?.enabled) return { state: "unavailable" };
  if (connection.state === "authentication-required") {
    return { state: "authentication" };
  }
  if (connection.state !== "connected" && connection.state !== "degraded") {
    return { state: "unavailable" };
  }

  const observed = connection.observedCapabilities;
  if (!observed) return { state: "unknown" };
  if (connection.state === "connected" && !observed.connection.authenticated) {
    return { state: "authentication" };
  }
  const model = observed.models.find(
    (candidate) => candidate.modelId === profile.modelId,
  );
  if (!model?.available) return { state: "unavailable" };

  let unavailableCapability: ProviderCapability | undefined;
  let unknownCapability: ProviderCapability | undefined;
  for (const capability of profile.requiredCapabilities) {
    let supported: boolean | null;
    switch (capability) {
      case "models":
        supported = true;
        break;
      case "streaming":
        supported = observed.connection.streaming;
        break;
      case "cancellation":
        supported = observed.connection.cancellation;
        break;
      case "tools":
        supported = model.typedToolCalls !== "none";
        break;
      case "structured-output":
        supported = null;
        break;
      default:
        supported = null;
    }
    if (supported === false) unavailableCapability ??= capability;
    if (supported === null) unknownCapability ??= capability;
  }

  if (unavailableCapability) {
    return { state: "unsupported", capability: unavailableCapability };
  }
  if (unknownCapability) {
    return { state: "unknown", capability: unknownCapability };
  }
  return {
    state: connection.state === "degraded" ? "degraded" : "ready",
  };
}

function aggregateReadiness(
  profiles: RoleProfile[],
  connections: Connection[],
): AssignmentReadiness {
  const readiness = profiles.map((profile) =>
    assignmentReadiness(profile, connections),
  );
  for (const state of [
    "authentication",
    "unavailable",
    "unsupported",
    "unknown",
    "degraded",
  ] as const) {
    const match = readiness.find((candidate) => candidate.state === state);
    if (match) return match;
  }
  return (
    readiness.find((candidate) => candidate.state === "ready") ?? {
      state: "off",
    }
  );
}

function readinessBadgeVariant(
  state: AssignmentReadiness["state"],
): "success" | "warning" | "error" | "secondary" {
  if (state === "ready") return "success";
  if (state === "unknown" || state === "degraded") return "warning";
  if (
    state === "authentication" ||
    state === "unavailable" ||
    state === "unsupported"
  ) {
    return "error";
  }
  return "secondary";
}

function modelDisabledReason(
  connection: Connection,
  modelAvailable: boolean,
): MessageKey | null {
  if (!connection.enabled) return "settings.status.off";
  if (connection.state === "authentication-required") {
    return "settings.status.authentication";
  }
  if (connection.state !== "connected" && connection.state !== "degraded") {
    return "settings.status.unavailable";
  }
  if (!connection.observedCapabilities) {
    return "authoring.connected.state.unknown";
  }
  if (
    connection.state === "connected" &&
    !connection.observedCapabilities.connection.authenticated
  ) {
    return "settings.status.authentication";
  }
  if (!modelAvailable) return "settings.status.unavailable";
  return null;
}

const sectionClass = "min-w-0 scroll-mt-20";
const sectionSurfaceClass =
  "mt-4 min-w-0 overflow-hidden rounded-xl border border-border/60 bg-background";

const sectionHeadingClass =
  "text-pretty text-lg font-semibold tracking-[-0.015em]";
const sectionDescriptionClass =
  "mt-1 max-w-[62ch] text-pretty text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]";

function exactSelectionValue(connectionId: string, modelId: string): string {
  return `${encodeURIComponent(connectionId)}|${encodeURIComponent(modelId)}`;
}

function selectionValue(profile: RoleProfile): string {
  return profile.mode === "connection" &&
    profile.connectionId &&
    profile.modelId
    ? exactSelectionValue(profile.connectionId, profile.modelId)
    : "off";
}

function withSelection(profile: RoleProfile, value: string): RoleProfile {
  if (value === "off") {
    return {
      ...profile,
      mode: "no-ai",
      connectionId: null,
      modelId: null,
    };
  }
  const encoded = value.split("|");
  if (encoded.length !== 2 || !encoded[0] || !encoded[1]) return profile;
  let connectionId: string;
  let modelId: string;
  try {
    connectionId = decodeURIComponent(encoded[0]);
    modelId = decodeURIComponent(encoded[1]);
  } catch {
    return profile;
  }
  return {
    ...profile,
    mode: "connection",
    connectionId,
    modelId,
  };
}

function uniformSelection(profiles: RoleProfile[]): string | null {
  const first = profiles[0];
  if (!first) return "off";
  const value = selectionValue(first);
  return profiles.every((profile) => selectionValue(profile) === value)
    ? value
    : null;
}

function nextEnabledIndex(
  options: ModelOption[],
  currentIndex: number,
  direction: 1 | -1,
): number {
  if (!options.length) return -1;
  const origin = currentIndex < 0 ? (direction === 1 ? -1 : 0) : currentIndex;
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index =
      (origin + direction * offset + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

function ModelCombobox({
  id,
  value,
  selectedLabel,
  options,
  searchLabel,
  noMatchesLabel,
  onValueChange,
}: {
  id: string;
  value: string;
  selectedLabel: string;
  options: ModelOption[];
  searchLabel: string;
  noMatchesLabel: string;
  onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = `${id}-listbox`;
  const normalizedQuery = normalizeTechnicalModelSearch(query);
  const filteredOptions = useMemo(
    () =>
      normalizedQuery
        ? options.filter((option) =>
            normalizeTechnicalModelSearch(
              `${option.label} ${option.description ?? ""}`,
            ).includes(normalizedQuery),
          )
        : options,
    [normalizedQuery, options],
  );

  useEffect(() => {
    setActiveIndex(filteredOptions.findIndex((option) => !option.disabled));
  }, [filteredOptions]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document
      .getElementById(`${id}-option-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, id, open]);

  const chooseOption = (option: ModelOption | undefined) => {
    if (!option || option.disabled) return;
    onValueChange(option.value);
    setOpen(false);
  };

  return (
    <PopoverRoot
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-haspopup="listbox"
          className="h-auto min-h-10 w-full justify-between gap-3 px-3 py-2 text-left font-normal"
        >
          <span className="min-w-0 truncate">{selectedLabel}</span>
          <CaretDownIcon
            className="shrink-0 text-muted-foreground"
            aria-hidden
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"
      >
        <div className="border-b border-border/60 p-2">
          <Input
            value={query}
            aria-label={searchLabel}
            aria-controls={listboxId}
            aria-activedescendant={
              activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
            }
            placeholder={searchLabel}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((current) =>
                  nextEnabledIndex(
                    filteredOptions,
                    current,
                    event.key === "ArrowDown" ? 1 : -1,
                  ),
                );
              } else if (event.key === "Home") {
                event.preventDefault();
                setActiveIndex(
                  filteredOptions.findIndex((option) => !option.disabled),
                );
              } else if (event.key === "End") {
                event.preventDefault();
                setActiveIndex(nextEnabledIndex(filteredOptions, 0, -1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                chooseOption(filteredOptions[activeIndex]);
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
          />
        </div>
        <div
          id={listboxId}
          role="listbox"
          aria-label={searchLabel}
          data-slot="model-options"
          className="max-h-72 overflow-y-auto overscroll-contain p-1"
        >
          {filteredOptions.length ? (
            filteredOptions.map((option, index) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  id={`${id}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-disabled={option.disabled || undefined}
                  disabled={option.disabled}
                  tabIndex={-1}
                  className={`flex w-full min-w-0 items-start gap-2 rounded-control px-2 py-2 text-left text-sm outline-none transition-colors motion-reduce:transition-none ${
                    activeIndex === index
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent hover:text-accent-foreground"
                  } disabled:cursor-not-allowed disabled:opacity-55`}
                  onMouseMove={() => {
                    if (!option.disabled) setActiveIndex(index);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseOption(option)}
                >
                  <CheckIcon
                    className={`mt-0.5 shrink-0 ${selected ? "opacity-100" : "opacity-0"}`}
                    aria-hidden
                  />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="block">{option.label}</span>
                    {option.description ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })
          ) : (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {noMatchesLabel}
            </p>
          )}
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}

export function normalizeTechnicalModelSearch(value: string): string {
  return value.trim().toLowerCase();
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function SettingsSectionNavigation({
  activeSection,
  navigateToSection,
}: {
  activeSection: SettingsSection;
  navigateToSection: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <div data-slot="settings-mobile-section-control" className="xl:hidden">
        <Field>
          <FieldLabel htmlFor="settings-mobile-section" className="sr-only">
            {t("nav.settings")}
          </FieldLabel>
          <Select value={activeSection} onValueChange={navigateToSection}>
            <SelectTrigger id="settings-mobile-section" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {settingsSections.map((section) => (
                  <SelectItem key={section.value} value={section.value}>
                    {t(section.label)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div data-slot="settings-local-navigation" className="hidden xl:block">
        <TabsList
          aria-label={t("nav.settings")}
          variant="rail"
          className="sticky top-20 h-auto w-full flex-col items-stretch gap-0.5 rounded-xl bg-surface-soft/35 p-1"
        >
          {settingsSections.map((section) => (
            <TabsTrigger
              key={section.value}
              value={section.value}
              className="min-h-10 flex-none justify-start rounded-lg border-0 px-3.5 py-2 text-left leading-5 whitespace-normal shadow-none before:absolute before:inset-y-2 before:left-1 before:w-0.5 before:rounded-full before:bg-primary before:opacity-0 before:transition-opacity data-[state=active]:before:opacity-100 after:hidden motion-reduce:before:transition-none"
            >
              {t(section.label)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </>
  );
}

function SettingsLayout({
  activeSection,
  navigateToSection,
  children,
}: {
  activeSection: SettingsSection;
  navigateToSection: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div data-slot="settings-form" className="flex min-w-0 flex-col">
      <Tabs
        value={activeSection}
        onValueChange={navigateToSection}
        orientation="vertical"
        className="min-w-0 flex-col gap-5 xl:grid xl:grid-cols-[11.5rem_minmax(0,1fr)] xl:items-start xl:gap-6 2xl:grid-cols-[12.5rem_minmax(0,1fr)]"
      >
        <SettingsSectionNavigation
          activeSection={activeSection}
          navigateToSection={navigateToSection}
        />
        <div
          data-slot="settings-selected-pane"
          className="min-w-0 xl:max-w-[68rem]"
        >
          {children}
        </div>
      </Tabs>
    </div>
  );
}

function browserPreferenceStorageAvailable(): boolean {
  try {
    const key = "aptiloop:preference-storage-check";
    window.localStorage.setItem(key, "1");
    window.localStorage.removeItem(key);
    window.sessionStorage.setItem(key, "1");
    window.sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

const uiLocaleDraftStorageKey = "aptiloop:ui-locale-draft";

function readLocaleDraft(): {
  available: boolean;
  locale: UiLocale | null;
} {
  try {
    const value = window.sessionStorage.getItem(uiLocaleDraftStorageKey);
    if (value === null) return { available: true, locale: null };
    if (isUiLocale(value)) return { available: true, locale: value };
    window.sessionStorage.removeItem(uiLocaleDraftStorageKey);
    return { available: true, locale: null };
  } catch {
    return { available: false, locale: null };
  }
}

function persistLocaleDraft(locale: UiLocale): boolean {
  try {
    window.sessionStorage.setItem(uiLocaleDraftStorageKey, locale);
    return true;
  } catch {
    return false;
  }
}

function clearLocaleDraft(): boolean {
  try {
    window.sessionStorage.removeItem(uiLocaleDraftStorageKey);
    return true;
  } catch {
    return false;
  }
}

type LocaleSaveStatus = "idle" | "saved" | "error";

function InterfaceSettingsPane({
  draftLocale,
  localeDirty,
  localeSaveStatus,
  storageAvailable,
  onDraftLocaleChange,
  onCancelLocale,
  onSaveLocale,
  onStorageAvailabilityChange,
}: {
  draftLocale: UiLocale;
  localeDirty: boolean;
  localeSaveStatus: LocaleSaveStatus;
  storageAvailable: boolean | null;
  onDraftLocaleChange: (locale: UiLocale) => void;
  onCancelLocale: () => void;
  onSaveLocale: () => void;
  onStorageAvailabilityChange: (available: boolean) => void;
}) {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const [themeMounted, setThemeMounted] = useState(false);
  const themeValue = isThemePreference(theme) ? theme : "system";

  useEffect(() => {
    setThemeMounted(true);
  }, []);

  return (
    <TabsContent value="interface">
      <section
        aria-labelledby="settings-interface-title"
        className={sectionClass}
      >
        <header className="mb-4 min-w-0">
          <h2 id="settings-interface-title" className={sectionHeadingClass}>
            {t("settings.section.interface")}
          </h2>
          <p className={sectionDescriptionClass}>
            {t("settings.section.interfaceDescription")}
          </p>
        </header>

        <FieldGroup className="gap-0 rounded-xl bg-surface-soft/50 px-4 sm:px-5">
          <Field
            orientation="responsive"
            className="gap-4 border-b border-border/35 py-4 @md/field-group:grid @md/field-group:grid-cols-[minmax(12rem,1fr)_minmax(13rem,18rem)] @md/field-group:items-center"
          >
            <FieldContent className="min-w-0">
              <FieldLabel htmlFor="theme">{t("settings.theme")}</FieldLabel>
              <FieldDescription>{t("settings.theme.help")}</FieldDescription>
            </FieldContent>
            {themeMounted ? (
              <Select
                value={themeValue}
                onValueChange={(value) => {
                  if (!isThemePreference(value)) return;
                  setTheme(value);
                  onStorageAvailabilityChange(
                    browserPreferenceStorageAvailable(),
                  );
                }}
              >
                <SelectTrigger id="theme" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="system">
                      {t("shell.theme.system")}
                    </SelectItem>
                    <SelectItem value="light">
                      {t("shell.theme.light")}
                    </SelectItem>
                    <SelectItem value="dark">
                      {t("shell.theme.dark")}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : (
              <div
                role="status"
                aria-label={t("query.loadingSettings")}
                className="w-full"
              >
                <span className="sr-only">{t("query.loadingSettings")}</span>
                <Skeleton aria-hidden className="h-11 w-full" />
              </div>
            )}
          </Field>
          <Field
            orientation="responsive"
            className="gap-4 py-4 @md/field-group:grid @md/field-group:grid-cols-[minmax(12rem,1fr)_minmax(13rem,18rem)] @md/field-group:items-center"
          >
            <FieldContent className="min-w-0">
              <FieldLabel htmlFor="ui-locale">
                {t("settings.locale")}
              </FieldLabel>
              <FieldDescription>{t("settings.locale.help")}</FieldDescription>
            </FieldContent>
            <Select
              value={draftLocale}
              onValueChange={(value) => {
                if (!isUiLocale(value)) return;
                onDraftLocaleChange(value);
              }}
            >
              <SelectTrigger id="ui-locale" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="en-US">
                    {t("locale.option.english")}
                  </SelectItem>
                  <SelectItem value="ru-RU">
                    {t("locale.option.russian")}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <div
            data-slot="settings-interface-footer"
            className="flex flex-col gap-3 border-t border-border/35 py-3.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              {storageAvailable === false ? (
                <span role="alert" className="text-sm text-warning-foreground">
                  {t("settings.localStorageUnavailable")}
                </span>
              ) : localeSaveStatus === "error" ? (
                <span role="alert" className="text-sm text-destructive">
                  {t("settings.saveError")}
                </span>
              ) : (
                <span
                  role="status"
                  aria-live="polite"
                  className="text-xs leading-5 text-muted-foreground"
                >
                  {t(
                    localeDirty
                      ? "settings.locale.unsaved"
                      : localeSaveStatus === "saved"
                        ? "settings.saved"
                        : "settings.localOnly",
                  )}
                </span>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!localeDirty}
                onClick={onCancelLocale}
              >
                {t("settings.cancel")}
              </Button>
              <Button
                type="button"
                disabled={!localeDirty}
                onClick={onSaveLocale}
              >
                {t("settings.save")}
              </Button>
            </div>
          </div>
        </FieldGroup>
      </section>
    </TabsContent>
  );
}

export function SettingsForm() {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, setLocale, t } = useI18n();
  const requestedSection = searchParams.get("section");
  const activeSection = isSettingsSection(requestedSection)
    ? requestedSection
    : "interface";
  const searchParamString = searchParams.toString();
  const [roleProfiles, setRoleProfiles] = useState<RoleProfile[]>([]);
  const [defaultAiSelection, setDefaultAiSelection] = useState("off");
  const [roleOverrides, setRoleOverrides] = useState<RoleOverrides>({});
  const [draftLocale, setDraftLocale] = useState<UiLocale>(locale);
  const [localeDraftEdited, setLocaleDraftEdited] = useState(false);
  const [localeDraftHydrated, setLocaleDraftHydrated] = useState(false);
  const [localeSaveStatus, setLocaleSaveStatus] =
    useState<LocaleSaveStatus>("idle");
  const [storageAvailable, setStorageAvailable] = useState<boolean | null>(
    null,
  );
  const localeDirty = draftLocale !== locale;
  useEffect(() => {
    const storedDraft = readLocaleDraft();
    const storageReady =
      storedDraft.available && browserPreferenceStorageAvailable();
    setStorageAvailable(storageReady);
    if (storedDraft.locale && storedDraft.locale !== locale) {
      setDraftLocale(storedDraft.locale);
      setLocaleDraftEdited(true);
    } else if (storedDraft.locale) {
      clearLocaleDraft();
      setDraftLocale(locale);
      setLocaleDraftEdited(false);
    }
    setLocaleDraftHydrated(true);
  }, [locale]);
  useEffect(() => {
    if (!localeDraftHydrated || localeDraftEdited) return;
    setDraftLocale(locale);
  }, [locale, localeDraftEdited, localeDraftHydrated]);
  const updateDraftStorage = (nextLocale: UiLocale) => {
    const available =
      nextLocale === locale
        ? clearLocaleDraft()
        : persistLocaleDraft(nextLocale);
    setStorageAvailable(available && browserPreferenceStorageAvailable());
    return available;
  };
  const interfaceSettingsPane = (
    <InterfaceSettingsPane
      draftLocale={draftLocale}
      localeDirty={localeDirty}
      localeSaveStatus={localeSaveStatus}
      storageAvailable={storageAvailable}
      onDraftLocaleChange={(nextLocale) => {
        setDraftLocale(nextLocale);
        setLocaleDraftEdited(nextLocale !== locale);
        setLocaleSaveStatus("idle");
        updateDraftStorage(nextLocale);
      }}
      onCancelLocale={() => {
        const cleared = clearLocaleDraft();
        setDraftLocale(locale);
        setLocaleDraftEdited(false);
        setLocaleSaveStatus("idle");
        setStorageAvailable(cleared && browserPreferenceStorageAvailable());
      }}
      onSaveLocale={() => {
        if (!browserPreferenceStorageAvailable()) {
          setStorageAvailable(false);
          setLocaleSaveStatus("error");
          return;
        }
        if (!clearLocaleDraft()) {
          setStorageAvailable(false);
          setLocaleSaveStatus("error");
          return;
        }
        const saved = setLocale(draftLocale);
        if (!saved) persistLocaleDraft(draftLocale);
        setStorageAvailable(saved);
        setLocaleSaveStatus(saved ? "saved" : "error");
        if (saved) setLocaleDraftEdited(false);
      }}
      onStorageAvailabilityChange={setStorageAvailable}
    />
  );
  useEffect(() => {
    if (requestedSection === null || isSettingsSection(requestedSection)) {
      return;
    }
    const next = new URLSearchParams(searchParamString);
    next.delete("section");
    const serialized = next.toString();
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, {
      scroll: false,
    });
  }, [pathname, requestedSection, router, searchParamString]);
  const query = useQuery({
    queryKey: ["settings", "page"],
    queryFn: () => api<SettingsQuery>("/settings"),
    enabled: activeSection !== "interface",
  });
  useEffect(() => {
    if (!query.data) return;
    const nextProfiles = query.data.ai.roleProfiles;
    const uniformDefault = uniformSelection(nextProfiles);
    const nextDefault = uniformDefault ?? "mixed";
    const nextOverrides: RoleOverrides = {};
    for (const profile of nextProfiles) {
      const value = selectionValue(profile);
      if (uniformDefault === null || value !== nextDefault) {
        nextOverrides[profile.role] = value;
      }
    }
    setRoleProfiles(nextProfiles);
    setDefaultAiSelection(nextDefault);
    setRoleOverrides(nextOverrides);
  }, [query.data]);

  const saveAi = useMutation({
    mutationFn: (profiles: RoleProfile[]) =>
      api<{ saved: true; roleProfiles: RoleProfile[] }>("/settings/ai", {
        method: "PUT",
        body: JSON.stringify({
          roleProfiles: profiles.map(
            ({ role, mode, connectionId, modelId }) => ({
              role,
              mode,
              connectionId,
              modelId,
            }),
          ),
        }),
      }),
    onSuccess: (result) => {
      setRoleProfiles(result.roleProfiles);
      queryClient.setQueriesData<SettingsQuery>(
        { queryKey: ["settings"] },
        (current) =>
          current
            ? {
                ...current,
                ai: { ...current.ai, roleProfiles: result.roleProfiles },
              }
            : current,
      );
      void queryClient.invalidateQueries({
        queryKey: ["settings"],
        refetchType: "active",
      });
    },
  });
  const navigateToSection = (value: string) => {
    if (!isSettingsSection(value) || value === activeSection) return;
    const next = new URLSearchParams(searchParamString);
    next.set("section", value);
    router.push(`${pathname}?${next.toString()}`, { scroll: false });
  };

  if (activeSection === "interface") {
    return (
      <SettingsLayout
        activeSection={activeSection}
        navigateToSection={navigateToSection}
      >
        {interfaceSettingsPane}
      </SettingsLayout>
    );
  }

  if (query.isLoading) {
    return (
      <SettingsLayout
        activeSection={activeSection}
        navigateToSection={navigateToSection}
      >
        <TabsContent value={activeSection}>
          <section className={sectionClass}>
            <LoadingState
              label="query.loadingSettings"
              variant="panel"
              className="min-h-48"
            />
          </section>
        </TabsContent>
      </SettingsLayout>
    );
  }
  if (query.isError || !query.data) {
    return (
      <SettingsLayout
        activeSection={activeSection}
        navigateToSection={navigateToSection}
      >
        <TabsContent value={activeSection}>
          <section className={sectionClass}>
            <QueryError
              message={t("query.settingsUnavailable")}
              retry={() => void query.refetch()}
            />
          </section>
        </TabsContent>
      </SettingsLayout>
    );
  }

  const defaultIsMixed = defaultAiSelection === "mixed";
  const connectionOptions: ModelOption[] = query.data.ai.connections.flatMap(
    (connection) =>
      (connection.observedCapabilities?.models ?? []).map((model) => {
        const reasonKey = modelDisabledReason(connection, model.available);
        const descriptionKey =
          reasonKey ??
          (connection.state === "degraded" ? "settings.status.degraded" : null);
        return {
          value: exactSelectionValue(connection.connectionId, model.modelId),
          label: `${connection.displayName} · ${model.modelId}`,
          disabled: reasonKey !== null,
          ...(descriptionKey ? { description: t(descriptionKey) } : {}),
        };
      }),
  );
  const modelOptions: ModelOption[] = [
    { value: "off", label: t("settings.aiOff") },
    ...connectionOptions,
  ];
  const defaultModelOptions: ModelOption[] = defaultIsMixed
    ? [
        {
          value: "mixed",
          label: t("settings.aiMixedConfiguration"),
          disabled: true,
        },
        ...modelOptions,
      ]
    : modelOptions;
  const editedRoleProfiles = roleProfiles.map((profile) =>
    withSelection(
      profile,
      roleOverrides[profile.role] ??
        (defaultIsMixed ? selectionValue(profile) : defaultAiSelection),
    ),
  );
  const defaultProfile =
    !defaultIsMixed && roleProfiles[0]
      ? withSelection(roleProfiles[0], defaultAiSelection)
      : undefined;
  const defaultConnection =
    defaultProfile?.mode === "connection"
      ? query.data.ai.connections.find(
          (connection) =>
            connection.connectionId === defaultProfile.connectionId,
        )
      : undefined;
  const defaultReadiness = defaultIsMixed
    ? undefined
    : aggregateReadiness(editedRoleProfiles, query.data.ai.connections);
  return (
    <SettingsLayout
      activeSection={activeSection}
      navigateToSection={navigateToSection}
    >
      {interfaceSettingsPane}

      <TabsContent value="ai">
        <section aria-labelledby="settings-ai-title" className={sectionClass}>
          <header className="mb-4 min-w-0">
            <h2 id="settings-ai-title" className={sectionHeadingClass}>
              {t("settings.section.ai")}
            </h2>
            <p className={sectionDescriptionClass}>
              {t("settings.section.aiDescription")}
            </p>
          </header>

          <div className={sectionSurfaceClass}>
            <FieldGroup className="gap-0">
              <Field
                orientation="responsive"
                className="gap-4 px-4 py-4 sm:px-5 @md/field-group:grid @md/field-group:grid-cols-[minmax(12rem,1fr)_minmax(16rem,28rem)] @md/field-group:items-start"
              >
                <FieldContent>
                  <FieldLabel htmlFor="default-ai-profile">
                    {t("settings.defaultModel")}
                  </FieldLabel>
                  <FieldDescription>
                    {t("settings.section.aiDescription")}
                  </FieldDescription>
                </FieldContent>
                <div className="flex w-full min-w-0 flex-col gap-2 sm:max-w-md">
                  <ModelCombobox
                    id="default-ai-profile"
                    value={defaultAiSelection}
                    selectedLabel={
                      defaultIsMixed
                        ? t("settings.aiMixedConfiguration")
                        : defaultProfile?.mode === "connection"
                          ? `${defaultConnection?.displayName ?? defaultProfile.connectionId} · ${defaultProfile.modelId}`
                          : t("settings.aiOff")
                    }
                    options={defaultModelOptions}
                    searchLabel={t("settings.model.search")}
                    noMatchesLabel={t("settings.model.noMatches")}
                    onValueChange={(value) => {
                      setDefaultAiSelection(value);
                      setRoleOverrides({});
                    }}
                  />
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge
                      data-assignment-readiness={
                        defaultIsMixed ? "mixed" : defaultReadiness?.state
                      }
                      variant={
                        defaultIsMixed
                          ? "warning"
                          : readinessBadgeVariant(
                              defaultReadiness?.state ?? "off",
                            )
                      }
                    >
                      {defaultIsMixed
                        ? t("settings.aiMixedConfiguration")
                        : t(
                            readinessStateKeys[
                              defaultReadiness?.state ?? "off"
                            ],
                          )}
                    </Badge>
                    {defaultProfile?.mode === "connection" &&
                    defaultProfile.modelId ? (
                      <code
                        title={`${defaultConnection?.displayName ?? defaultProfile.connectionId} · ${defaultProfile.modelId}`}
                        className="block min-w-0 max-w-full truncate text-xs text-muted-foreground"
                      >
                        {defaultConnection?.displayName ??
                          defaultProfile.connectionId}{" "}
                        · {defaultProfile.modelId}
                      </code>
                    ) : null}
                  </div>
                </div>
              </Field>
            </FieldGroup>

            <Collapsible>
              <div className="flex min-w-0 flex-col gap-3 border-t border-border/60 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {t("settings.roleOverrides")}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">
                    {t("settings.roleOverridesDescription")}
                  </p>
                </div>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="w-full shrink-0 sm:w-auto"
                  >
                    {t("settings.customizeRoles")}
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <FieldGroup className="gap-0 divide-y divide-border/60 border-t border-border/60">
                  {roleMeta.map((meta) => {
                    const profile = editedRoleProfiles.find(
                      (candidate) => candidate.role === meta.role,
                    );
                    if (!profile) return null;
                    const assignedConnection =
                      profile.mode === "connection"
                        ? query.data.ai.connections.find(
                            (connection) =>
                              connection.connectionId === profile.connectionId,
                          )
                        : undefined;
                    const readiness = assignmentReadiness(
                      profile,
                      query.data.ai.connections,
                    );
                    return (
                      <Field
                        key={meta.role}
                        orientation="responsive"
                        className="gap-4 px-4 py-4 sm:px-5 @md/field-group:grid @md/field-group:grid-cols-[minmax(12rem,1fr)_minmax(16rem,28rem)] @md/field-group:items-start"
                      >
                        <FieldContent>
                          <FieldLabel htmlFor={`role-${meta.role}`}>
                            {t(meta.label)}
                          </FieldLabel>
                          <FieldDescription>{t(meta.help)}</FieldDescription>
                        </FieldContent>
                        <div className="flex w-full min-w-0 flex-col gap-2 sm:max-w-md">
                          <ModelCombobox
                            id={`role-${meta.role}`}
                            value={selectionValue(profile)}
                            selectedLabel={
                              profile.mode === "connection"
                                ? `${assignedConnection?.displayName ?? profile.connectionId} · ${profile.modelId}`
                                : t("settings.aiOff")
                            }
                            options={modelOptions}
                            searchLabel={t("settings.model.search")}
                            noMatchesLabel={t("settings.model.noMatches")}
                            onValueChange={(value) =>
                              setRoleOverrides((current) => {
                                const next = { ...current };
                                if (value === defaultAiSelection) {
                                  delete next[meta.role];
                                } else {
                                  next[meta.role] = value;
                                }
                                return next;
                              })
                            }
                          />
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <Badge
                              data-assignment-readiness={readiness.state}
                              title={
                                readiness.state === "unsupported" &&
                                readiness.capability
                                  ? t(
                                      "authoring.connected.stateDescription.unsupported",
                                      { capability: readiness.capability },
                                    )
                                  : undefined
                              }
                              variant={readinessBadgeVariant(readiness.state)}
                            >
                              {t(readinessStateKeys[readiness.state])}
                            </Badge>
                            {profile.mode === "connection" &&
                            profile.modelId ? (
                              <code
                                title={`${assignedConnection?.displayName ?? profile.connectionId} · ${profile.modelId}`}
                                className="block min-w-0 max-w-full truncate text-xs text-muted-foreground"
                              >
                                {assignedConnection?.displayName ??
                                  profile.connectionId}{" "}
                                · {profile.modelId}
                              </code>
                            ) : null}
                          </div>
                        </div>
                      </Field>
                    );
                  })}
                </FieldGroup>
              </CollapsibleContent>
            </Collapsible>

            {saveAi.isError ? (
              <div className="border-t border-border/60 p-4 sm:px-5">
                <SafeQueryError
                  error={saveAi.error}
                  operation="settings.ai.save"
                  retry={() => saveAi.mutate(editedRoleProfiles)}
                />
              </div>
            ) : null}
            <div className="flex min-w-0 flex-col gap-3 border-t border-border/60 px-4 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-5">
              <span
                role="status"
                aria-live="polite"
                className="text-sm text-muted-foreground sm:mr-auto"
              >
                {saveAi.isSuccess
                  ? t("settings.aiSaved")
                  : t("settings.externalDisclosure")}
              </span>
              <Button
                className="w-full sm:w-auto"
                type="button"
                variant="secondary"
                disabled={saveAi.isPending}
                onClick={() => saveAi.mutate(editedRoleProfiles)}
              >
                {t(saveAi.isPending ? "settings.saving" : "settings.saveAi")}
              </Button>
            </div>
          </div>
        </section>
      </TabsContent>

      <TabsContent value="connections">
        <section
          aria-labelledby="settings-connections-title"
          className={sectionClass}
        >
          <ProviderConnectionManager
            connections={query.data.ai.connections}
            management={query.data.ai.management}
          />
        </section>
      </TabsContent>

      <TabsContent value="advanced">
        <section
          aria-labelledby="settings-local-title"
          className={sectionClass}
        >
          <Collapsible>
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 id="settings-local-title" className={sectionHeadingClass}>
                  {t("settings.section.local")}
                </h2>
                <p className={sectionDescriptionClass}>
                  {t("settings.section.localDescription")}
                </p>
              </div>
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full shrink-0 sm:w-auto"
                >
                  {t("courses.library.details")}
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <div className={sectionSurfaceClass}>
                <dl className="min-w-0 divide-y divide-border/60">
                  <div className="grid min-w-0 gap-1 px-5 py-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:items-baseline sm:gap-6 sm:px-6">
                    <dt className="text-sm font-medium">
                      {t("settings.workspace")}
                    </dt>
                    <dd className="min-w-0 font-mono text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere] sm:text-right">
                      {query.data.workspaceRoot}
                    </dd>
                  </div>
                  <div className="grid min-w-0 gap-1 px-5 py-4 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:items-baseline sm:gap-6 sm:px-6">
                    <dt className="text-sm font-medium">
                      {t("settings.editor")}
                    </dt>
                    <dd className="min-w-0 font-mono text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere] sm:text-right">
                      {query.data.zedExecutable}
                    </dd>
                  </div>
                </dl>
                <div className="flex min-w-0 justify-start border-t border-border/60 px-5 py-4 sm:justify-end sm:px-6">
                  <Button asChild variant="ghost" className="w-full sm:w-auto">
                    <Link href="/settings/developer-tools">
                      {t("settings.developerDiagnostics")}
                    </Link>
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </section>
      </TabsContent>
    </SettingsLayout>
  );
}
