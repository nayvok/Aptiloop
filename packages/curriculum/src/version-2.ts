import type {
  CurriculumDepthLevel,
  CurriculumUnitType,
  DraftRoadmapWeek,
  LegacyCurriculumVersionReference,
  UnitCompletionCriterion,
  VersionedCurriculumDay,
  VersionedCurriculumQuestion,
  VersionedCurriculumSource,
  VersionedCurriculumUnit,
  VersionedCurriculumVersion,
  VersionedExercisePayload,
} from "./versioned-types.js";

const doc = (
  stableId: string,
  title: string,
  url: string,
  estimatedMinutes: number,
  whatToFind: readonly string[],
  examplesToRepeat: readonly string[] = [],
): VersionedCurriculumSource => ({
  id: stableId,
  title,
  url,
  kind: "documentation",
  required: true,
  estimatedMinutes,
  learningGoal: whatToFind.join("; "),
  examplesToRepeat,
});

const question = (
  stableId: string,
  kind: VersionedCurriculumQuestion["kind"],
  prompt: string,
  referenceAnswer: string,
  evaluationPoints: readonly string[],
  misconceptions: readonly string[] = [],
  options?: VersionedCurriculumQuestion["options"],
): VersionedCurriculumQuestion => ({
  stableId,
  kind,
  prompt,
  ...(options === undefined ? {} : { options }),
  misconceptions,
  protectedEvaluation: { referenceAnswer, evaluationPoints },
});

const completion = (
  stableId: string,
  description: string,
  evidence: UnitCompletionCriterion["evidence"],
  minimum?: number,
): UnitCompletionCriterion => ({
  stableId,
  description,
  evidence,
  ...(minimum === undefined ? {} : { minimum }),
});

interface UnitInput {
  readonly stableId: string;
  readonly type: CurriculumUnitType;
  readonly order: number;
  readonly title: string;
  readonly description: string;
  readonly estimatedMinutes: number;
  readonly previousUnitStableId: string | null;
  readonly objectives: readonly string[];
  readonly checklist?: readonly string[];
  readonly sources?: readonly VersionedCurriculumSource[];
  readonly questions?: readonly VersionedCurriculumQuestion[];
  readonly misconceptions?: readonly string[];
  readonly criteria: readonly UnitCompletionCriterion[];
  readonly exercise?: VersionedExercisePayload;
  readonly depthLevel?: CurriculumDepthLevel;
  readonly required?: boolean;
}

const makeUnit = (input: UnitInput): VersionedCurriculumUnit => ({
  stableId: input.stableId,
  type: input.type,
  order: input.order,
  title: input.title,
  description: input.description,
  estimatedMinutes: input.estimatedMinutes,
  required: input.required ?? true,
  depthLevel: input.depthLevel ?? "interview-ready",
  objectives: input.objectives,
  checklist: input.checklist ?? [],
  sources: input.sources ?? [],
  questions: input.questions ?? [],
  misconceptions: input.misconceptions ?? [],
  completionCriteria: input.criteria,
  unlockRule:
    input.previousUnitStableId === null
      ? { kind: "day-start", requiredUnitStableIds: [] }
      : {
          kind: "all-completed",
          requiredUnitStableIds: [input.previousUnitStableId],
        },
  ...(input.exercise === undefined ? {} : { exercise: input.exercise }),
});

const mdnDataTypes = doc(
  "src-mdn-js-data-types",
  "MDN: JavaScript data types and data structures",
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Data_structures",
  18,
  [
    "семь primitive-типов",
    "различие primitive и object",
    "неизменяемость primitive",
  ],
  ["typeof для примитивов", "присваивание primitive и object"],
);

const mdnEquality = doc(
  "src-mdn-js-equality",
  "MDN: Equality comparisons and sameness",
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Equality_comparisons_and_sameness",
  16,
  ["семантика ==, === и Object.is", "NaN и signed zero"],
  ["Object.is(NaN, NaN)", "0 === -0"],
);

const mdnStructuredClone = doc(
  "src-mdn-structured-clone",
  "MDN: structuredClone()",
  "https://developer.mozilla.org/en-US/docs/Web/API/Window/structuredClone",
  10,
  ["поддерживаемые значения", "transferable objects", "ограничения clone"],
  ["копирование вложенного массива", "ошибка при клонировании функции"],
);

const day1RecallQuestions = [
  question(
    "w1d1-recall-q1",
    "explain",
    "За 60–90 секунд объясните разницу между значением, binding и объектом.",
    "Binding связывает имя со значением. Primitive является самим значением, а объектное значение даёт доступ к одному объекту; два binding могут хранить одно объектное значение. Переназначение меняет binding, мутация — состояние объекта.",
    [
      "различает binding и value",
      "различает мутацию и переназначение",
      "избегает фразы «объект передаётся по ссылке»",
    ],
    ["const делает объект неизменяемым", "переменная хранит объект целиком"],
  ),
  question(
    "w1d1-recall-q2",
    "compare",
    "Сравните null, undefined и отсутствующее свойство. Где нужен точный тест?",
    "undefined часто обозначает отсутствие присвоенного значения, null — намеренно заданное пустое значение, а отсутствующее свойство различается через own-property проверку. Точный тест нужен, когда эти состояния имеют разный доменный смысл.",
    [
      "называет разные доменные смыслы",
      "упоминает own-property",
      "не полагается только на truthiness",
    ],
    ["null и undefined всегда взаимозаменяемы"],
  ),
  question(
    "w1d1-recall-q3",
    "explain",
    "Почему spread не является deep copy и когда structuredClone тоже не подходит?",
    "Spread создаёт новый внешний объект, но сохраняет ссылки на вложенные объекты. structuredClone рекурсивно копирует поддерживаемые значения, но не клонирует функции и некоторые host-объекты; доменные экземпляры и намерение копирования требуют отдельного решения.",
    [
      "объясняет shallow copy",
      "называет ограничение structuredClone",
      "связывает выбор с контрактом",
    ],
    ["spread всегда полностью защищает от мутаций"],
  ),
] as const;

const day1QuizQuestions = [
  question(
    "w1d1-quiz-q1",
    "multiple-choice",
    "Что вернёт typeof null?",
    "string 'object' — историческая особенность языка.",
    ["выбран object"],
    [],
    [
      { stableId: "q1-a", label: "null" },
      { stableId: "q1-b", label: "object" },
      { stableId: "q1-c", label: "undefined" },
    ],
  ),
  question(
    "w1d1-quiz-q2",
    "multiple-choice",
    "Какой тест отличает NaN от самого себя по семантике sameness?",
    "Object.is(NaN, NaN) возвращает true.",
    ["выбран Object.is"],
    [],
    [
      { stableId: "q2-a", label: "NaN === NaN" },
      { stableId: "q2-b", label: "Object.is(NaN, NaN)" },
      { stableId: "q2-c", label: "NaN == NaN" },
    ],
  ),
  question(
    "w1d1-quiz-q3",
    "multiple-choice",
    "После const next = {...state}, что произойдёт при next.profile.name = 'A'?",
    "Если profile не скопирован отдельно, изменится общий вложенный объект, видимый и через state.profile.",
    ["распознана общая вложенная ссылка"],
    [],
    [
      { stableId: "q3-a", label: "Изменится только next" },
      { stableId: "q3-b", label: "Изменится общий profile" },
      { stableId: "q3-c", label: "Будет TypeError из-за const" },
    ],
  ),
  question(
    "w1d1-quiz-q4",
    "multiple-choice",
    "Как корректнее проверить, что значение отсутствует как null или undefined, но сохранить 0 и ''?",
    "Проверка value == null намеренно совпадает только с null и undefined; эквивалент — явные два сравнения.",
    ["не отбрасывает 0 и пустую строку"],
    [],
    [
      { stableId: "q4-a", label: "if (!value)" },
      { stableId: "q4-b", label: "value == null" },
      { stableId: "q4-c", label: "Boolean(value)" },
    ],
  ),
] as const;

const day1Units = [
  makeUnit({
    stableId: "w1d1-u01-briefing",
    type: "briefing",
    order: 1,
    title: "Брифинг: значения, типы и объекты",
    description:
      "Уточнить границы дня, критерии успеха и ожидаемую глубину ответа.",
    estimatedMinutes: 8,
    previousUnitStableId: null,
    objectives: ["Понять маршрут дня и сформулировать личный критерий успеха"],
    checklist: [
      "Прочитать outcomes",
      "Зафиксировать out of scope",
      "Подготовить Zed для практики",
    ],
    sources: [mdnDataTypes],
    criteria: [
      completion(
        "w1d1-u01-c1",
        "Цель, scope и следующий шаг подтверждены",
        "acknowledgement",
      ),
    ],
  }),
  makeUnit({
    stableId: "w1d1-u02-values-primitives",
    type: "study",
    order: 2,
    title: "Значения и примитивы",
    description:
      "Binding, value, семь primitive-типов и неизменяемость primitive.",
    estimatedMinutes: 18,
    previousUnitStableId: "w1d1-u01-briefing",
    objectives: [
      "Отличать имя, значение и объект",
      "Перечислить primitive-типы без подсказки",
    ],
    checklist: [
      "Выписать семь primitive-типов",
      "Повторить пример копирования primitive",
      "Объяснить неизменяемость строки",
    ],
    sources: [mdnDataTypes],
    misconceptions: [
      "Переменная является коробкой с объектом",
      "Primitive можно мутировать",
    ],
    criteria: [
      completion(
        "w1d1-u02-c1",
        "Все пункты study checklist отмечены",
        "checklist",
        3,
      ),
    ],
  }),
  makeUnit({
    stableId: "w1d1-u03-null-undefined-truthiness",
    type: "study",
    order: 3,
    title: "null, undefined, typeof, truthy и falsy",
    description: "Разделить отсутствие, намеренную пустоту и boolean coercion.",
    estimatedMinutes: 20,
    previousUnitStableId: "w1d1-u02-values-primitives",
    objectives: [
      "Выбирать точную проверку отсутствия",
      "Предсказывать typeof и boolean coercion",
    ],
    checklist: [
      "Сравнить null и undefined",
      "Запомнить falsy-набор",
      "Проверить typeof null",
      "Сохранить 0 и пустую строку в доменной проверке",
    ],
    sources: [mdnDataTypes],
    misconceptions: ["Falsy означает отсутствующий", "typeof null равен null"],
    criteria: [
      completion(
        "w1d1-u03-c1",
        "Все четыре проверки воспроизведены",
        "checklist",
        4,
      ),
    ],
  }),
  makeUnit({
    stableId: "w1d1-u04-objects-references-mutations",
    type: "study",
    order: 4,
    title: "Объекты, ссылки и мутации",
    description:
      "Общие объектные значения, property access, mutation и reassignment.",
    estimatedMinutes: 22,
    previousUnitStableId: "w1d1-u03-null-undefined-truthiness",
    objectives: [
      "Предсказывать эффект общей ссылки",
      "Обновлять объект без мутации входа",
    ],
    checklist: [
      "Нарисовать два binding к объекту",
      "Разделить mutation и reassignment",
      "Проверить поведение const object",
    ],
    sources: [mdnDataTypes],
    misconceptions: [
      "Объекты передаются по ссылке",
      "const запрещает изменение свойств",
    ],
    criteria: [
      completion(
        "w1d1-u04-c1",
        "Три пункта checklist подтверждены",
        "checklist",
        3,
      ),
    ],
  }),
  makeUnit({
    stableId: "w1d1-u05-equality-copy",
    type: "study",
    order: 5,
    title: "Equality, shallow copy и deep copy",
    description:
      "==, ===, Object.is, spread и structuredClone без магических правил.",
    estimatedMinutes: 24,
    previousUnitStableId: "w1d1-u04-objects-references-mutations",
    objectives: [
      "Выбирать сравнение по контракту",
      "Различать shallow и deep copy",
    ],
    checklist: [
      "Сравнить ==, === и Object.is",
      "Повторить nested spread",
      "Проверить structuredClone",
      "Назвать неподдерживаемые случаи",
    ],
    sources: [mdnEquality, mdnStructuredClone],
    misconceptions: [
      "== всегда запрещён без исключений",
      "spread делает deep copy",
      "structuredClone подходит любому значению",
    ],
    criteria: [
      completion(
        "w1d1-u05-c1",
        "Все четыре пункта checklist отмечены",
        "checklist",
        4,
      ),
    ],
  }),
  makeUnit({
    stableId: "w1d1-u06-recall",
    type: "recall",
    order: 6,
    title: "Воспроизведение по памяти без подсказок",
    description:
      "Сначала сохрани собственное объяснение; эталон и подсказки закрыты до первой попытки.",
    estimatedMinutes: 18,
    previousUnitStableId: "w1d1-u05-equality-copy",
    objectives: ["Воспроизвести причинную модель по памяти"],
    questions: day1RecallQuestions,
    misconceptions: [
      "Подменять механизм набором терминов",
      "Открывать источник во время первой попытки",
    ],
    criteria: [
      completion(
        "w1d1-u06-c1",
        "Сохранены ответы минимум на три вопроса воспроизведения до хода преподавателя",
        "written-attempt",
        3,
      ),
    ],
  }),
  makeUnit({
    stableId: "w1d1-u07-teacher-dialogue",
    type: "teacher-dialogue",
    order: 7,
    title: "Разбор с преподавателем",
    description:
      "Преподаватель задаёт один уточняющий вопрос за ход; пользователь делает минимум одну правку.",
    estimatedMinutes: 15,
    previousUnitStableId: "w1d1-u06-recall",
    objectives: ["Уточнить слабое место собственного объяснения"],
    checklist: [
      "Ответить на одно уточнение",
      "Переписать исходное объяснение точнее",
    ],
    misconceptions: ["Просить преподавателя сразу дать эталон"],
    criteria: [
      completion(
        "w1d1-u07-c1",
        "Сохранена минимум одна самостоятельная правка после уточнения",
        "dialogue-revision",
        1,
      ),
    ],
  }),
  makeUnit({
    stableId: "w1d1-u08-quiz",
    type: "quiz",
    order: 8,
    title: "Короткая проверка",
    description: "Четыре независимые проверки различий и edge cases.",
    estimatedMinutes: 12,
    previousUnitStableId: "w1d1-u07-teacher-dialogue",
    objectives: ["Подтвердить точность на коротких сценариях"],
    questions: day1QuizQuestions,
    criteria: [
      completion(
        "w1d1-u08-c1",
        "Даны четыре ответа и достигнут score не ниже 75%",
        "quiz-score",
        75,
      ),
    ],
  }),
  makeUnit({
    stableId: "w1d1-u09-code-reading",
    type: "code-reading",
    order: 9,
    title: "Чтение кода: общая вложенная ссылка",
    description:
      "До запуска предсказать результат, объяснить механизм и предложить verbal fix.",
    estimatedMinutes: 15,
    previousUnitStableId: "w1d1-u08-quiz",
    objectives: ["Увидеть скрытую мутацию во вложенном объекте"],
    questions: [
      question(
        "w1d1-code-q1",
        "predict-output",
        "Прочитайте: const original={profile:{name:'Ada'},tags:['js','js']}; const next={...original}; next.profile.name='Grace'; Что увидит original, почему, и как исправить обновление без мутации?",
        "original.profile.name станет Grace, потому что spread скопировал только внешний объект. Нужно создать новый profile: {...original, profile:{...original.profile,name:'Grace'}}; dedupe tags выполнять в новом массиве.",
        [
          "верное предсказание",
          "объяснена shallow copy",
          "дан immutable verbal fix",
        ],
        ["const предотвращает изменение", "spread копирует вложенные объекты"],
      ),
    ],
    criteria: [
      completion(
        "w1d1-u09-c1",
        "Сохранены prediction, explanation и verbal fix",
        "code-reading-attempt",
        3,
      ),
    ],
  }),
  makeUnit({
    stableId: "w1d1-u10-exercise",
    type: "exercise",
    order: 10,
    title: "Иммутабельное обновление unknown-профиля",
    description:
      "Самостоятельно реализовать normalizer и immutable update во внешнем Zed.",
    estimatedMinutes: 45,
    previousUnitStableId: "w1d1-u09-code-reading",
    objectives: [
      "Сузить unknown",
      "Не мутировать nested input",
      "Удалить дубликаты и сравнить значения явно",
    ],
    checklist: [
      "Создать attempt workspace",
      "Открыть папку в Zed",
      "Сделать собственную реализацию",
      "Запустить allowlisted tests",
    ],
    misconceptions: [
      "Проверять профиль только truthiness",
      "Использовать JSON stringify/parse как универсальный clone",
    ],
    criteria: [
      completion(
        "w1d1-u10-c1",
        "Есть non-empty diff и выполнен required test command",
        "exercise-attempt",
        1,
      ),
    ],
    exercise: {
      exerciseStableId: "exercise-w1d1-normalize-profile-v2",
      workspacePath: "workspaces/exercises/week-01/day-01/normalize-profile",
      testCommandId: "test:w1d1-normalize-profile",
      brief:
        "Проверить unknown-профиль, создать новый внешний и вложенный объекты, сохранить 0/пустую строку по контракту, удалить дубликаты tags и сравнивать значения осознанно.",
      acceptanceCriteria: [
        "unknown input отвергается предсказуемо",
        "исходный объект и вложения не мутируются",
        "tags дедуплицированы с сохранением порядка",
        "nullish, 0 и пустая строка различаются",
        "есть тесты equality edge cases",
      ],
      constraints: [
        "Без any",
        "Без JSON stringify/parse",
        "Не просить Reviewer изменить файлы",
      ],
      hintPolicy: "progressive-0-to-5",
      reviewPolicy: "diff-and-tests-read-only",
    },
  }),
  makeUnit({
    stableId: "w1d1-u11-review",
    type: "review",
    order: 11,
    title: "Проверка решения",
    description:
      "Проверка решения видит brief, критерии приёмки, настоящий diff и последний test run, но не имеет write/apply tools.",
    estimatedMinutes: 15,
    previousUnitStableId: "w1d1-u10-exercise",
    objectives: [
      "Самостоятельно применить замечания Reviewer и подтвердить исправление",
    ],
    checklist: [
      "Проверить diff",
      "Получить проверку решения",
      "При changes requested исправить в Zed и перезапустить tests",
    ],
    criteria: [
      completion(
        "w1d1-u11-c1",
        "Последняя проверка принята и обязательные тесты проходят",
        "accepted-review",
        1,
      ),
    ],
  }),
  makeUnit({
    stableId: "w1d1-u12-summary",
    type: "summary",
    order: 12,
    title: "Итоги дня и следующий шаг",
    description:
      "Зафиксировать подтверждения навыка, ошибочные представления, кандидатов карточек и следующий доступный шаг.",
    estimatedMinutes: 8,
    previousUnitStableId: "w1d1-u11-review",
    objectives: ["Назвать один сильный навык, один пробел и план повторения"],
    checklist: [
      "Просмотреть изменения мастерства",
      "Подтвердить ошибки",
      "Проверить кандидаты карточек",
    ],
    criteria: [
      completion(
        "w1d1-u12-c1",
        "Итоги дня сохранены одним commit",
        "summary-commit",
        1,
      ),
    ],
  }),
] as const satisfies readonly VersionedCurriculumUnit[];

const day1 = {
  stableId: "w1d1-values-types-objects",
  dayNumber: 1,
  order: 1,
  slug: "values-types-objects",
  title: "Значения, типы и объекты",
  description:
    "Восстановить точную ментальную модель значений, объектов, сравнений и копирования.",
  goal: "Без AI объяснить модель значений и реализовать безопасное immutable-преобразование unknown-профиля.",
  estimatedMinutes: 195,
  prerequisites: [],
  expectedOutcomes: [
    "Объяснить value/binding/object на уровне для собеседования",
    "Предсказать equality и mutation edge cases",
    "Обновить вложенный объект без мутации",
    "Обосновать shallow/deep copy",
  ],
  depthLevel: "interview-ready",
  outOfScope: ["hidden classes", "детали heap", "garbage collector internals"],
  topics: [
    "primitive values",
    "nullish values",
    "truthiness",
    "objects and references",
    "equality",
    "mutation",
    "shallow/deep copy",
  ],
  misconceptions: [
    "const делает объект immutable",
    "объекты передаются по ссылке",
    "truthy равно valid",
    "spread делает deep copy",
  ],
  completionCriteria: [
    "Все 12 обязательных шагов завершены с подтверждениями навыка",
    "Оценка короткой проверки не ниже 75%",
    "Тесты проходят и проверка решения принята",
  ],
  units: day1Units,
} as const satisfies VersionedCurriculumDay;

interface StudyPlan {
  readonly slug: string;
  readonly title: string;
  readonly topics: readonly string[];
  readonly source: VersionedCurriculumSource;
}

interface QuestionSeed {
  readonly prompt: string;
  readonly reference: string;
  readonly points: readonly string[];
}

interface StandardDayInput {
  readonly dayNumber: number;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly goal: string;
  readonly prerequisites: readonly string[];
  readonly outcomes: readonly string[];
  readonly outOfScope: readonly string[];
  readonly topics: readonly string[];
  readonly misconceptions: readonly string[];
  readonly studies: readonly StudyPlan[];
  readonly recall: readonly [QuestionSeed, QuestionSeed, QuestionSeed];
  readonly quiz: readonly [
    QuestionSeed,
    QuestionSeed,
    QuestionSeed,
    QuestionSeed,
  ];
  readonly codeReading: QuestionSeed;
  readonly exerciseTitle: string;
  readonly exerciseSlug: string;
  readonly exerciseWorkspacePath: string;
  readonly exerciseBrief: string;
  readonly practice: readonly string[];
  readonly includeInterview?: boolean;
}

const seededQuestion = (
  stableId: string,
  kind: VersionedCurriculumQuestion["kind"],
  seed: QuestionSeed,
  misconceptions: readonly string[],
): VersionedCurriculumQuestion =>
  question(
    stableId,
    kind,
    seed.prompt,
    seed.reference,
    seed.points,
    misconceptions,
  );

const createStandardDay = (input: StandardDayInput): VersionedCurriculumDay => {
  const prefix = `w1d${input.dayNumber}`;
  const units: VersionedCurriculumUnit[] = [];
  let order = 1;
  let previous: string | null = null;

  const add = (
    slug: string,
    unitInput: Omit<UnitInput, "stableId" | "order" | "previousUnitStableId">,
  ): string => {
    const stableId = `${prefix}-u${String(order).padStart(2, "0")}-${slug}`;
    units.push(
      makeUnit({
        ...unitInput,
        stableId,
        order,
        previousUnitStableId: previous,
      }),
    );
    previous = stableId;
    order += 1;
    return stableId;
  };

  add("briefing", {
    type: "briefing",
    title: `Briefing: ${input.title}`,
    description: `${input.goal} Глубина: для собеседования.`,
    estimatedMinutes: 8,
    objectives: [input.goal],
    checklist: [
      "Прочитать outcomes",
      "Проверить prerequisites",
      "Зафиксировать out of scope",
    ],
    criteria: [
      completion(
        `${prefix}-briefing-c1`,
        "Scope и критерий успеха подтверждены",
        "acknowledgement",
      ),
    ],
  });

  for (const study of input.studies) {
    add(study.slug, {
      type: "study",
      title: study.title,
      description: study.topics.join("; "),
      estimatedMinutes: 18,
      objectives: [`Объяснить и применить: ${study.topics.join(", ")}`],
      checklist: study.topics.map((topic) => `Проверить по примеру: ${topic}`),
      sources: [study.source],
      misconceptions: input.misconceptions,
      criteria: [
        completion(
          `${prefix}-${study.slug}-c1`,
          "Study checklist заполнен",
          "checklist",
          study.topics.length,
        ),
      ],
    });
  }

  add("recall", {
    type: "recall",
    title: "Воспроизведение по памяти без источников",
    description:
      "Сохрани первую самостоятельную попытку до разбора с преподавателем и любых справочных материалов.",
    estimatedMinutes: 18,
    objectives: ["Воспроизвести ключевые механизмы по памяти"],
    questions: input.recall.map((seed, index) =>
      seededQuestion(
        `${prefix}-recall-q${index + 1}`,
        "explain",
        seed,
        input.misconceptions,
      ),
    ),
    misconceptions: input.misconceptions,
    criteria: [
      completion(
        `${prefix}-recall-c1`,
        "Сохранены три первых самостоятельных ответа",
        "written-attempt",
        3,
      ),
    ],
  });

  add("teacher-dialogue", {
    type: "teacher-dialogue",
    title: "Разбор с преподавателем",
    description:
      "Одно уточнение за ход и минимум одна правка собственного ответа.",
    estimatedMinutes: 15,
    objectives: ["Устранить один конкретный пробел в объяснении"],
    checklist: ["Ответить на уточнение", "Сохранить правку"],
    criteria: [
      completion(
        `${prefix}-dialogue-c1`,
        "Сохранена правка после уточнения преподавателя",
        "dialogue-revision",
        1,
      ),
    ],
  });

  add("quiz", {
    type: "quiz",
    title: "Проверка: точность и границы",
    description: "Четыре коротких вопроса; каждая попытка и score сохраняются.",
    estimatedMinutes: 12,
    objectives: ["Проверить точность без развёрнутой подсказки"],
    questions: input.quiz.map((seed, index) =>
      seededQuestion(
        `${prefix}-quiz-q${index + 1}`,
        "compare",
        seed,
        input.misconceptions,
      ),
    ),
    criteria: [
      completion(
        `${prefix}-quiz-c1`,
        "Отвечены четыре вопроса, score не ниже 75%",
        "quiz-score",
        75,
      ),
    ],
  });

  add("code-reading", {
    type: "code-reading",
    title: "Чтение кода",
    description:
      "До запуска сохранить prediction, causal explanation и verbal fix.",
    estimatedMinutes: 15,
    objectives: ["Объяснить поведение незнакомого фрагмента кода"],
    questions: [
      seededQuestion(
        `${prefix}-code-q1`,
        "predict-output",
        input.codeReading,
        input.misconceptions,
      ),
    ],
    criteria: [
      completion(
        `${prefix}-code-c1`,
        "Сохранены prediction, explanation и fix",
        "code-reading-attempt",
        3,
      ),
    ],
  });

  add("exercise", {
    type: "exercise",
    title: input.exerciseTitle,
    description: input.exerciseBrief,
    estimatedMinutes: 50,
    objectives: input.practice,
    checklist: [
      "Создать attempt",
      "Реализовать в Zed без генерации решения",
      "Проверить diff",
      "Запустить tests",
    ],
    misconceptions: input.misconceptions,
    criteria: [
      completion(
        `${prefix}-exercise-c1`,
        "Есть собственный diff и test run",
        "exercise-attempt",
        1,
      ),
    ],
    exercise: {
      exerciseStableId: `exercise-${prefix}-${input.exerciseSlug}-v2`,
      workspacePath: input.exerciseWorkspacePath,
      testCommandId: `test:${prefix}-${input.exerciseSlug}`,
      brief: input.exerciseBrief,
      acceptanceCriteria: input.practice,
      constraints: [
        "Писать код самостоятельно в Zed",
        "Не использовать any без явного обоснования",
        "Не мутировать вход без требования контракта",
      ],
      hintPolicy: "progressive-0-to-5",
      reviewPolicy: "diff-and-tests-read-only",
    },
  });

  add("review", {
    type: "review",
    title: "Проверка решения и цикл исправлений",
    description:
      "Проверка решения основана на настоящих diff/tests; исправления пользователь вносит сам.",
    estimatedMinutes: 15,
    objectives: ["Исправить замечания и подтвердить новым diff/test run"],
    checklist: [
      "Получить проверку решения",
      "Исправить changes requested",
      "Повторить tests",
    ],
    criteria: [
      completion(
        `${prefix}-review-c1`,
        "Последняя проверка принята и тесты проходят",
        "accepted-review",
        1,
      ),
    ],
  });

  if (input.includeInterview === true) {
    add("checkpoint", {
      type: "checkpoint",
      title: "Интеграционная контрольная точка",
      description:
        "Проверить, что воспроизведение, короткая проверка, чтение кода и приложение завершены до интервью.",
      estimatedMinutes: 5,
      objectives: ["Подтвердить готовность к итоговому интервью"],
      checklist: ["Проверить подтверждения навыка предыдущих шагов"],
      criteria: [
        completion(
          `${prefix}-checkpoint-c1`,
          "Контрольная точка подтверждена",
          "acknowledgement",
        ),
      ],
    });
    add("interview", {
      type: "interview",
      title: "Техническое интервью недели",
      description:
        "Отдельный последовательный процесс: один вопрос за раз, эталон скрыт.",
      estimatedMinutes: 25,
      objectives: ["Связно объяснить смешанные темы недели"],
      checklist: [
        "Ответить минимум на три вопроса",
        "Завершить подтверждённый отчёт",
      ],
      criteria: [
        completion(
          `${prefix}-interview-c1`,
          "Отчёт интервью сохранён",
          "written-attempt",
          3,
        ),
      ],
    });
  }

  add("summary", {
    type: "summary",
    title: input.includeInterview === true ? "Итоги недели" : "Итоги дня",
    description:
      "Сохранить подтверждения навыка, ошибки, кандидатов карточек и следующий шаг.",
    estimatedMinutes: 10,
    objectives: ["Зафиксировать результат и план повторения"],
    checklist:
      input.includeInterview === true
        ? [
            "Проверить обновление мастерства",
            "Подтвердить mistake journal",
            "Проверить flashcards",
            "Зафиксировать план следующей недели",
          ]
        : [
            "Проверить изменения мастерства",
            "Подтвердить ошибки",
            "Проверить flashcards",
          ],
    criteria: [
      completion(
        `${prefix}-summary-c1`,
        "Итоги дня сохранены",
        "summary-commit",
        1,
      ),
    ],
  });

  return {
    stableId: `${prefix}-${input.slug}`,
    dayNumber: input.dayNumber,
    order: input.dayNumber,
    slug: input.slug,
    title: input.title,
    description: input.description,
    goal: input.goal,
    estimatedMinutes: units.reduce(
      (total, unit) => total + unit.estimatedMinutes,
      0,
    ),
    prerequisites: input.prerequisites,
    expectedOutcomes: input.outcomes,
    depthLevel: "interview-ready",
    outOfScope: input.outOfScope,
    topics: input.topics,
    misconceptions: input.misconceptions,
    completionCriteria: [
      "Все required units завершены",
      "Оценка короткой проверки не ниже 75%",
      "Практика имеет проходящие тесты и принятую проверку решения",
    ],
    units,
  };
};

const mdnClosures = doc(
  "src-mdn-closures",
  "MDN: Closures",
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Closures",
  20,
  ["lexical environment", "factory function", "замкнутое состояние"],
  ["createCounter", "цикл и callback"],
);
const mdnFunctions = doc(
  "src-mdn-functions",
  "MDN: Functions",
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Functions",
  20,
  [
    "declaration/expression/arrow",
    "higher-order function",
    "arguments and return",
  ],
  ["callback", "function expression"],
);
const mdnThis = doc(
  "src-mdn-this",
  "MDN: this",
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/this",
  15,
  ["call-site binding", "arrow lexical this", "bind/call/apply"],
  ["detached method", "bind"],
);
const mdnEventLoop = doc(
  "src-mdn-event-loop",
  "MDN: JavaScript execution model",
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Execution_model",
  22,
  ["stack", "job queue", "run-to-completion"],
  ["Promise.then and setTimeout order"],
);
const mdnPromise = doc(
  "src-mdn-promise",
  "MDN: Using promises",
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Using_promises",
  22,
  ["states", "chaining", "error propagation", "composition"],
  ["Promise.all", "Promise.allSettled"],
);
const mdnAbort = doc(
  "src-mdn-abort",
  "MDN: AbortController",
  "https://developer.mozilla.org/en-US/docs/Web/API/AbortController",
  12,
  ["signal", "abort", "AbortError"],
  ["cancel fetch"],
);
const tsEveryday = doc(
  "src-ts-everyday-types",
  "TypeScript Handbook: Everyday Types",
  "https://www.typescriptlang.org/docs/handbook/2/everyday-types.html",
  25,
  ["primitives", "arrays", "object types", "unions", "narrowing"],
  ["unknown input union"],
);
const tsGenerics = doc(
  "src-ts-generics",
  "TypeScript Handbook: Generics",
  "https://www.typescriptlang.org/docs/handbook/2/generics.html",
  22,
  ["type parameters", "constraints", "inference"],
  ["generic groupBy"],
);
const tsNarrowing = doc(
  "src-ts-narrowing",
  "TypeScript Handbook: Narrowing",
  "https://www.typescriptlang.org/docs/handbook/2/narrowing.html",
  24,
  ["type guards", "discriminated unions", "never exhaustiveness"],
  ["exhaustive reducer"],
);
const reactState = doc(
  "src-react-state",
  "React: State as a Snapshot",
  "https://react.dev/learn/state-as-a-snapshot",
  18,
  ["render snapshot", "event handlers", "batching"],
  ["functional update"],
);
const reactRender = doc(
  "src-react-render",
  "React: Render and Commit",
  "https://react.dev/learn/render-and-commit",
  18,
  ["render triggers", "reconciliation/commit", "parent rerender"],
  ["list with keys"],
);
const reactInputs = doc(
  "src-react-inputs",
  "React: Sharing State Between Components",
  "https://react.dev/learn/sharing-state-between-components",
  18,
  ["controlled input", "lifting state", "derived values"],
  ["controlled form"],
);
const reactEffects = doc(
  "src-react-effects",
  "React: Synchronizing with Effects",
  "https://react.dev/learn/synchronizing-with-effects",
  22,
  ["external synchronization", "dependencies", "cleanup", "Strict Mode"],
  ["timer cleanup"],
);
const reactRefs = doc(
  "src-react-refs",
  "React: Referencing Values with Refs",
  "https://react.dev/learn/referencing-values-with-refs",
  16,
  ["DOM refs", "mutable refs", "when refs are inappropriate"],
  ["auto focus"],
);
const tanstackQueries = doc(
  "src-tanstack-queries",
  "TanStack Query: Queries",
  "https://tanstack.com/query/latest/docs/framework/react/guides/queries",
  20,
  ["queryKey", "queryFn", "pending/error/data", "invalidation"],
  ["query and mutation"],
);

const day2 = createStandardDay({
  dayNumber: 2,
  slug: "scope-functions-closures",
  title: "Scope, функции и замыкания",
  description:
    "Связать lexical scope, формы функций, closures и базовые правила this.",
  goal: "Объяснить поиск binding и самостоятельно написать функции высшего порядка без скрытых ошибок состояния.",
  prerequisites: ["w1d1-values-types-objects"],
  outcomes: [
    "Сравнить var/let/const, block/function/lexical scope, hoisting и TDZ",
    "Различить declaration/expression/arrow и callback/HOF",
    "Объяснить closure и stale closure",
    "Объяснить базовые this/bind/call/apply",
  ],
  outOfScope: [
    "спецификация Environment Records",
    "детали JIT",
    "сложное metaprogramming this",
  ],
  topics: [
    "var",
    "let",
    "const",
    "block/function/lexical scope",
    "hoisting",
    "TDZ",
    "function forms",
    "callbacks",
    "higher-order functions",
    "closures",
    "this",
    "bind/call/apply",
    "stale closure",
  ],
  misconceptions: [
    "let не hoistится",
    "closure копирует значение",
    "this указывает на место объявления",
  ],
  studies: [
    {
      slug: "scope-bindings",
      title: "Bindings, scope, hoisting и TDZ",
      topics: [
        "var/let/const",
        "block и function scope",
        "lexical lookup",
        "hoisting и TDZ",
      ],
      source: mdnFunctions,
    },
    {
      slug: "function-forms",
      title: "Формы функций и композиция",
      topics: [
        "declaration/expression/arrow",
        "callback",
        "higher-order function",
      ],
      source: mdnFunctions,
    },
    {
      slug: "closures-this",
      title: "Closures, stale closure и this",
      topics: [
        "closure environment",
        "stale closure как мост к React",
        "this",
        "bind/call/apply",
      ],
      source: mdnClosures,
    },
    {
      slug: "this-call-site",
      title: "Call-site this",
      topics: ["method call", "detached method", "lexical this стрелки"],
      source: mdnThis,
    },
  ],
  recall: [
    {
      prompt:
        "Почему let hoistится, но чтение до декларации бросает ReferenceError?",
      reference:
        "Binding создаётся при входе в scope, но остаётся неинициализированным в TDZ до декларации.",
      points: ["hoisting", "неинициализированный binding", "ReferenceError"],
    },
    {
      prompt: "Что именно сохраняет closure и почему это не snapshot значения?",
      reference:
        "Closure сохраняет доступ к lexical environment и bindings, поэтому видит их актуальные значения.",
      points: ["lexical environment", "binding не snapshot", "время жизни"],
    },
    {
      prompt: "Как определяется this у обычной и стрелочной функции?",
      reference:
        "У обычной функции this задаёт call site; стрелка читает lexical this внешнего контекста.",
      points: ["call site", "lexical this", "detached method"],
    },
  ],
  quiz: [
    {
      prompt: "Какой scope у var внутри if?",
      reference: "var имеет function/global scope, не block scope.",
      points: ["function scope"],
    },
    {
      prompt:
        "Чем function declaration отличается от expression по доступности до строки?",
      reference:
        "Declaration инициализируется функцией при instantiation; expression следует правилам своего binding.",
      points: ["инициализация", "binding"],
    },
    {
      prompt: "Является ли каждый callback closure?",
      reference:
        "Функция технически имеет lexical environment, но термин closure полезен, когда важен доступ к внешним bindings.",
      points: ["callback — роль", "closure — lexical behavior"],
    },
    {
      prompt: "Что делает bind в отличие от call?",
      reference:
        "bind создаёт новую функцию с закреплённым this/частью аргументов, call вызывает сразу.",
      points: ["новая функция", "немедленный вызов"],
    },
  ],
  codeReading: {
    prompt:
      "Предскажите результаты счётчика, созданного closure, и detached method; объясните stale value и предложите fix.",
    reference:
      "Closure читает общий binding; detached обычный method теряет receiver. Fix зависит от контракта: явная функция/receiver или bind, а stale callback обновляется через актуальный binding/functional update.",
    points: ["prediction", "closure", "call-site this", "fix"],
  },
  exerciseTitle: "Function toolkit",
  exerciseSlug: "function-wrappers",
  exerciseWorkspacePath:
    "workspaces/exercises/week-01/day-03/function-wrappers",
  exerciseBrief:
    "Реализовать createCounter, once, groupBy, uniqueBy и calculateTotal, сохранив типы, this и ясные edge cases.",
  practice: [
    "createCounter хранит независимое состояние",
    "once вызывает исходную функцию один раз",
    "groupBy/uniqueBy сохраняют порядок",
    "calculateTotal не скрывает falsy-значения",
  ],
});

const day3 = createStandardDay({
  dayNumber: 3,
  slug: "async-event-loop",
  title: "Асинхронность и event loop",
  description:
    "Предсказывать порядок задач и строить отменяемые конкурентные операции.",
  goal: "Объяснить event loop причинно и реализовать безопасный async workflow с ошибками и отменой.",
  prerequisites: ["w1d2-scope-functions-closures"],
  outcomes: [
    "Нарисовать stack/runtime APIs/task queues",
    "Различить Promise states, microtasks и macrotasks",
    "Выбрать sequential/parallel и all/allSettled",
    "Применить AbortController и debounce",
  ],
  outOfScope: [
    "детали libuv",
    "Node.js phases в глубину",
    "реализация Promise spec",
  ],
  topics: [
    "call stack",
    "runtime APIs",
    "Promise states",
    "microtasks",
    "macrotasks",
    "setTimeout",
    "queueMicrotask",
    "async/await",
    "try/catch",
    "Promise.all/allSettled",
    "AbortController",
    "parallel/sequential",
    "debounce",
  ],
  misconceptions: [
    "Promise callback выполняется параллельно",
    "setTimeout(0) выполняется сразу",
    "await всегда делает операции последовательными",
  ],
  studies: [
    {
      slug: "execution-model",
      title: "Stack, runtime APIs и queues",
      topics: [
        "call stack",
        "run-to-completion",
        "microtask/macrotask",
        "setTimeout/queueMicrotask",
      ],
      source: mdnEventLoop,
    },
    {
      slug: "promises",
      title: "Promise и async/await",
      topics: [
        "pending/fulfilled/rejected",
        "chaining",
        "async/await",
        "try/catch",
      ],
      source: mdnPromise,
    },
    {
      slug: "composition-cancel",
      title: "Композиция, отмена и debounce",
      topics: [
        "all/allSettled",
        "parallel/sequential",
        "AbortController",
        "debounce",
      ],
      source: mdnAbort,
    },
  ],
  recall: [
    {
      prompt:
        "Почему microtask выполняется до setTimeout после завершения текущего stack?",
      reference:
        "После run-to-completion runtime дренирует microtask queue перед следующей task/macrotask.",
      points: ["run-to-completion", "microtask checkpoint", "next task"],
    },
    {
      prompt: "Сравните Promise.all и allSettled.",
      reference:
        "all fail-fast отклоняется при первой ошибке; allSettled ждёт все и возвращает tagged outcomes.",
      points: ["fail-fast", "все outcomes", "выбор по контракту"],
    },
    {
      prompt: "Что реально отменяет AbortController?",
      reference:
        "Controller только сигнализирует; операция должна поддерживать signal и прекратить работу/ресурсы.",
      points: ["кооперативная отмена", "signal", "cleanup"],
    },
  ],
  quiz: [
    {
      prompt: "Каков начальный state нового Promise?",
      reference: "pending.",
      points: ["pending"],
    },
    {
      prompt: "Перехватит ли try/catch Promise без await?",
      reference:
        "Нет, если rejection возникает асинхронно вне awaited цепочки.",
      points: ["await/return chain"],
    },
    {
      prompt: "Когда параллельный запуск неверен?",
      reference:
        "Когда операции зависят от результата/порядка или ограничены ресурсом.",
      points: ["dependency", "resource limit"],
    },
    {
      prompt: "Что должен делать debounce при новом вызове?",
      reference:
        "Сбросить предыдущий timer и запланировать вызов с актуальными args/context по контракту.",
      points: ["clear timer", "latest args"],
    },
  ],
  codeReading: {
    prompt:
      "Предскажите порядок console.log для sync log, Promise.then, queueMicrotask и setTimeout(0); объясните каждую границу.",
    reference:
      "Сначала sync; затем microtasks в порядке постановки; затем timeout task.",
    points: ["точный порядок", "очереди", "run-to-completion"],
  },
  exerciseTitle: "Отменяемый request pool",
  exerciseSlug: "request-pool",
  exerciseWorkspacePath: "workspaces/exercises/week-01/day-04/request-pool",
  exerciseBrief:
    "Реализовать delay, fetchJson, ограниченный параллельный pool, отмену через signal и debounce.",
  practice: [
    "output prediction записан до запуска",
    "ошибки fetchJson нормализованы",
    "параллелизм ограничен",
    "отмена освобождает работу",
    "debounce не вызывает лишние операции",
  ],
});

const day4 = createStandardDay({
  dayNumber: 4,
  slug: "typescript-boundaries",
  title: "TypeScript: границы и моделирование",
  description:
    "Использовать TypeScript для проверки границ данных, а не для маскировки неизвестного.",
  goal: "Сузить unknown, спроектировать generic API и доказать exhaustiveness без any.",
  prerequisites: ["w1d3-async-event-loop"],
  outcomes: [
    "Применить primitives/arrays/tuples/object types/type/interface",
    "Составить unions/intersections и narrowing",
    "Использовать unknown/never/generics/utility types",
    "Спроектировать discriminated union и type guard",
    "Выбрать Record/Map/Set",
  ],
  outOfScope: [
    "compiler internals",
    "type-level metaprogramming",
    "custom transformers",
  ],
  topics: [
    "primitive types",
    "arrays/tuples",
    "object types",
    "type/interface",
    "unions/intersections",
    "narrowing",
    "unknown/never",
    "generics",
    "utility types",
    "discriminated unions",
    "type guards",
    "Record/Map/Set",
  ],
  misconceptions: [
    "type assertion валидирует runtime data",
    "unknown равен any",
    "interface всегда лучше type",
  ],
  studies: [
    {
      slug: "everyday-types",
      title: "Everyday types и composition",
      topics: [
        "primitives/arrays/tuples",
        "object types",
        "type/interface",
        "union/intersection",
      ],
      source: tsEveryday,
    },
    {
      slug: "narrowing",
      title: "unknown, narrowing и exhaustiveness",
      topics: ["unknown", "type guards", "discriminated unions", "never"],
      source: tsNarrowing,
    },
    {
      slug: "generics-collections",
      title: "Generics, utilities и collections",
      topics: ["generics", "utility types", "Record", "Map", "Set"],
      source: tsGenerics,
    },
  ],
  recall: [
    {
      prompt: "Почему unknown безопаснее any на внешней границе?",
      reference:
        "unknown запрещает операции до runtime narrowing; any отключает проверку и распространяет недоверие.",
      points: ["запрет операций", "narrowing", "граница"],
    },
    {
      prompt: "Как never доказывает exhaustiveness discriminated union?",
      reference:
        "После обработки всех tags остаточный тип сужается до never; assignment/assertNever выявляет новый необработанный вариант.",
      points: ["tag", "narrowing", "новый вариант"],
    },
    {
      prompt: "Когда generic связывает типы, а когда лишь усложняет API?",
      reference:
        "Generic полезен при реальной связи входа/выхода или повторном использовании типа; одиночный несвязанный параметр не добавляет гарантии.",
      points: ["relationship", "inference", "constraint"],
    },
  ],
  quiz: [
    {
      prompt: "Валидирует ли `value as User` runtime input?",
      reference: "Нет, assertion меняет только статическое представление.",
      points: ["нет runtime check"],
    },
    {
      prompt: "Чем tuple отличается от array type?",
      reference:
        "Tuple фиксирует позиции/их типы и обычно длину; array описывает повторяемый element type.",
      points: ["позиции", "длина"],
    },
    {
      prompt: "Когда Map лучше Record?",
      reference:
        "Для ключей не только string/symbol, явного iteration API и runtime collection semantics.",
      points: ["key type", "runtime API"],
    },
    {
      prompt: "Что делает Partial<T>?",
      reference:
        "Создаёт mapped type с optional properties; runtime объект не меняет.",
      points: ["mapped type", "compile time"],
    },
  ],
  codeReading: {
    prompt:
      "Прочитайте reducer discriminated union с default, предскажите риск после добавления нового action и предложите exhaustive fix.",
    reference:
      "Молчаливый default скрывает новый action; assertNever в исчерпывающем switch создаёт compile-time failure.",
    points: ["скрытый вариант", "never", "fix"],
  },
  exerciseTitle: "Typed boundary pipeline",
  exerciseSlug: "parse-events",
  exerciseWorkspacePath: "workspaces/exercises/week-01/day-05/parse-events",
  exerciseBrief:
    "Создать normalizer unknown input, generic groupBy и exhaustive reducer для discriminated union.",
  practice: [
    "unknown проверен type guards",
    "generic groupBy сохраняет K",
    "reducer исчерпывающий",
    "Record/Map/Set выбраны по контракту",
  ],
});

const day5 = createStandardDay({
  dayNumber: 5,
  slug: "react-render-state",
  title: "React render и state",
  description:
    "Понимать render как вычисление snapshot и моделировать минимальное состояние интерфейса.",
  goal: "Объяснить причины rerender и самостоятельно реализовать корректный список с формой и derived values.",
  prerequisites: ["w1d4-typescript-boundaries"],
  outcomes: [
    "Объяснить components/JSX/props/state/render/reconciliation",
    "Выбрать стабильный key",
    "Применить batching и functional updates",
    "Разделить controlled/uncontrolled input",
    "Поднять state и вычислить derived values",
  ],
  outOfScope: [
    "Fiber internals",
    "custom renderer",
    "ручная оптимизация до измерений",
  ],
  topics: [
    "components",
    "JSX",
    "props",
    "state",
    "render",
    "reconciliation",
    "key",
    "parent/context rerender",
    "batching",
    "functional updates",
    "controlled/uncontrolled",
    "lifting state",
    "derived values",
  ],
  misconceptions: [
    "setState немедленно меняет текущую переменную",
    "key нужен только против warning",
    "каждый derived value должен жить в state",
  ],
  studies: [
    {
      slug: "render-snapshot",
      title: "Components, render и state snapshot",
      topics: [
        "components/JSX/props",
        "state snapshot",
        "render trigger",
        "parent/context update",
      ],
      source: reactState,
    },
    {
      slug: "reconciliation-keys",
      title: "Reconciliation, identity и keys",
      topics: [
        "render/commit",
        "reconciliation",
        "stable key",
        "component identity",
      ],
      source: reactRender,
    },
    {
      slug: "updates-inputs",
      title: "Updates, inputs и state design",
      topics: [
        "batching",
        "functional updates",
        "controlled/uncontrolled",
        "lifting state",
        "derived values",
      ],
      source: reactInputs,
    },
  ],
  recall: [
    {
      prompt: "Что означает state as a snapshot для event handler?",
      reference:
        "Каждый render создаёт snapshot значений; handler замыкает значения конкретного render, а update планирует следующий render.",
      points: ["snapshot", "closure", "next render"],
    },
    {
      prompt: "Почему index key ломает редактируемый список?",
      reference:
        "При reorder identity по позиции связывает локальное состояние/DOM с другим item; key должен отражать стабильную доменную identity.",
      points: ["identity", "reorder", "stable domain key"],
    },
    {
      prompt: "Когда нужен functional update?",
      reference:
        "Когда следующий state зависит от предыдущего, особенно при batching нескольких updates.",
      points: ["depends on previous", "batching"],
    },
  ],
  quiz: [
    {
      prompt: "Всегда ли parent rerender вызывает DOM mutation ребёнка?",
      reference:
        "Render может быть вызван, но commit изменит DOM только при отличии результата.",
      points: ["render vs commit"],
    },
    {
      prompt: "Можно ли использовать Math.random() как key?",
      reference: "Нет: identity меняется каждый render и приводит к remount.",
      points: ["stable identity"],
    },
    {
      prompt: "Где хранить отфильтрованный список?",
      reference:
        "Обычно вычислять из source state/props во время render, не дублировать.",
      points: ["derived value"],
    },
    {
      prompt: "Чем controlled input отличается от uncontrolled?",
      reference:
        "Controlled value задаёт React state/props; uncontrolled хранит текущее значение в DOM.",
      points: ["source of truth"],
    },
  ],
  codeReading: {
    prompt:
      "Предскажите результат трёх setCount(count + 1), затем трёх setCount(c => c + 1), и объясните batching.",
    reference:
      "Первая серия использует один snapshot и обычно даёт +1; functional updaters последовательно применяются и дают +3.",
    points: ["prediction", "snapshot", "updater queue"],
  },
  exerciseTitle: "Редактируемый список задач",
  exerciseSlug: "filterable-list",
  exerciseWorkspacePath: "workspaces/exercises/week-01/day-06/filterable-list",
  exerciseBrief:
    "Реализовать список задач, фильтр, controlled form и редактирование со стабильными keys и functional updates.",
  practice: [
    "controlled form имеет один source of truth",
    "редактирование immutable",
    "keys стабильны при reorder",
    "filter — derived value",
    "зависимые updates функциональные",
  ],
});

const day6 = createStandardDay({
  dayNumber: 6,
  slug: "effects-refs-server-state",
  title: "Effects, refs и server state",
  description:
    "Отделить синхронизацию с внешним миром от render-вычислений и server cache.",
  goal: "Обосновать каждый Effect и построить небольшой server-state flow с cleanup, ref и invalidation.",
  prerequisites: ["w1d5-react-render-state"],
  outcomes: [
    "Проектировать effect dependencies/cleanup и понимать Strict Mode",
    "Выбрать DOM/mutable ref и custom hook",
    "Не заменять derived state Effect-ом",
    "Разделить Context/Zustand/Redux Toolkit и server state",
    "Настроить TanStack Query query/mutation/invalidation",
    "Понимать место React Hook Form и Zod",
  ],
  outOfScope: [
    "внутренности React scheduler",
    "глубокий Redux middleware",
    "SSR hydration cache в глубину",
  ],
  topics: [
    "useEffect",
    "dependencies",
    "cleanup",
    "stale closure",
    "useRef",
    "DOM/mutable ref",
    "custom hooks",
    "Strict Mode",
    "derived state without Effect",
    "Context",
    "Zustand",
    "Redux Toolkit",
    "server state",
    "TanStack Query",
    "queryKey/queryFn",
    "loading/error/data",
    "mutations/invalidation",
    "React Hook Form",
    "Zod",
  ],
  misconceptions: [
    "Effect нужен для любого вычисления",
    "ref update вызывает render",
    "server data надо копировать в global client state",
  ],
  studies: [
    {
      slug: "effects",
      title: "Effects, dependencies и cleanup",
      topics: [
        "external synchronization",
        "dependencies",
        "cleanup",
        "stale closure",
        "Strict Mode",
        "derived state без Effect",
      ],
      source: reactEffects,
    },
    {
      slug: "refs-hooks",
      title: "Refs и custom hooks",
      topics: [
        "DOM ref",
        "mutable ref",
        "render-neutral state",
        "custom hook contract",
      ],
      source: reactRefs,
    },
    {
      slug: "state-landscape",
      title: "Client state и forms overview",
      topics: [
        "Context",
        "Zustand overview",
        "Redux Toolkit overview",
        "React Hook Form overview",
        "Zod boundary",
      ],
      source: reactInputs,
    },
    {
      slug: "server-state",
      title: "TanStack Query server state",
      topics: [
        "queryKey/queryFn",
        "pending/error/data",
        "mutation",
        "invalidation",
      ],
      source: tanstackQueries,
    },
  ],
  recall: [
    {
      prompt: "Как понять, нужен ли useEffect?",
      reference:
        "Effect нужен для синхронизации с внешней системой после commit; чистые derived values вычисляются во время render.",
      points: ["external system", "commit", "derived value"],
    },
    {
      prompt: "Чем ref отличается от state?",
      reference:
        "ref сохраняет mutable value между renders, но изменение current не планирует render; state update планирует.",
      points: ["persistence", "no rerender", "state contrast"],
    },
    {
      prompt: "Почему server state не равен global client state?",
      reference:
        "Server state удалённое, асинхронное, разделяемое и устаревающее; query cache управляет freshness/loading/retry/invalidation.",
      points: ["remote ownership", "staleness", "cache lifecycle"],
    },
  ],
  quiz: [
    {
      prompt: "Когда вызывается cleanup Effect?",
      reference:
        "Перед повторным запуском изменившегося Effect и при unmount; dev Strict Mode дополнительно проверяет setup/cleanup.",
      points: ["before rerun", "unmount"],
    },
    {
      prompt: "Входит ли ref.current в dependency list?",
      reference:
        "Обычно нет: mutable current не реактивен и его изменение не запускает render.",
      points: ["not reactive"],
    },
    {
      prompt: "Что должна включать queryKey?",
      reference:
        "Все сериализуемые параметры, от которых зависит queryFn/result identity.",
      points: ["dependencies", "identity"],
    },
    {
      prompt: "Что делать после успешной mutation?",
      reference:
        "По контракту обновить cache напрямую или invalidate релевантные queries.",
      points: ["cache update/invalidation"],
    },
  ],
  codeReading: {
    prompt:
      "Найдите stale closure и missing cleanup в timer Effect; предскажите поведение Strict Mode и предложите fix.",
    reference:
      "Effect с пустыми deps замыкает старое значение, а без clearInterval дублируется; использовать functional update/правильные deps и cleanup.",
    points: ["stale closure", "duplicate subscription", "cleanup", "fix"],
  },
  exerciseTitle: "Server-state activity list",
  exerciseSlug: "activity-feed",
  exerciseWorkspacePath: "workspaces/exercises/week-01/day-07/activity-feed",
  exerciseBrief:
    "Собрать список через TanStack Query, mutation/invalidation, useDebounce, localStorage preference, auto focus и доступное модальное окно.",
  practice: [
    "timer очищается",
    "auto focus использует DOM ref",
    "useDebounce не содержит stale closure",
    "localStorage синхронизируется Effect-ом",
    "query states честны",
    "mutation инвалидирует нужный key",
    "modal управляет focus",
  ],
});

const day7 = createStandardDay({
  dayNumber: 7,
  slug: "integration-checkpoint",
  title: "Интеграционная контрольная точка",
  description:
    "Связать JS, TypeScript и React в одном самостоятельном объяснении и небольшом приложении.",
  goal: "Доказать перенос знаний: воспроизведение, короткая проверка, чтение кода, приложение и отдельное техническое интервью.",
  prerequisites: ["w1d6-effects-refs-server-state"],
  outcomes: [
    "Связать runtime JS и static TS",
    "Объяснить React render/effect boundary",
    "Реализовать мини-приложение с unknown boundary",
    "Пройти последовательное интервью",
    "Зафиксировать мастерство, ошибки, карточки и план следующей недели",
  ],
  outOfScope: [
    "новые framework APIs",
    "production deployment",
    "архитектурный deep dive",
  ],
  topics: [
    "смешанное воспроизведение по памяти на JS",
    "TypeScript boundary",
    "React state/effects",
    "чтение кода",
    "интеграционное приложение",
    "техническое интервью",
    "еженедельные подтверждения навыка",
  ],
  misconceptions: [
    "знать термин означает уметь применить",
    "passing happy path достаточно",
    "Автопроверка заменяет собственную проверку",
  ],
  studies: [
    {
      slug: "spaced-review",
      title: "Интервальное повторение: JS и async",
      topics: ["values/closures", "event loop", "ошибки и отмена"],
      source: mdnEventLoop,
    },
    {
      slug: "integration-map",
      title: "Карта границ TS и React",
      topics: [
        "unknown at boundary",
        "state identity",
        "Effect vs derived value",
        "server cache",
      ],
      source: tsNarrowing,
    },
  ],
  recall: [
    {
      prompt: "Свяжите unknown input, immutable normalization и React render.",
      reference:
        "Runtime parser сужает unknown и создаёт новую доменную модель; React render получает предсказуемые typed values и сохраняет identity только там, где это нужно.",
      points: ["runtime validation", "immutability", "render identity"],
    },
    {
      prompt: "Свяжите closure, state snapshot и stale Effect.",
      reference:
        "Handler/Effect closure сохраняет bindings render snapshot; неверные deps оставляют устаревший closure, functional update или корректная resubscription устраняет проблему.",
      points: ["closure", "snapshot", "dependencies/fix"],
    },
    {
      prompt: "Как async cancellation должна отражаться в UI state?",
      reference:
        "Abort — отдельный ожидаемый outcome; stale result не должен перезаписать новый, cleanup отменяет operation, UI различает loading/error/data/cancel.",
      points: ["abort outcome", "race protection", "honest state"],
    },
  ],
  quiz: [
    {
      prompt: "Что проверяется runtime: interface или parser?",
      reference: "Parser/type guard; interface исчезает после compile.",
      points: ["runtime parser"],
    },
    {
      prompt: "Что раньше: Promise.then или setTimeout?",
      reference:
        "Promise microtask после текущего stack, до следующей timeout task.",
      points: ["microtask"],
    },
    {
      prompt: "Что сохраняет stable key?",
      reference: "Доменную identity component instance между renders.",
      points: ["identity"],
    },
    {
      prompt: "Нужен ли Effect для filteredItems?",
      reference: "Нет, это pure derived value из props/state.",
      points: ["derived during render"],
    },
  ],
  codeReading: {
    prompt:
      "В одном фрагменте найдите unsafe assertion, mutation, index key, stale Effect и sequential independent fetches; предскажите симптомы и расставьте fixes по риску.",
    reference:
      "Сначала runtime validation и mutation/identity, затем stale subscription/cleanup, затем parallelization независимых запросов; каждый fix проверяется отдельно.",
    points: ["пять дефектов", "симптомы", "приоритизация", "fixes"],
  },
  exerciseTitle: "Typed activity mini-app",
  exerciseSlug: "activity-feed",
  exerciseWorkspacePath: "workspaces/exercises/week-01/day-07/activity-feed",
  exerciseBrief:
    "Реализовать parser unknown-событий, immutable grouping, React filter/editor и честные async states с собственными тестами.",
  practice: [
    "unknown boundary validated",
    "grouping stable and immutable",
    "React state minimal",
    "effects have cleanup",
    "loading/error/empty shown",
    "минимум пять собственных tests",
  ],
  includeInterview: true,
});

export const draftRoadmapWeeks = [
  {
    stableId: "roadmap-week-02",
    weekNumber: 2,
    order: 2,
    status: "draft",
    title: "Платформа web-приложения",
    topics: [
      "TypeScript глубже",
      "browser",
      "HTTP",
      "REST",
      "cookies",
      "CORS",
      "authentication",
      "Next.js",
      "Node.js",
      "Express/Nest overview",
      "tests",
    ],
  },
  {
    stableId: "roadmap-week-03",
    weekNumber: 3,
    order: 3,
    status: "draft",
    title: "Frontend architecture и рабочие практики",
    topics: [
      "frontend architecture",
      "FSD",
      "проектирование features",
      "Zustand/Redux",
      "TanStack Query глубже",
      "forms",
      "performance",
      "security",
      "Git",
      "Jira",
      "code review",
    ],
  },
  {
    stableId: "roadmap-week-04",
    weekNumber: 4,
    order: 4,
    status: "draft",
    title: "Backend foundation и интеграционный проект",
    topics: [
      "Node.js",
      "backend architecture",
      "databases",
      "PostgreSQL",
      "logging",
      "testing",
      "Docker",
      "интеграционный проект",
    ],
  },
  {
    stableId: "roadmap-week-05",
    weekNumber: 5,
    order: 5,
    status: "draft",
    title: "LLM systems и agent harnesses",
    topics: [
      "LLM basics",
      "agents",
      "workflows",
      "tool calling",
      "MCP",
      "RAG",
      "memory",
      "evals",
      "observability",
      "permissions",
      "harness architecture",
    ],
  },
] as const satisfies readonly DraftRoadmapWeek[];

/** Metadata bridge for the untouched legacy `weekOneCurriculum` export. */
export const archivedLegacyCurriculumVersion = {
  id: "curriculum-legacy-v1-r1",
  curriculumId: "curriculum-foundation",
  revision: 1,
  status: "archived",
  title: "JavaScript и TypeScript: снова писать руками",
  publishedAt: "2026-07-01T00:00:00.000Z",
  archivedAt: "2026-07-31T00:00:00.000Z",
  preservedExport: "weekOneCurriculum",
} as const satisfies LegacyCurriculumVersionReference;

export const foundationWeekV2 = {
  stableId: "foundation-week-01",
  weekNumber: 1,
  order: 1,
  title: "Неделя 1. JavaScript, TypeScript и React: восстановление фундамента",
  description:
    "Семь дней активного воспроизведения, диалогов с преподавателем, чтения кода и самостоятельной практики в Zed.",
  status: "published",
  days: [day1, day2, day3, day4, day5, day6, day7],
} as const;

export const publishedCurriculumV2 = {
  id: "curriculum-foundation-v2-r1",
  curriculumId: "curriculum-foundation",
  revision: 1,
  parentVersionId: "curriculum-legacy-v1-r1",
  status: "published",
  title: "JavaScript, TypeScript и React: восстановление фундамента",
  description:
    "Пошаговая программа для восстановления самостоятельного объяснения, чтения кода и написания кода без AI-генерации решения.",
  contentHash:
    "718cdc33e674ce54093d5e5d4bc09686141ea41dec5d26e39c5775f2aa0576e6",
  createdAt: "2026-07-31T00:00:00.000Z",
  publishedAt: "2026-07-31T00:00:00.000Z",
  archivedAt: null,
  weeks: [foundationWeekV2],
  draftRoadmap: draftRoadmapWeeks,
} as const satisfies VersionedCurriculumVersion;

export function getPublishedCurriculumV2Day(
  stableId: string,
): VersionedCurriculumDay | undefined {
  return publishedCurriculumV2.weeks
    .flatMap((week) => week.days)
    .find((day) => day.stableId === stableId);
}
