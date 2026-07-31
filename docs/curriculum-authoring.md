# Авторинг учебной программы

Источник первой недели находится в `packages/curriculum/src/index.ts`. Seed переносит curriculum в SQLite и должен оставаться идемпотентным.

## Структура

`CurriculumWeek` содержит stable ID, номер, название, summary, бюджет времени и дни. Каждый `CurriculumDay` содержит:

- stable `id`, `dayNumber`, `slug`, title/summary и `estimatedMinutes`;
- конкретные `goals`;
- `topics` с prompts и источниками;
- `questions` с kind, prompt, reference answer, evaluation points и common mistakes;
- `exercises` с workspace path, difficulty, brief, constraints, topics, criteria и reference approach;
- common mistakes дня с symptom и correction.

Допустимые question kinds: `explain`, `compare`, `predict-output`, `find-bug`, `design-choice`, `interview`. Difficulty: `easy`, `medium`, `hard`.

## Правила контента

1. ID не меняется после появления пользовательских данных. Для новой версии создавайте новый ID.
2. Цель описывает проверяемое действие: «объяснить», «предсказать», «реализовать», а не «изучить».
3. Вопрос должен позволять ответить до чтения reference. Evaluation points должны быть наблюдаемыми.
4. Reference answer хранится для оценки, но не передаётся в question-generation или interview context до ответа.
5. Упражнение решается во внешнем Zed и не предполагает генерацию готового патча агентом.
6. Criteria не дублируют test names и включают поведение на границах.
7. Источник содержит title, HTTPS URL и kind (`documentation`, `article`, `video`, `book`). Предпочитайте первичную документацию.
8. Common mistake описывает symptom и самостоятельную correction.

## Добавление упражнения

Создайте автономную папку под `workspaces/exercises/week-NN/day-NN/<slug>`, добавьте README, npm package scripts, strict tsconfig, starter source и tests. В curriculum укажите относительный `workspacePath` внутри allowlisted root. Не добавляйте отдельный pnpm workspace или `pnpm-workspace.yaml`.

Пример проверки из папки упражнения:

```powershell
npm install
npm test
npm run typecheck
```

После правки curriculum выполните:

```powershell
npm run test --workspace=@dlh/curriculum
npm run test --workspace=@dlh/database
npm run db:migrate
npm run db:seed
```

Проверьте повторный `db:seed`: количество сущностей не должно расти из-за дублей.
