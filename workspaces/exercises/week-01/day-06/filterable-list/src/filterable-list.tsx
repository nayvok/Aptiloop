import { useState } from "react";

export interface ListItem {
  readonly id: string;
  readonly label: string;
}

export type ItemLoader = (signal: AbortSignal) => Promise<readonly ListItem[]>;

export interface FilterableListProps {
  readonly initialItems: readonly ListItem[];
  readonly loadItems: ItemLoader;
}

export function filterItems(
  items: readonly ListItem[],
  _query: string,
): readonly ListItem[] {
  // TODO: вычислить результат без мутации и без дополнительного state.
  return items;
}

export function FilterableList({
  initialItems: _initialItems,
  loadItems: _loadItems,
}: FilterableListProps) {
  const [query, setQuery] = useState("");

  // TODO: оставить state только для server data, query и selectedId.
  // TODO: загрузить свежие данные в effect и отменить устаревшую синхронизацию.

  return (
    <section aria-label="Фильтруемый список">
      <label>
        Поиск
        <input
          aria-label="Поиск"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </label>
      <p>TODO: отобразите вычисленный список и selection.</p>
    </section>
  );
}
