import { foundationWeekV2, publishedCurriculumV2 } from "./version-2.js";
import type {
  CurriculumUnitType,
  VersionedCurriculumDay,
  VersionedCurriculumQuestion,
  VersionedCurriculumVersion,
  VersionedCurriculumWeek,
} from "./versioned-types.js";

interface QuizQuestionRevision {
  readonly options: readonly [string, string, string];
  readonly correctOption: 0 | 1 | 2;
}

interface DayExecutionRevision {
  readonly quiz: Readonly<Record<string, QuizQuestionRevision>>;
  readonly codeSnippet: string;
  readonly codePrompt: string;
}

const dayOneQuizAnswerKey: Readonly<Record<string, readonly string[]>> = {
  "w1d1-quiz-q1": ["q1-b"],
  "w1d1-quiz-q2": ["q2-b"],
  "w1d1-quiz-q3": ["q3-b"],
  "w1d1-quiz-q4": ["q4-b"],
};

const dayExecutionRevisions: Readonly<Record<number, DayExecutionRevision>> = {
  1: {
    quiz: {},
    codeSnippet: `const original = {
  profile: { name: "Ada" },
  tags: ["js", "js"],
};
const next = { ...original };

next.profile.name = "Grace";
console.log(original.profile.name, next.profile.name);`,
    codePrompt:
      "Предскажите обе строки вывода, объясните общую вложенную ссылку и предложите immutable fix.",
  },
  2: {
    quiz: {
      "w1d2-quiz-q1": {
        options: [
          "Только блок if",
          "Ближайшая функция или global scope",
          "Только текущий модуль",
        ],
        correctOption: 1,
      },
      "w1d2-quiz-q2": {
        options: [
          "Declaration и expression одинаково доступны до объявления",
          "Declaration инициализирована функцией, expression следует правилам своего binding",
          "Expression всегда доступна раньше declaration",
        ],
        correctOption: 1,
      },
      "w1d2-quiz-q3": {
        options: [
          "Callback — способ хранения lexical environment",
          "Callback — роль функции, а closure описывает доступ к внешним bindings",
          "Closure возможен только у callback-функций",
        ],
        correctOption: 1,
      },
      "w1d2-quiz-q4": {
        options: [
          "bind немедленно вызывает функцию, а call создаёт новую",
          "bind создаёт новую функцию, а call вызывает исходную немедленно",
          "bind и call отличаются только синтаксисом аргументов",
        ],
        correctOption: 1,
      },
    },
    codeSnippet: `function createCounter() {
  let value = 0;
  return () => ++value;
}

const next = createCounter();
const meter = {
  offset: 10,
  read() {
    return next() + this.offset;
  },
};
const detachedRead = meter.read;

console.log(meter.read());
console.log(detachedRead());`,
    codePrompt:
      "Предскажите первый вывод и результат второго вызова; объясните closure, call-site this и verbal fix для detached method.",
  },
  3: {
    quiz: {
      "w1d3-quiz-q1": {
        options: ["fulfilled", "pending", "rejected"],
        correctOption: 1,
      },
      "w1d3-quiz-q2": {
        options: [
          "Да, любой rejection автоматически становится throw",
          "Нет, если Promise не await-ится и не возвращается в перехватываемую цепочку",
          "Да, но только в браузере",
        ],
        correctOption: 1,
      },
      "w1d3-quiz-q3": {
        options: [
          "Когда операции независимы и не ограничены общим ресурсом",
          "Когда следующей операции нужен результат предыдущей",
          "Когда обе операции возвращают Promise",
        ],
        correctOption: 1,
      },
      "w1d3-quiz-q4": {
        options: [
          "Выполнить callback немедленно и оставить старый timer",
          "Сбросить прежний timer и запланировать новый с актуальными аргументами",
          "Добавить ещё один timer, чтобы не потерять вызов",
        ],
        correctOption: 1,
      },
    },
    codeSnippet: `console.log("A");

setTimeout(() => console.log("B"), 0);
Promise.resolve().then(() => {
  console.log("C");
  queueMicrotask(() => console.log("D"));
});
queueMicrotask(() => console.log("E"));

console.log("F");`,
    codePrompt:
      "Запишите точный порядок console.log и объясните его через run-to-completion, microtasks и следующую task.",
  },
  4: {
    quiz: {
      "w1d4-quiz-q1": {
        options: [
          "Да, TypeScript вставит runtime-проверку полей",
          "Нет, assertion меняет только статическое представление значения",
          "Да, если interface экспортирован",
        ],
        correctOption: 1,
      },
      "w1d4-quiz-q2": {
        options: [
          "Tuple описывает только readonly-массивы",
          "Tuple задаёт типы позиций и обычно длину, array — повторяемый тип элементов",
          "Array хранит разные типы, а tuple — только один",
        ],
        correctOption: 1,
      },
      "w1d4-quiz-q3": {
        options: [
          "Для фиксированного набора строковых ключей, известного на этапе компиляции",
          "Для runtime-коллекции с ключами не только string/symbol и явным iteration API",
          "Когда объект должен сериализоваться в JSON без преобразования",
        ],
        correctOption: 1,
      },
      "w1d4-quiz-q4": {
        options: [
          "Удаляет свойства T во время выполнения",
          "Создаёт тип, где свойства T optional, не меняя runtime-объект",
          "Заменяет тип каждого свойства T на undefined",
        ],
        correctOption: 1,
      },
    },
    codeSnippet: `type Action =
  | { type: "increment"; amount: number }
  | { type: "reset" };

function reduce(state: number, action: Action): number {
  switch (action.type) {
    case "increment":
      return state + action.amount;
    default:
      return state;
  }
}`,
    codePrompt:
      "Что вернёт reducer для reset, какой дефект проявится после добавления нового action и как сделать switch исчерпывающим?",
  },
  5: {
    quiz: {
      "w1d5-quiz-q1": {
        options: [
          "Да, каждый render обязан изменить DOM",
          "Нет, render может состояться, а commit не изменит одинаковый DOM",
          "Нет, React никогда не render-ит детей вместе с родителем",
        ],
        correctOption: 1,
      },
      "w1d5-quiz-q2": {
        options: [
          "Да, случайный key гарантирует уникальность",
          "Нет, новый key на каждом render приводит к потере identity и remount",
          "Да, если список содержит меньше десяти элементов",
        ],
        correctOption: 1,
      },
      "w1d5-quiz-q3": {
        options: [
          "Всегда копировать в отдельный state через Effect",
          "Обычно вычислять во время render из исходных props/state",
          "Хранить в ref, чтобы результат не менялся",
        ],
        correctOption: 1,
      },
      "w1d5-quiz-q4": {
        options: [
          "Controlled input хранит source of truth только в DOM",
          "Controlled получает value из React state/props, uncontrolled хранит текущее значение в DOM",
          "Uncontrolled input нельзя прочитать из React",
        ],
        correctOption: 1,
      },
    },
    codeSnippet: `import { useState } from "react";

export function Counter() {
  const [count, setCount] = useState(0);

  function incrementThreeTimes() {
    setCount(count + 1);
    setCount(count + 1);
    setCount(count + 1);
  }

  return <button onClick={incrementThreeTimes}>{count}</button>;
}`,
    codePrompt:
      "Предскажите значение после одного клика, объясните snapshot и batching, затем предложите functional update для результата +3.",
  },
  6: {
    quiz: {
      "w1d6-quiz-q1": {
        options: [
          "Только при unmount",
          "Перед повторным setup после изменения dependencies и при unmount",
          "После каждого render, даже если Effect не запускается",
        ],
        correctOption: 1,
      },
      "w1d6-quiz-q2": {
        options: [
          "Всегда, потому что current меняется между renders",
          "Обычно нет: current не реактивен и его изменение не запускает render",
          "Только если ref указывает на DOM-элемент",
        ],
        correctOption: 1,
      },
      "w1d6-quiz-q3": {
        options: [
          "Только имя endpoint",
          "Все сериализуемые параметры, определяющие identity результата queryFn",
          "Текущее значение data из cache",
        ],
        correctOption: 1,
      },
      "w1d6-quiz-q4": {
        options: [
          "Всегда перезагрузить всю страницу",
          "Обновить cache напрямую или invalidate релевантные queries по контракту",
          "Очистить весь query cache независимо от mutation",
        ],
        correctOption: 1,
      },
    },
    codeSnippet: `import { useEffect, useState } from "react";

export function Timer() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    setInterval(() => setSeconds(seconds + 1), 1000);
  }, []);

  return <output>{seconds}</output>;
}`,
    codePrompt:
      "Найдите stale closure и утечку timer, предскажите поведение в Strict Mode и предложите Effect с корректным cleanup.",
  },
  7: {
    quiz: {
      "w1d7-quiz-q1": {
        options: [
          "interface, потому что он описывает поля объекта",
          "Runtime parser или type guard; interface исчезает после компиляции",
          "Generic type parameter, если передать ему unknown",
        ],
        correctOption: 1,
      },
      "w1d7-quiz-q2": {
        options: [
          "setTimeout, потому что его callback зарегистрирован runtime",
          "Promise.then после текущего stack, но до следующей timeout task",
          "Порядок не определён стандартом",
        ],
        correctOption: 1,
      },
      "w1d7-quiz-q3": {
        options: [
          "Позицию элемента в текущем массиве",
          "Доменную identity component instance между renders",
          "Порядок DOM-узлов после сортировки",
        ],
        correctOption: 1,
      },
      "w1d7-quiz-q4": {
        options: [
          "Да, любой новый массив обязан создаваться в Effect",
          "Нет, filteredItems — pure derived value из props/state",
          "Да, иначе React не заметит изменение filter",
        ],
        correctOption: 1,
      },
    },
    codeSnippet: `import { useEffect, useState } from "react";

type Activity = { id: string; title: string };

async function loadDashboard() {
  const users = await fetch("/api/users").then((response) => response.json());
  const projects = await fetch("/api/projects").then((response) =>
    response.json(),
  );
  return { users, projects };
}

export function ActivityList({ input }: { input: unknown }) {
  const activities = input as Activity[];
  const [selected, setSelected] = useState(activities[0]?.id);

  useEffect(() => {
    const timer = setInterval(() => console.log(selected), 1000);
    return () => clearInterval(timer);
  }, []);

  activities.sort((a, b) => a.title.localeCompare(b.title));
  return activities.map((item, index) => <div key={index}>{item.title}</div>);
}`,
    codePrompt:
      "Найдите unsafe assertion, mutation, index key, stale Effect и лишнюю последовательность независимых fetch; расставьте fixes по риску.",
  },
};

const optionSuffixes = ["a", "b", "c"] as const;

const revisedUnitMinutes: Readonly<Record<CurriculumUnitType, number>> = {
  briefing: 6,
  study: 15,
  recall: 15,
  "teacher-dialogue": 12,
  quiz: 10,
  "code-reading": 12,
  exercise: 45,
  review: 12,
  interview: 20,
  summary: 8,
  checkpoint: 5,
  "spaced-review": 10,
};

function getRevisedUnitMinutes(
  dayNumber: number,
  unitType: CurriculumUnitType,
): number {
  // Day 1 has four unusually dense study units. A focused 12-minute pass for
  // each keeps the complete first session realistic without dropping a unit.
  return dayNumber === 1 && unitType === "study"
    ? 12
    : revisedUnitMinutes[unitType];
}

function reviseQuizQuestion(
  question: VersionedCurriculumQuestion,
  revision: QuizQuestionRevision,
): VersionedCurriculumQuestion {
  // Rotate authored choices by question number so the answer position cannot
  // become a shortcut while labels and generated IDs remain deterministic.
  const questionNumber = Number(question.stableId.at(-1));
  const rotation = Number.isInteger(questionNumber) ? questionNumber % 3 : 0;
  const labels = [
    ...revision.options.slice(rotation),
    ...revision.options.slice(0, rotation),
  ];
  const correctLabel = revision.options[revision.correctOption];
  const options = labels.map((label, index) => ({
    stableId: `${question.stableId}-${optionSuffixes[index]}`,
    label,
  }));
  const correctOption = options.find((option) => option.label === correctLabel);
  if (correctOption === undefined) {
    throw new Error(`Invalid quiz answer key: ${question.stableId}`);
  }

  return {
    ...question,
    kind: "multiple-choice",
    options,
    protectedEvaluation: {
      ...question.protectedEvaluation,
      correctOptionStableIds: [correctOption.stableId],
    },
  };
}

const foundationWeekRevision2 = {
  ...foundationWeekV2,
  days: foundationWeekV2.days.map((day) =>
    day.stableId !== "w1d1-values-types-objects"
      ? day
      : {
          ...day,
          units: day.units.map((unit) =>
            unit.stableId !== "w1d1-u08-quiz"
              ? unit
              : {
                  ...unit,
                  questions: unit.questions.map((question) => ({
                    ...question,
                    protectedEvaluation: {
                      ...question.protectedEvaluation,
                      correctOptionStableIds:
                        dayOneQuizAnswerKey[question.stableId] ?? [],
                    },
                  })),
                },
          ),
        },
  ),
} satisfies VersionedCurriculumWeek;

/**
 * Revision 2 adds only the Day 1 server-side answer key. This object mirrors
 * the original published graph and hash and must never be rewritten.
 */
export const publishedCurriculumRevision2 = {
  ...publishedCurriculumV2,
  id: "curriculum-foundation-v2-r2",
  revision: 2,
  parentVersionId: publishedCurriculumV2.id,
  contentHash:
    "920a36a5484ba88f01477a28a281fcc781935ef4124ef8ace7b689536d543427",
  createdAt: "2026-08-01T00:00:00.000Z",
  publishedAt: "2026-08-01T00:00:00.000Z",
  weeks: [foundationWeekRevision2],
} satisfies VersionedCurriculumVersion;

const foundationWeekExecutable = {
  ...foundationWeekRevision2,
  days: foundationWeekRevision2.days.map((day) => {
    const revision = dayExecutionRevisions[day.dayNumber];
    if (revision === undefined) return day;

    const units = day.units.map((unit) => {
      if (unit.type === "quiz") {
        return {
          ...unit,
          questions: unit.questions.map((question) => {
            const quizRevision = revision.quiz[question.stableId];
            if (quizRevision !== undefined) {
              return reviseQuizQuestion(question, quizRevision);
            }

            const existingAnswerKey = dayOneQuizAnswerKey[question.stableId];
            if (existingAnswerKey !== undefined) {
              return {
                ...question,
                protectedEvaluation: {
                  ...question.protectedEvaluation,
                  correctOptionStableIds: existingAnswerKey,
                },
              };
            }

            throw new Error(`Missing quiz revision: ${question.stableId}`);
          }),
        };
      }

      if (unit.type === "code-reading") {
        return {
          ...unit,
          codeSnippet: revision.codeSnippet,
          questions: unit.questions.map((question, index) =>
            index === 0
              ? { ...question, prompt: revision.codePrompt }
              : question,
          ),
        };
      }

      return unit;
    });

    return {
      ...day,
      units,
    };
  }),
} satisfies VersionedCurriculumWeek;

const foundationWeekRevision3 = {
  ...foundationWeekExecutable,
  days: foundationWeekExecutable.days.map((day) => {
    const units = day.units.map((unit) => ({
      ...unit,
      estimatedMinutes: getRevisedUnitMinutes(day.dayNumber, unit.type),
    }));

    return {
      ...day,
      estimatedMinutes: units.reduce(
        (total, unit) => total + unit.estimatedMinutes,
        0,
      ),
      units,
    };
  }),
} satisfies VersionedCurriculumWeek;

/** Revision 3 normalizes authored unit estimates to an honest three-hour day. */
export const publishedCurriculumV3 = {
  ...publishedCurriculumRevision2,
  id: "curriculum-foundation-v2-r3",
  revision: 3,
  parentVersionId: publishedCurriculumRevision2.id,
  contentHash:
    "7ee9586b13cd47d693d2d1ac354fa1c5c36651e580c375c382898784cd663262",
  createdAt: "2026-08-01T01:00:00.000Z",
  publishedAt: "2026-08-01T01:00:00.000Z",
  weeks: [foundationWeekRevision3],
} satisfies VersionedCurriculumVersion;

const foundationWeekRevision4 = {
  ...foundationWeekRevision3,
  days: foundationWeekRevision3.days.map((day) => {
    if (day.dayNumber !== 1) return day;
    return {
      ...day,
      units: day.units.map((unit) => {
        if (unit.stableId !== "w1d1-u01-briefing") return unit;
        return {
          ...unit,
          checklist: [
            "Прочитать «Результат дня» — цели занятия",
            "Просмотреть «Вне занятия» — что сегодня не разбираем",
            "Открыть Zed и подготовить папку для практики",
          ],
        };
      }),
    };
  }),
} satisfies VersionedCurriculumWeek;

/** Revision 4 rewrites the Day 1 briefing checklist in plain Russian and shows real out-of-scope items. */
export const activeCurriculumVersion = {
  ...publishedCurriculumV3,
  id: "curriculum-foundation-v2-r4",
  revision: 4,
  parentVersionId: publishedCurriculumV3.id,
  contentHash:
    "6a230c78c2ce16a4145e1fa8397d521fc3a85414710e639b9ab82ff28132fa8d",
  createdAt: "2026-08-02T00:00:00.000Z",
  publishedAt: "2026-08-02T00:00:00.000Z",
  weeks: [foundationWeekRevision4],
} satisfies VersionedCurriculumVersion;

export function getVersionedCurriculumDay(
  stableId: string,
): VersionedCurriculumDay | undefined {
  return activeCurriculumVersion.weeks
    .flatMap((week) => week.days)
    .find((day) => day.stableId === stableId);
}
