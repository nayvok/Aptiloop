export type QuestionKind =
  | "explain"
  | "compare"
  | "predict-output"
  | "find-bug"
  | "design-choice"
  | "interview";

export type ExerciseDifficulty = "easy" | "medium" | "hard";

export interface CurriculumSource {
  readonly title: string;
  readonly url: string;
  readonly kind: "documentation" | "article" | "video" | "book";
}

export interface CurriculumTopic {
  readonly id: string;
  readonly title: string;
  readonly prompts: readonly string[];
  readonly sources: readonly CurriculumSource[];
}

export interface LearningQuestion {
  readonly id: string;
  readonly kind: QuestionKind;
  readonly prompt: string;
  readonly referenceAnswer: string;
  readonly evaluationPoints: readonly string[];
  readonly commonMistakes: readonly string[];
}

export interface ExerciseCriterion {
  readonly id: string;
  readonly description: string;
}

export interface CurriculumExercise {
  readonly id: string;
  readonly title: string;
  readonly workspacePath: string;
  readonly difficulty: ExerciseDifficulty;
  readonly estimatedMinutes: number;
  readonly brief: string;
  readonly constraints: readonly string[];
  readonly topics: readonly string[];
  readonly criteria: readonly ExerciseCriterion[];
  readonly referenceApproach: string;
}

export interface CommonMistake {
  readonly id: string;
  readonly symptom: string;
  readonly correction: string;
}

export interface CurriculumDay {
  readonly id: string;
  readonly dayNumber: number;
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly estimatedMinutes: number;
  readonly goals: readonly string[];
  readonly topics: readonly CurriculumTopic[];
  readonly questions: readonly LearningQuestion[];
  readonly exercises: readonly CurriculumExercise[];
  readonly commonMistakes: readonly CommonMistake[];
}

export interface CurriculumWeek {
  readonly id: string;
  readonly weekNumber: number;
  readonly title: string;
  readonly summary: string;
  readonly estimatedMinutesPerDay: number;
  readonly days: readonly CurriculumDay[];
}

const mdn = (title: string, path: string): CurriculumSource => ({
  title,
  url: `https://developer.mozilla.org/en-US/docs/Web/JavaScript/${path}`,
  kind: "documentation",
});

export const weekOneCurriculum = {
  id: "week-01",
  weekNumber: 1,
  title: "JavaScript и TypeScript: снова писать руками",
  summary:
    "Неделя восстанавливает точный язык объяснений и базовые приёмы работы с данными, функциями, асинхронностью и типами. Каждый день заканчивается самостоятельным кодом без генерации решения агентом.",
  estimatedMinutesPerDay: 180,
  days: [
    {
      id: "week-01-day-01",
      dayNumber: 1,
      slug: "values-scope-execution",
      title: "Значения, область видимости и выполнение программы",
      summary:
        "Разобрать, что именно хранит переменная и как движок ищет binding.",
      estimatedMinutes: 175,
      goals: [
        "Без подсказки объяснить различие value, binding и reference.",
        "Предсказать поведение let, const и var до запуска кода.",
        "Написать несколько функций с явной обработкой пограничных значений.",
      ],
      topics: [
        {
          id: "js-values-equality",
          title: "Значения, типы и равенство",
          prompts: [
            "primitive против object",
            "=== и Object.is",
            "truthy/falsy без зубрёжки",
          ],
          sources: [
            mdn("JavaScript data types and data structures", "Data_structures"),
            mdn(
              "Equality comparisons and sameness",
              "Equality_comparisons_and_sameness",
            ),
          ],
        },
        {
          id: "js-scope-tdz",
          title: "Lexical scope, hoisting и TDZ",
          prompts: [
            "environment record",
            "поиск имени по внешним scope",
            "почему TDZ полезна",
          ],
          sources: [
            mdn("Grammar and types", "Guide/Grammar_and_types"),
            mdn("Closures", "Guide/Closures"),
          ],
        },
      ],
      questions: [
        {
          id: "w1d1-q1",
          kind: "compare",
          prompt:
            "Чем присваивание объекта отличается от копирования примитива? Ответьте за 60 секунд.",
          referenceAnswer:
            "Переменная хранит значение. Для примитива этим значением является сам primitive, а для объекта — ссылочное значение, указывающее на один объект. Поэтому присваивание объекта создаёт второй binding к тому же объекту и мутация видна через оба binding; переназначение одного binding не меняет другой.",
          evaluationPoints: [
            "Нет формулировки «объекты передаются по ссылке»",
            "Различены мутация и переназначение",
            "Есть короткий пример",
          ],
          commonMistakes: [
            "Считать const глубокой неизменяемостью",
            "Называть переменную контейнером самого объекта",
          ],
        },
        {
          id: "w1d1-q2",
          kind: "predict-output",
          prompt:
            "Что произойдёт при чтении let-binding до строки объявления и почему это не undefined?",
          referenceAnswer:
            "Binding создаётся при создании lexical environment, но остаётся неинициализированным до выполнения декларации. Чтение в TDZ бросает ReferenceError. Это позволяет выявить доступ до инициализации, в отличие от var, который заранее инициализируется undefined.",
          evaluationPoints: [
            "Назван ReferenceError",
            "Объяснена неинициализированность",
            "Проведено отличие от var",
          ],
          commonMistakes: [
            "Говорить, что let не hoistится",
            "Путать ReferenceError с TypeError",
          ],
        },
      ],
      exercises: [
        {
          id: "w1d1-normalize-profile",
          title: "Нормализация профиля",
          workspacePath:
            "workspaces/exercises/week-01/day-01/normalize-profile",
          difficulty: "easy",
          estimatedMinutes: 45,
          brief:
            "Реализовать чистую функцию, которая проверяет неизвестный вход и возвращает нормализованный профиль без мутации исходного объекта.",
          constraints: [
            "Не использовать JSON stringify/parse для копирования",
            "Не менять вход",
            "Различать отсутствующее и пустое значение",
          ],
          topics: ["values", "objects", "control-flow"],
          criteria: [
            {
              id: "valid-shape",
              description: "Некорректные формы входа отвергаются предсказуемо.",
            },
            {
              id: "no-mutation",
              description: "Входной объект и вложенные массивы не мутируются.",
            },
            {
              id: "edges",
              description:
                "Пустые строки, ноль и отсутствие поля обработаны явно.",
            },
          ],
          referenceApproach:
            "Сначала сузить unknown небольшими type guards, затем построить новый объект и отдельно скопировать допустимые вложенные коллекции.",
        },
      ],
      commonMistakes: [
        {
          id: "w1d1-m1",
          symptom: "Объяснение сводится к «const нельзя менять».",
          correction:
            "Разделить запрет переназначения binding и возможность мутировать объект.",
        },
        {
          id: "w1d1-m2",
          symptom: "Ветка `if (value)` отбрасывает 0 и пустую строку.",
          correction: "Проверять именно доменное условие или nullish-значение.",
        },
      ],
    },
    {
      id: "week-01-day-02",
      dayNumber: 2,
      slug: "collection-transformations",
      title: "Преобразования коллекций",
      summary:
        "Выбирать map/filter/reduce и строить lookup-структуры с понятной сложностью.",
      estimatedMinutes: 180,
      goals: [
        "Реализовать groupBy без подсказки",
        "Объяснить один проход против цепочки проходов",
        "Корректно обработать duplicate keys",
      ],
      topics: [
        {
          id: "array-iteration",
          title: "Итерационные методы массивов",
          prompts: [
            "map/filter/reduce",
            "мутация accumulator",
            "sparse arrays",
          ],
          sources: [
            mdn("Array", "Reference/Global_Objects/Array"),
            mdn(
              "Array.prototype.reduce",
              "Reference/Global_Objects/Array/reduce",
            ),
          ],
        },
        {
          id: "lookup-structures",
          title: "Record, Map и Set",
          prompts: [
            "семантика ключей",
            "порядок вставки",
            "защита от prototype keys",
          ],
          sources: [
            mdn("Map", "Reference/Global_Objects/Map"),
            mdn("Set", "Reference/Global_Objects/Set"),
          ],
        },
      ],
      questions: [
        {
          id: "w1d2-q1",
          kind: "design-choice",
          prompt:
            "Когда для группировки выбрать Map, а когда объект без prototype?",
          referenceAnswer:
            "Map подходит для ключей любого типа, сохраняет порядок вставки и имеет явный API/size. Объект удобен на JSON-границе и для строковых/символьных ключей, но обычный `{}` наследует prototype; безопаснее Object.create(null) либо явная проверка own property.",
          evaluationPoints: [
            "Упомянуты типы ключей",
            "Учтены prototype keys",
            "Решение связано с границей данных",
          ],
          commonMistakes: [
            "Считать доступ Map через []",
            "Использовать `key in result` для обычного объекта без обсуждения prototype",
          ],
        },
        {
          id: "w1d2-q2",
          kind: "find-bug",
          prompt:
            "Почему `acc[key] = acc[key] || []` может быть плохим универсальным шаблоном аккумулятора?",
          referenceAnswer:
            "Он смешивает отсутствие свойства с любым falsy-значением и на обычном объекте может прочитать унаследованное свойство вроде constructor. Контракт лучше выразить через Map или own-property/null-prototype объект и точную проверку.",
          evaluationPoints: [
            "Различено falsy и отсутствие",
            "Замечен prototype chain",
            "Предложена точная альтернатива",
          ],
          commonMistakes: [
            "Обсуждать только производительность",
            "Игнорировать специальные строковые ключи",
          ],
        },
      ],
      exercises: [
        {
          id: "w1d2-collection-toolkit",
          title: "Collection toolkit",
          workspacePath:
            "workspaces/exercises/week-01/day-02/collection-toolkit",
          difficulty: "medium",
          estimatedMinutes: 60,
          brief:
            "Реализовать groupBy, uniqueBy и countBy, сохранив порядок и корректную семантику ключей.",
          constraints: [
            "Не менять вход",
            "Не сортировать коллекцию",
            "Не использовать lodash",
            "Сохранить generic-типы",
          ],
          topics: ["arrays", "Map", "Set", "generics", "complexity"],
          criteria: [
            {
              id: "group-order",
              description:
                "groupBy сохраняет порядок элементов внутри каждой группы.",
            },
            {
              id: "unique-first",
              description:
                "uniqueBy оставляет первое значение для каждого ключа.",
            },
            {
              id: "count-keys",
              description:
                "countBy поддерживает объектные ключи благодаря Map.",
            },
            {
              id: "immutable",
              description: "Ни одна функция не мутирует исходный массив.",
            },
          ],
          referenceApproach:
            "Создать новый Map и пройти вход ровно один раз на операцию. Для группы брать существующий массив или создавать новый; для uniqueBy держать Set увиденных ключей; для countBy обновлять число через nullish fallback.",
        },
      ],
      commonMistakes: [
        {
          id: "w1d2-m1",
          symptom: "Результат группировки теряет исходный порядок.",
          correction:
            "Не сортировать: добавлять элементы в группу по мере единственного прохода.",
        },
        {
          id: "w1d2-m2",
          symptom: "Тип selector заменён на `(item: any) => any`.",
          correction:
            "Связать тип элемента и ключа независимыми generic-параметрами T и K.",
        },
      ],
    },
    {
      id: "week-01-day-03",
      dayNumber: 3,
      slug: "functions-closures-this",
      title: "Функции, closures и this",
      summary: "Отделить lexical environment от правил вычисления this.",
      estimatedMinutes: 180,
      goals: [
        "Нарисовать окружения замыкания",
        "Объяснить call-site binding this",
        "Применить функции высшего порядка без скрытого состояния",
      ],
      topics: [
        {
          id: "closures",
          title: "Замыкания и время жизни состояния",
          prompts: [
            "lexical environment",
            "factory functions",
            "утечки через удерживаемые ссылки",
          ],
          sources: [mdn("Closures", "Guide/Closures")],
        },
        {
          id: "this-binding",
          title: "Обычные и стрелочные функции",
          prompts: ["call-site", "bind/call/apply", "lexical this"],
          sources: [
            mdn("this", "Reference/Operators/this"),
            mdn("Arrow functions", "Reference/Functions/Arrow_functions"),
          ],
        },
      ],
      questions: [
        {
          id: "w1d3-q1",
          kind: "explain",
          prompt:
            "Что сохраняет closure и почему значение не «копируется» в момент создания функции?",
          referenceAnswer:
            "Функция сохраняет доступ к lexical environment, то есть к bindings, а не снимок их текущих значений. Поэтому последующее изменение доступного binding видно при следующем вызове, пока окружение достижимо через функцию.",
          evaluationPoints: [
            "Назван lexical environment",
            "Binding отличён от snapshot",
            "Объяснено время жизни",
          ],
          commonMistakes: [
            "Говорить, что closure — это любая callback",
            "Считать захваченное значение неизменным",
          ],
        },
        {
          id: "w1d3-q2",
          kind: "predict-output",
          prompt:
            "Почему извлечённый из объекта метод часто теряет this, а стрелка внутри метода — нет?",
          referenceAnswer:
            "У обычной функции this определяется формой вызова. После извлечения `const f = obj.method; f()` receiver отсутствует. Стрелочная функция не создаёт собственный this и читает его из окружающего lexical context.",
          evaluationPoints: [
            "Указана форма вызова",
            "Объяснена стрелочная функция",
            "Не сказано, что this — scope объекта",
          ],
          commonMistakes: [
            "Считать this ссылкой на место объявления",
            "Безусловно советовать bind для любого метода",
          ],
        },
      ],
      exercises: [
        {
          id: "w1d3-once-memoize",
          title: "once и memoizeOne",
          workspacePath:
            "workspaces/exercises/week-01/day-03/function-wrappers",
          difficulty: "medium",
          estimatedMinutes: 55,
          brief:
            "Написать типобезопасные обёртки функций, сохранив аргументы, результат и this.",
          constraints: [
            "Без any",
            "Не вызывать исходную функцию лишний раз",
            "Кешировать и undefined",
          ],
          topics: ["closures", "this", "generics"],
          criteria: [
            {
              id: "signature",
              description: "Публичная сигнатура исходной функции сохраняется.",
            },
            {
              id: "undefined",
              description:
                "undefined корректно считается закешированным результатом.",
            },
            {
              id: "receiver",
              description: "Receiver передаётся исходной функции.",
            },
          ],
          referenceApproach:
            "Хранить отдельный boolean наличия результата, arguments tuple и result; исходную функцию вызывать через apply с текущим receiver.",
        },
      ],
      commonMistakes: [
        {
          id: "w1d3-m1",
          symptom: "Кеш проверяется truthy-условием.",
          correction: "Хранить флаг наличия отдельно от значения результата.",
        },
        {
          id: "w1d3-m2",
          symptom: "Wrapper вызывает fn(...args) и теряет receiver.",
          correction:
            "Явно передать this через apply/call и типизировать this parameter.",
        },
      ],
    },
    {
      id: "week-01-day-04",
      dayNumber: 4,
      slug: "async-event-loop",
      title: "Event loop, promises и отмена",
      summary:
        "Объяснять порядок событий и проектировать асинхронные функции с ошибками и отменой.",
      estimatedMinutes: 185,
      goals: [
        "Предсказать порядок sync/microtask/task",
        "Не терять rejection",
        "Провести AbortSignal через цепочку вызовов",
      ],
      topics: [
        {
          id: "event-loop",
          title: "Задачи и microtasks",
          prompts: [
            "call stack",
            "microtask checkpoint",
            "timer не гарантирует точную задержку",
          ],
          sources: [
            mdn("Event loop", "Reference/Execution_model"),
            mdn("Using promises", "Guide/Using_promises"),
          ],
        },
        {
          id: "async-control",
          title: "Ошибки, параллельность и cancellation",
          prompts: ["Promise.all", "sequential await", "AbortController"],
          sources: [
            mdn("Promise", "Reference/Global_Objects/Promise"),
            mdn("AbortController", "Reference/Global_Objects/AbortController"),
          ],
        },
      ],
      questions: [
        {
          id: "w1d4-q1",
          kind: "predict-output",
          prompt:
            "В каком порядке выполнятся синхронный log, Promise.then и setTimeout(..., 0), и почему?",
          referenceAnswer:
            "Сначала выполняется текущая task и синхронный код. После опустошения stack движок делает microtask checkpoint, поэтому Promise reaction выполняется раньше следующей task с timer callback. Нулевая задержка означает минимальную готовность, а не немедленный вызов.",
          evaluationPoints: [
            "sync раньше async",
            "microtask раньше timer task",
            "Нет обещания точного времени timer",
          ],
          commonMistakes: [
            "Называть Promise отдельным потоком",
            "Считать setTimeout(0) немедленным",
          ],
        },
        {
          id: "w1d4-q2",
          kind: "design-choice",
          prompt: "Когда await в цикле — ошибка, а когда правильная семантика?",
          referenceAnswer:
            "Если независимые операции можно запускать вместе, последовательный await создаёт лишнюю задержку — подходят заранее созданные promises и Promise.all/settled. Если следующая операция зависит от результата, есть rate limit или нужен ранний stop, последовательность намеренная.",
          evaluationPoints: [
            "Указана независимость операций",
            "Есть причины последовательности",
            "Учтена политика ошибок",
          ],
          commonMistakes: [
            "Всегда запрещать await в цикле",
            "Забывать о частичных ошибках",
          ],
        },
      ],
      exercises: [
        {
          id: "w1d4-request-pool",
          title: "Ограниченный пул запросов",
          workspacePath: "workspaces/exercises/week-01/day-04/request-pool",
          difficulty: "hard",
          estimatedMinutes: 70,
          brief:
            "Выполнить набор асинхронных jobs с ограничением concurrency, сохранением порядка результатов и AbortSignal.",
          constraints: [
            "Не запускать больше limit jobs",
            "Не менять порядок результатов",
            "Не проглатывать ошибку",
          ],
          topics: ["promises", "concurrency", "cancellation"],
          criteria: [
            {
              id: "limit",
              description:
                "Число одновременно выполняемых jobs не превышает limit.",
            },
            {
              id: "order",
              description: "Результаты соответствуют порядку входа.",
            },
            {
              id: "abort",
              description: "AbortSignal останавливает запуск новых jobs.",
            },
          ],
          referenceApproach:
            "Создать ограниченное число worker-функций, выдавать им следующий индекс из общего счётчика и записывать результат по исходному индексу; перед каждым запуском проверять signal.",
        },
      ],
      commonMistakes: [
        {
          id: "w1d4-m1",
          symptom: "Все promises создаются до применения limit.",
          correction:
            "Ограничивать именно момент вызова job, а не только ожидание готовых promises.",
        },
        {
          id: "w1d4-m2",
          symptom: "catch возвращает undefined и скрывает ошибку.",
          correction:
            "Определить политику ошибки и rethrow либо вернуть явный discriminated result.",
        },
      ],
    },
    {
      id: "week-01-day-05",
      dayNumber: 5,
      slug: "typescript-narrowing-generics",
      title: "TypeScript: narrowing и generics",
      summary:
        "Использовать типы для доказательства инвариантов, не маскируя unknown assertion-ами.",
      estimatedMinutes: 180,
      goals: [
        "Без as сузить unknown",
        "Спроектировать discriminated union",
        "Понять, когда generic сохраняет связь типов",
      ],
      topics: [
        {
          id: "ts-narrowing",
          title: "Control-flow analysis и unknown",
          prompts: ["type guards", "discriminated unions", "exhaustiveness"],
          sources: [
            {
              title: "TypeScript Handbook: Narrowing",
              url: "https://www.typescriptlang.org/docs/handbook/2/narrowing.html",
              kind: "documentation",
            },
          ],
        },
        {
          id: "ts-generics",
          title: "Связи между generic-параметрами",
          prompts: [
            "constraints",
            "keyof",
            "inference против explicit arguments",
          ],
          sources: [
            {
              title: "TypeScript Handbook: Generics",
              url: "https://www.typescriptlang.org/docs/handbook/2/generics.html",
              kind: "documentation",
            },
          ],
        },
      ],
      questions: [
        {
          id: "w1d5-q1",
          kind: "compare",
          prompt: "Чем unknown отличается от any на границе API?",
          referenceAnswer:
            "Оба типа допускают присвоить произвольное входное значение, но unknown запрещает небезопасные операции до проверки. any отключает проверку и распространяется дальше. Поэтому unknown сохраняет обязанность runtime-валидации на недоверенной границе.",
          evaluationPoints: [
            "Указана необходимость narrowing",
            "Объяснено распространение any",
            "Связано с runtime-границей",
          ],
          commonMistakes: [
            "Считать unknown вариантом object",
            "Использовать assertion вместо проверки",
          ],
        },
        {
          id: "w1d5-q2",
          kind: "explain",
          prompt:
            "Что generic даёт сверх union в сигнатуре identity-подобной функции?",
          referenceAnswer:
            "Union говорит лишь, что параметр и результат входят в набор типов, но может потерять соответствие конкретного входа и выхода. Generic-параметр связывает позиции: при вызове T выводится из аргумента, и результат сохраняет этот конкретный тип.",
          evaluationPoints: [
            "Названа связь входа и выхода",
            "Показана роль inference",
            "Generic не назван просто placeholder",
          ],
          commonMistakes: [
            "Использовать generic, встречающийся один раз",
            "Считать T runtime-значением",
          ],
        },
      ],
      exercises: [
        {
          id: "w1d5-parse-events",
          title: "Парсер доменных событий",
          workspacePath: "workspaces/exercises/week-01/day-05/parse-events",
          difficulty: "medium",
          estimatedMinutes: 65,
          brief:
            "Преобразовать unknown JSON в discriminated union событий и исчерпывающе обработать варианты.",
          constraints: [
            "Без any",
            "Без внешней schema-библиотеки",
            "Assertions допустимы только после доказанной проверки",
          ],
          topics: ["unknown", "narrowing", "unions"],
          criteria: [
            {
              id: "validation",
              description:
                "Каждое используемое поле проверяется во время выполнения.",
            },
            {
              id: "union",
              description: "Успех представлен discriminated union.",
            },
            {
              id: "exhaustive",
              description: "Handler имеет compile-time exhaustive check.",
            },
          ],
          referenceApproach:
            "Проверить record-shaped значение, затем discriminator и поля конкретной ветки; вернуть typed result union, а handler завершить never-check.",
        },
      ],
      commonMistakes: [
        {
          id: "w1d5-m1",
          symptom: "`as Event` стоит сразу после JSON.parse.",
          correction:
            "Принимать результат как unknown и доказать форму runtime-проверками.",
        },
        {
          id: "w1d5-m2",
          symptom: "Default silently игнорирует новый вариант union.",
          correction: "В default присвоить значение переменной типа never.",
        },
      ],
    },
    {
      id: "week-01-day-06",
      dayNumber: 6,
      slug: "react-state-effects",
      title: "React: render, state и effects",
      summary:
        "Вернуть точную ментальную модель render/commit и убрать эффекты, которые дублируют вычисления.",
      estimatedMinutes: 180,
      goals: [
        "Объяснить snapshot state",
        "Отличить событие от effect",
        "Спроектировать состояние без дублирования",
      ],
      topics: [
        {
          id: "react-render-state",
          title: "Render как вычисление снимка UI",
          prompts: ["state snapshot", "batching", "functional updater"],
          sources: [
            {
              title: "React: State as a Snapshot",
              url: "https://react.dev/learn/state-as-a-snapshot",
              kind: "documentation",
            },
          ],
        },
        {
          id: "react-effects",
          title: "Синхронизация с внешними системами",
          prompts: ["event против effect", "dependency list", "cleanup"],
          sources: [
            {
              title: "React: You Might Not Need an Effect",
              url: "https://react.dev/learn/you-might-not-need-an-effect",
              kind: "documentation",
            },
          ],
        },
      ],
      questions: [
        {
          id: "w1d6-q1",
          kind: "explain",
          prompt:
            "Почему три вызова setCount(count + 1) в одном обработчике обычно дают +1?",
          referenceAnswer:
            "Каждый render получает snapshot state, и все три выражения читают одно значение count из текущего closure. React ставит три одинаковых замены в очередь. Чтобы связать обновления последовательно, нужно передать updater `value => value + 1`.",
          evaluationPoints: [
            "Назван snapshot",
            "Объяснена очередь обновлений",
            "Предложен functional updater",
          ],
          commonMistakes: [
            "Объяснять только асинхронностью setState",
            "Ожидать немедленной мутации count",
          ],
        },
        {
          id: "w1d6-q2",
          kind: "design-choice",
          prompt:
            "Когда вычисляемое значение не нужно хранить в state и обновлять effect-ом?",
          referenceAnswer:
            "Если значение полностью определяется props и state текущего render и вычисление чистое, его следует вычислить во время render (при реально дорогом вычислении — мемоизировать). Дублирующий state создаёт лишний render и риск рассинхронизации. Effect нужен для синхронизации с внешней системой.",
          evaluationPoints: [
            "Назван single source of truth",
            "Effect связан с внешней системой",
            "Memoization не используется автоматически",
          ],
          commonMistakes: [
            "Переносить любое вычисление в useEffect",
            "Применять useMemo ради корректности",
          ],
        },
      ],
      exercises: [
        {
          id: "w1d6-filterable-list",
          title: "Список без лишнего состояния",
          workspacePath: "workspaces/exercises/week-01/day-06/filterable-list",
          difficulty: "medium",
          estimatedMinutes: 65,
          brief:
            "Исправить компонент списка: убрать derived state/effect, сохранить selection и корректно обработать async refresh.",
          constraints: [
            "Не хранить filteredItems",
            "Не использовать index как key",
            "Не подавлять exhaustive-deps",
          ],
          topics: ["React", "state", "effects"],
          criteria: [
            {
              id: "derived",
              description:
                "Фильтрованный список вычисляется из единственного источника данных.",
            },
            {
              id: "selection",
              description:
                "Selection хранится стабильным id и корректно переживает фильтрацию.",
            },
            {
              id: "cleanup",
              description:
                "Асинхронная синхронизация не обновляет устаревший render.",
            },
          ],
          referenceApproach:
            "Оставить state только для query, selectedId и server data; filteredItems вычислять при render, а effect использовать исключительно для загрузки с cancellation/ignore cleanup.",
        },
      ],
      commonMistakes: [
        {
          id: "w1d6-m1",
          symptom: "Effect копирует props в state.",
          correction:
            "Сначала проверить, можно ли получить значение чисто во время render.",
        },
        {
          id: "w1d6-m2",
          symptom: "Dependency удалена для остановки повторных запусков.",
          correction:
            "Исправить нестабильную модель данных или границу effect, а не скрывать зависимость.",
        },
      ],
    },
    {
      id: "week-01-day-07",
      dayNumber: 7,
      slug: "integration-interview",
      title: "Интеграция и пробное интервью",
      summary:
        "Связать темы недели, решить задачу с нуля и зафиксировать конкретные пробелы.",
      estimatedMinutes: 195,
      goals: [
        "Дать пять ответов по 30–90 секунд",
        "Решить интеграционную задачу без готового каркаса",
        "Составить журнал ошибок и план повторения",
      ],
      topics: [
        {
          id: "weekly-retrieval",
          title: "Активное воспроизведение недели",
          prompts: [
            "scope и closure",
            "collections и complexity",
            "async ordering",
            "narrowing",
            "React render",
          ],
          sources: [],
        },
        {
          id: "interview-communication",
          title: "Структура технического ответа",
          prompts: ["определение", "механизм", "trade-off", "пример"],
          sources: [],
        },
      ],
      questions: [
        {
          id: "w1d7-q1",
          kind: "interview",
          prompt:
            "За 90 секунд свяжите closure, React render и stale callback на одном примере.",
          referenceAnswer:
            "Каждый React render создаёт новые bindings props/state и новые функции, замкнутые на этот snapshot. Callback, сохранённый внешней системой или вызванный позже, может читать snapshot старого render. Исправление зависит от намерения: корректные dependencies с cleanup, functional updater для обновления от прошлого значения либо ref для намеренно читаемого latest value.",
          evaluationPoints: [
            "Связаны closure и render",
            "Объяснён stale snapshot",
            "Решение выбирается по семантике",
          ],
          commonMistakes: [
            "Называть closure багом",
            "Всегда заменять state на ref",
          ],
        },
        {
          id: "w1d7-q2",
          kind: "interview",
          prompt:
            "Спроектируйте путь unknown API response → typed grouped view и назовите границы ответственности.",
          referenceAnswer:
            "На transport boundary ответ остаётся unknown. Schema/parser проверяет runtime-форму и возвращает доменный discriminated type или validation error. Чистая функция группирует валидные элементы через Map. UI получает уже typed view model и отвечает только за render и пользовательские события; ошибка границы отображается явно.",
          evaluationPoints: [
            "unknown остаётся на границе",
            "Runtime validation отделена",
            "Transformation чистая",
            "UI не валидирует ad hoc",
          ],
          commonMistakes: [
            "Доверять generic fetch<T>",
            "Смешивать parsing, grouping и render",
          ],
        },
      ],
      exercises: [
        {
          id: "w1d7-activity-feed",
          title: "Typed activity feed",
          workspacePath: "workspaces/exercises/week-01/day-07/activity-feed",
          difficulty: "hard",
          estimatedMinutes: 85,
          brief:
            "С нуля реализовать parser unknown-событий, группировку по дате и небольшой React view без derived state.",
          constraints: [
            "Не просить агента писать код",
            "Без any",
            "Parsing и presentation разделены",
            "Добавить минимум пять собственных тестов",
          ],
          topics: ["unknown", "collections", "functions", "React", "testing"],
          criteria: [
            {
              id: "boundary",
              description:
                "Недоверенные данные валидируются до доменной логики.",
            },
            {
              id: "grouping",
              description: "События группируются стабильно и без мутации.",
            },
            {
              id: "ui",
              description: "Компонент не дублирует вычисляемые данные в state.",
            },
            {
              id: "tests",
              description:
                "Тесты покрывают invalid input, duplicate dates и empty state.",
            },
          ],
          referenceApproach:
            "Разделить решение на parseActivity, groupActivities и ActivityFeed; тестировать первые две как чистые функции, UI строить из их готового результата.",
        },
      ],
      commonMistakes: [
        {
          id: "w1d7-m1",
          symptom: "Ответ содержит термины, но не причинную цепочку.",
          correction:
            "Строить ответ: определение → механизм → следствие → короткий пример.",
        },
        {
          id: "w1d7-m2",
          symptom: "Решение начинается до записи контрактов и edge cases.",
          correction:
            "Сначала выписать вход, выход, ошибки и 3–5 проверяемых примеров.",
        },
      ],
    },
  ],
} as const satisfies CurriculumWeek;

export const firstWeekCurriculum = weekOneCurriculum;
export const curriculum = [
  weekOneCurriculum,
] as const satisfies readonly CurriculumWeek[];

export function getCurriculumDay(dayId: string): CurriculumDay | undefined {
  return curriculum
    .flatMap((week) => week.days)
    .find((day) => day.id === dayId);
}

export function getCurriculumWeek(weekId: string): CurriculumWeek | undefined {
  return curriculum.find((week) => week.id === weekId);
}

export default curriculum;
