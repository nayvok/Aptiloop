/** Форматирование учебного времени для learner UI. */

function plural(value: number, one: string, few: string, many: string): string {
  const abs = Math.abs(value) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

/** «18 мин», «2 ч 48 мин» — компактный формат для бейджей и планов. */
export function formatMinutesShort(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} мин`;
  if (rest === 0) return `${hours} ч`;
  return `${hours} ч ${rest} мин`;
}

/** «около 18 минут», «около 2 ч 48 мин» — для hero-текстов. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `около ${rest} ${plural(rest, "минуты", "минут", "минут")}`;
  }
  if (rest === 0) {
    return `около ${hours} ${plural(hours, "часа", "часов", "часов")}`;
  }
  return `около ${hours} ${plural(hours, "часа", "часов", "часов")} ${rest} мин`;
}

/** «примерно 2 часа» — для интервью и настроек. */
export function formatHoursHuman(minutes: number): string {
  const hours = Math.max(1, Math.round(minutes / 60));
  return `${hours} ${plural(hours, "час", "часа", "часов")}`;
}
