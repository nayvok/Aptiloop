import type { UiLocale } from "@/lib/i18n";

function formatUnit(
  value: number,
  unit: "hour" | "minute",
  locale: UiLocale,
  unitDisplay: "long" | "short",
): string {
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay,
  }).format(value);
}

export function formatMinutesShort(
  minutes: number,
  locale: UiLocale = "en-US",
): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return formatUnit(rest, "minute", locale, "short");
  if (rest === 0) return formatUnit(hours, "hour", locale, "short");
  return `${formatUnit(hours, "hour", locale, "short")} ${formatUnit(rest, "minute", locale, "short")}`;
}

export function formatDuration(
  minutes: number,
  locale: UiLocale = "en-US",
): string {
  return `≈ ${formatMinutesShort(minutes, locale)}`;
}
