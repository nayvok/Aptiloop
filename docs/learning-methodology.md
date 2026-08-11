# Учебная методика

> **Historical snapshot — non-authoritative.** This file records an earlier **Implemented baseline** and is preserved for context only. Do not use it as the current learning specification. See the [current documentation index](README.md).

## Принцип

Harness тренирует воспроизведение, а не узнавание. Сначала пользователь формулирует ответ или пишет код сам, затем получает минимальную помощь. Zed остаётся отдельным рабочим контекстом; приложение хранит attempts/evidence/diff/tests/reviews, но не применяет correction.

## Вертикальный срез Дня 1

Основной versioned flow:

1. **Briefing** — цель дня, ожидаемый результат, глубина и out-of-scope.
2. **Study** — конкретные пункты и источники; checklist отмечается явно.
3. **Recall** — на каждый вопрос отдельно сохраняется immutable first attempt до feedback; завершение требует evidence по всем вопросам.
4. **Teacher dialogue** — после первого объяснения Teacher задаёт уточнение, пользователь отвечает отдельным revision-turn и только затем завершает диалог.
5. **Quiz** — server проверяет option IDs; learner DTO не содержит answer key. Результат ниже порога не блокирует день навсегда: пользователь пересдаёт quiz, а первая попытка остаётся сохранённым evidence.
6. **Code reading** — prediction, explanation и verbal fix сохраняются до перехода.
7. **Exercise** — открывается только когда unit дошёл до `ready`/`in_progress`; server не создаёт раннюю попытку. Код изменяется в Zed в отдельной attempt folder.
8. **Test** — только allowlisted `test`, stdout/stderr/exit status сохраняются.
9. **Review** — read-only анализ learner diff после актуального passed test.
10. **Correction** — пользователь меняет код, снова запускает test и review.
11. **Summary** — deterministic evidence aggregation, mastery/mistakes/cards.
12. **Completion** — следующий день разблокируется; restart возвращает текущий unit.

Progression не доверяет произвольной команде browser: сервер проверяет unit state, completion criteria и evidence target. Published curriculum snapshot защищает начатое занятие от будущего редактирования программы. При публикации новой revision главная сопоставляет день и units по stable IDs, поэтому активная session продолжает старый immutable snapshot, не исчезая из нового маршрута.

## First attempt и protected content

First recall/quiz/code-reading attempt записывается отдельно и не перезаписывается последующими действиями. `referenceAnswer`, evaluation rubric и quiz correctness не возвращаются learner session заранее. Teacher/interview question generation не получает reference до собственного ответа пользователя.

У текущего v2 learner flow подсказки представлены в contract/progress и учитываются deterministic mastery, но UI Дня 1 прежде всего реализует самостоятельную попытку и Teacher clarification; он не является полной адаптивной six-level hint tutor системой для каждого unit.

## Mastery

`learning-core` вычисляет score по dimensions `understanding`, `explanation`, `codeReading`, `implementation`, `debugging`, `interview`. Outcome (`incorrect/partial/correct`), evidence type, hint level, повтор ошибки и дата влияют на deterministic delta. Score ограничен 0–5; значение выше 4 требует успешных evidence разных типов в разные UTC-дни.

LLM может сформировать ответ/review, но не назначает итоговый score напрямую. Summary строится из server-owned evidence: quiz score, recall/code reading attempts, test status, review status и correction count.

## Review и актуальность

Reviewer получает brief, constraints, criteria, diff, последний passed test и prior review count. Он возвращает structured result и не имеет write/apply tools. После `changes_requested` только новый learner edit + новый passed test делают следующий review допустимым.

После allowlisted test сервер сохраняет SHA-256 полного Git diff. Review допускается только если текущий diff имеет тот же fingerprint; сохранение старого `mtime`, rename или удаление файла инвалидируют test evidence. Truncated diff нельзя отправить на review.

## Ошибки и карточки

Day summary создаёт mistake candidates с fingerprint/symptom/correction и flashcard candidates, связанные с evidence. Повторный fingerprint увеличивает occurrence count вместо создания дубля. Карточка проходит local candidate → approved/rejected и экспортируется в Markdown/CSV/TSV. AnkiConnect и автоматический sync не входят в MVP.

## Interview

Interview — отдельный workflow, а не Agent Playground. Пользователь задаёт topics, difficulty и 1–12 вопросов; сервер сохраняет setup, задаёт вопросы по одному и восстанавливает transcript после reload.

Текущий финальный report честно измеряет только:

- число заданных/отвеченных вопросов;
- completion rate;
- длину и структурность ответов;
- evidence формата вроде developed/brief.

Он **не проверяет техническую корректность**, не сравнивает ответ с expert rubric/reference и не обновляет mastery. Поэтому report — материал для саморефлексии, а не сертификат знания.
