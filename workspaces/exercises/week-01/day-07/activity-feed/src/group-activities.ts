import type { Activity } from "./activity";

export interface ActivityGroup {
  readonly date: string;
  readonly activities: readonly Activity[];
}

export function groupActivitiesByUtcDate(
  _activities: readonly Activity[],
): readonly ActivityGroup[] {
  // TODO: вернуть группы в порядке первого появления даты, сохранив порядок событий.
  return [];
}
