# Авторинг versioned curriculum

Active published revision 3 первой недели собирается как `activeCurriculumVersion` в `packages/curriculum/src/version-3.ts` поверх неизменяемых revision 1 и revision 2 и идемпотентно seed-ится в SQLite. Revision 2 сохраняет исходный Day 1 answer key, estimates и content hash; новые quiz/code-reading материалы и нормализованная длительность занятий опубликованы только в revision 3. Основной UI редактора доступен в `Настройки → Редактор программы` и работает с `/api/curriculum-editor/*`.

## Жизненный цикл revision

1. Создайте пустой draft или клонируйте existing revision.
2. Добавьте/reorder week, day и unit.
3. Отредактируйте обычные поля формами; сложный payload можно править как JSON.
4. Устраните validation errors всего graph.
5. Явно подтвердите публикацию.

Публикация атомарно вычисляет SHA-256 content hash, переводит прежнюю active published revision в `archived`, обновляет `curricula.active_version_id` и делает новую revision immutable. Published/archived graph read-only. Чтобы изменить курс, клонируйте его в следующий draft; существующие session snapshots не меняются.

## Структура

```text
Curriculum
  Version (revision, parentVersionId, status, contentHash)
    Week (stableId, order, title, description)
      Day (stableId, order, goal, outcomes, depth, topics)
        Unit (stableId, type, order, objectives, checklist, sources,
              completionCriteria, unlockRules, codeSnippet, payload)
```

Поддержанные unit types: `briefing`, `study`, `recall`, `teacher-dialogue`, `quiz`, `code-reading`, `exercise`, `review`, `interview`, `summary`, `checkpoint`, `spaced-review`. Поле `payload.type` обязано совпадать с `unit.type`; Zod проверяет type-specific payload.

Каждый published day должен иметь units и completion criteria; week без days и graph с duplicate stable IDs не публикуются. Patch/delete дополнительно проверяют принадлежность entity указанной draft revision и выполняются транзакционно.

## Правила контента

1. Stable ID описывает смысл сущности и не переиспользуется для другого содержания.
2. Новый несовместимый вариант публикуется новой revision, не mutation published row.
3. Goal/objective формулируют наблюдаемое действие: объяснить, предсказать, реализовать.
4. Checklist сообщает, что читать/делать и насколько глубоко; out-of-scope сокращает расплывчатость.
5. Source использует HTTPS и понятный title; предпочтительна первичная документация.
6. Recall/quiz/code-reading требуют собственного ответа до feedback.
7. `referenceAnswer`/quiz key предназначены серверной оценке и не должны попадать в learner DTO или generation prompt заранее.
8. Exercise payload ссылается на доверенный template и критерии, но browser не получает template filesystem path в versioned flow.
9. Review unit ссылается на exercise unit и не обещает автоматическое исправление.
10. Summary фиксирует evidence и честные gaps, не генерирует искусственный mastery.
11. Quiz содержит минимум два варианта на вопрос и ровно один непустой answer key; при результате ниже порога learner может пересдать quiz, а первая сохранённая попытка остаётся evidence.
12. Code-reading хранит показываемый код в отдельном `codeSnippet`; question prompt описывает задачу prediction/explanation/fix и не подменяет собой исходник.

## Exercise template

Template хранится под allowlisted `workspaces/exercises/...`, содержит starter code, package scripts и tests. Во время занятия сервер копирует его под `.data/exercise-attempts/<attempt-id>` и создаёт baseline уже там; template не редактируется.

Используйте npm-only package и проверяйте template отдельно:

```powershell
npm install
npm test
npm run typecheck
```

После изменения встроенной revision/seed/contracts:

```powershell
npm run test --workspace=@dlh/curriculum
npm run test --workspace=@dlh/database
npm run typecheck --workspace=@dlh/orchestrator
npm run db:backup
npm run db:migrate
npm run db:seed
```

Повторный seed не должен создавать дубли или менять published content задним числом. Перед работой с ценной локальной DB всегда делайте backup.
