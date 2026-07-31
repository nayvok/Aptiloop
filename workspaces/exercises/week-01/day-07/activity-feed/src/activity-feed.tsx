import type { Activity } from "./activity";

export interface ActivityFeedProps {
  readonly activities: readonly Activity[];
}

export function ActivityFeed({ activities: _activities }: ActivityFeedProps) {
  // TODO: вычислить группы во время render и показать честный empty state.
  return <section aria-label="Лента активности">TODO: activity feed</section>;
}
