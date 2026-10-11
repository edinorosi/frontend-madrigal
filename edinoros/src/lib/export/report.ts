/**
 * Читаемый отчёт об исследовании (R6.2) — генерация Markdown из снимка
 * данных. Чистые функции: ни стора, ни сервисов, ни скачиваний.
 *
 * Снимок (ExportData) собирает стор — см. collectExportData в store/app.ts.
 */
import { describeRange } from "@/src/lib/hex";
import { MODEL_STATUS_LABEL } from "@/src/lib/model-status";
import {
  OBSERVATION_STATUS_LABEL,
  resolveObservationStatus,
} from "@/src/lib/observations";
import type {
  Capture,
  CheckResult,
  Message,
  Model,
  Observation,
  ObservationKind,
} from "@/src/types/domain";

/** Снимок данных для экспорта отчёта и проекта. */
export interface ExportData {
  generatedAt: string;
  capture: Capture | null;
  /** Активная модель; null — не выбрана. */
  model: Model | null;
  models: Model[];
  sessionsCount: number;
  messages: Message[];
  /** Статус применения модели к каждому сообщению; null — модели нет. */
  applyByMessage: Map<string, "parsed" | "partial" | "not-parsed"> | null;
  /** Гистограмма опкодов (байт смещения 2) по сообщениям; null — без байтов. */
  opcodes: Map<number, number> | null;
  observations: Observation[];
  checkResult: CheckResult | null;
}

/** Сколько строк перечислять в таблицах, прежде чем оставить счётчик. */
const ROW_LIMIT = 200;
/** Сколько пакетов перечислять в списке неразобранных. */
const PACKET_LIMIT = 30;

const KIND_LABEL: Record<ObservationKind, string> = {
  comment: "комментарий",
  range: "диапазон",
  hypothesis: "гипотеза",
  field: "поле",
};

export function buildReportMarkdown(data: ExportData): string {
  const messagesById = new Map(data.messages.map((item) => [item.id, item]));

  const sections = [
    reportHeader(data),
    sectionOverview(data),
    sectionModel(data),
    sectionVerified(data, messagesById),
    sectionDiscrepancies(data, messagesById),
    sectionObservations(data, messagesById),
    sectionCoverage(data),
    sectionOpenQuestions(data, messagesById),
    sectionHowToApply(data),
  ];

  return `${sections.filter((part) => part.length > 0).join("\n\n")}\n`;
}

/* ── Шапка ────────────────────────────────────────────────────────────── */

function reportHeader(data: ExportData): string {
  const lines = [
    "# Отчёт об исследовании протокола",
    "",
    `- Дата генерации: ${data.generatedAt}`,
    `- Запись: ${data.capture ? `\`${data.capture.fileName}\`` : "не загружена"}`,
  ];

  if (data.model) {
    lines.push(
      `- Модель: \`${data.model.name}\` — ${MODEL_STATUS_LABEL[data.model.status]}`,
    );
  } else {
    lines.push("- Модель: не выбрана");
  }

  return lines.join("\n");
}

/* ── 1. Обзор ─────────────────────────────────────────────────────────── */

function sectionOverview(data: ExportData): string {
  const lines = ["## 1. Обзор", ""];

  lines.push(`- Сессий: ${data.sessionsCount}`);
  lines.push(`- Сообщений: ${data.messages.length}`);

  if (data.applyByMessage) {
    const counts = { parsed: 0, partial: 0, "not-parsed": 0 };
    for (const status of data.applyByMessage.values()) counts[status] += 1;
    lines.push(
      `- Разбор моделью: разобрано ${counts.parsed}, частично ${counts.partial}, не разобрано ${counts["not-parsed"]}`,
    );
  } else {
    lines.push("- Разбор моделью: не выполнялся (модель не выбрана)");
  }

  if (data.checkResult) {
    const { summary } = data.checkResult;
    lines.push(
      `- Проверка: совпало ${summary.ok}, частично ${summary.partial}, не проверено ${summary.unknown}, расхождений ${summary.error} (всего ${summary.total})`,
    );
  } else {
    lines.push("- Проверка: не запускалась");
  }

  lines.push(`- Наблюдений: ${data.observations.length}`);

  return lines.join("\n");
}

/* ── 2. Модель разбора ────────────────────────────────────────────────── */

function sectionModel(data: ExportData): string {
  const model = data.model;
  if (!model) {
    return ["## 2. Модель разбора", "", "Модель не выбрана.", ""].join("\n");
  }

  const lines = ["## 2. Модель разбора", ""];

  if (model.rules.length === 0) {
    lines.push("В модели нет правил.");
  }

  model.rules.forEach((rule, index) => {
    lines.push(`### ${index + 1}. ${rule.name}`);
    lines.push("");
    lines.push(`Условие: ${describeCondition(rule.condition)}`);
    lines.push("");
    if (rule.fields.length === 0) {
      lines.push("Полей нет.");
    } else {
      lines.push("| Поле | Тип | Смещение | Длина | Примечание |");
      lines.push("| --- | --- | --- | --- | --- |");
      for (const field of rule.fields) {
        lines.push(
          `| \`${field.name}\` | ${field.type} | ${formatOffset(field.offset)} | ${formatLength(field.length)} | ${field.note ?? "—"} |`,
        );
      }
    }
    lines.push("");
  });

  return lines.join("\n").trimEnd();
}

function describeCondition(condition: Model["rules"][number]["condition"]): string {
  const parts: string[] = [];
  if (condition.opcode !== undefined) {
    parts.push(`opcode = ${formatOpcode(condition.opcode)}`);
  }
  if (condition.opcodes !== undefined) {
    parts.push(`opcodes = [${condition.opcodes.map(formatOpcode).join(", ")}]`);
  }
  if (condition.lengthEquals !== undefined) {
    parts.push(`length = ${condition.lengthEquals}`);
  }
  if (condition.maxMessageLength !== undefined) {
    parts.push(`длина ≤ ${condition.maxMessageLength} Б`);
  }
  return parts.length > 0 ? parts.join(", ") : "всегда (безусловное)";
}

function formatOpcode(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
}

function formatOffset(offset: number | "end-2"): string {
  return offset === "end-2" ? "end-2" : String(offset);
}

function formatLength(length: number | "rest" | "rest-2"): string {
  return typeof length === "number" ? String(length) : length;
}

/* ── 3. Проверенные примеры ───────────────────────────────────────────── */

function sectionVerified(
  data: ExportData,
  messagesById: Map<string, Message>,
): string {
  const rows = (data.checkResult?.rows ?? []).filter(
    (row) => row.status === "ok",
  );
  const lines = ["## 3. Проверенные примеры", ""];

  if (rows.length === 0) {
    lines.push("Проверенных примеров нет.");
    return lines.join("\n");
  }

  lines.push(`Строк журнала со статусом «совпало»: ${rows.length}.`);
  lines.push("");
  lines.push("| Время | Действие | Ожидалось | Извлечено | Сообщение |");
  lines.push("| --- | --- | --- | --- | --- |");

  for (const row of rows.slice(0, ROW_LIMIT)) {
    const message = row.messageId ? messagesById.get(row.messageId) : undefined;
    lines.push(
      `| ${row.time} | ${mdCell(row.action)} | ${row.expected ?? "—"} | ${mdCell(row.extracted)} | ${message ? messageRef(message) : "—"} |`,
    );
  }
  if (rows.length > ROW_LIMIT) {
    lines.push("");
    lines.push(`… и ещё ${rows.length - ROW_LIMIT} строк.`);
  }

  return lines.join("\n");
}

/* ── 4. Расхождения ───────────────────────────────────────────────────── */

function sectionDiscrepancies(
  data: ExportData,
  messagesById: Map<string, Message>,
): string {
  const rows = (data.checkResult?.rows ?? []).filter(
    (row) => row.status === "error",
  );
  const lines = ["## 4. Расхождения", ""];

  if (rows.length === 0) {
    lines.push("Расхождений не обнаружено.");
    return lines.join("\n");
  }

  lines.push(
    "Строки журнала, где извлечённое значение не совпало с ожидаемым.",
  );
  lines.push("");

  for (const row of rows.slice(0, ROW_LIMIT)) {
    const message = row.messageId ? messagesById.get(row.messageId) : undefined;
    lines.push(
      `- **${row.time} — ${mdCell(row.action)}**: ожидалось \`${row.expected ?? "—"}\`, извлечено \`${mdCell(row.extracted)}\`. Сообщение: ${message ? messageRef(message) : "привязки нет"}. Расхождение значений: модель прочитала из байт число, не равное ожиданию журнала.`,
    );
  }
  if (rows.length > ROW_LIMIT) {
    lines.push("");
    lines.push(`… и ещё ${rows.length - ROW_LIMIT} расхождений.`);
  }

  return lines.join("\n");
}

/* ── 5. Наблюдения ────────────────────────────────────────────────────── */

function sectionObservations(
  data: ExportData,
  messagesById: Map<string, Message>,
): string {
  const lines = ["## 5. Наблюдения", ""];

  if (data.observations.length === 0) {
    lines.push("Наблюдений нет.");
    return lines.join("\n");
  }

  const kindCounts: Record<ObservationKind, number> = {
    comment: 0,
    range: 0,
    hypothesis: 0,
    field: 0,
  };
  for (const observation of data.observations) {
    kindCounts[observation.kind] += 1;
  }
  lines.push(
    `Всего: ${data.observations.length} (комментариев ${kindCounts.comment}, диапазонов ${kindCounts.range}, полей ${kindCounts.field}, гипотез ${kindCounts.hypothesis}).`,
  );
  lines.push("");

  const hypotheses = data.observations.filter(
    (item) => item.kind === "hypothesis",
  );
  if (hypotheses.length > 0) {
    lines.push("### Гипотезы");
    lines.push("");
    const groups: Array<[string, Observation[]]> = [
      ["Подтверждены", []],
      ["Опровергнуты", []],
      ["Не проверены", []],
    ];
    for (const hypothesis of hypotheses) {
      const status = resolveObservationStatus(hypothesis);
      if (status === "confirmed") groups[0][1].push(hypothesis);
      else if (status === "refuted") groups[1][1].push(hypothesis);
      else groups[2][1].push(hypothesis);
    }
    for (const [title, items] of groups) {
      lines.push(`${title} (${items.length}):`);
      if (items.length === 0) {
        lines.push("- нет");
      }
      for (const item of items) {
        lines.push(`- ${observationRef(item, messagesById)}${observationText(item)}`);
      }
      lines.push("");
    }
  }

  const others = data.observations.filter((item) => item.kind !== "hypothesis");
  if (others.length > 0) {
    lines.push("### Прочие наблюдения");
    lines.push("");
    for (const item of others) {
      lines.push(
        `- ${observationRef(item, messagesById)}${KIND_LABEL[item.kind]}, ${OBSERVATION_STATUS_LABEL[resolveObservationStatus(item)]}${observationText(item)}`,
      );
    }
  }

  return lines.join("\n").trimEnd();
}

function observationRef(
  observation: Observation,
  messagesById: Map<string, Message>,
): string {
  const message = messagesById.get(observation.messageId);
  const where = message
    ? `пакет №${message.packetNumber}`
    : `сообщение \`${observation.messageId}\``;
  const range = observation.range ? `, ${describeRange(observation.range)}` : "";
  return `**${where}**${range} — `;
}

function observationText(observation: Observation): string {
  const parts: string[] = [];
  if (observation.kind === "field" && observation.name) {
    parts.push(
      `поле \`${observation.name}\`${observation.type ? ` (${observation.type})` : ""}`,
    );
  }
  if (observation.text) {
    parts.push(`«${observation.text}»`);
  }
  return parts.length > 0 ? `: ${parts.join(", ")}` : "";
}

/* ── 6. Область применимости ──────────────────────────────────────────── */

function sectionCoverage(data: ExportData): string {
  const lines = ["## 6. Область применимости", ""];
  const model = data.model;

  if (!model) {
    lines.push("Модель не выбрана — область применимости не определена.");
    return lines.join("\n");
  }

  // Опкоды, на которые ссылаются условия правил.
  const covered = new Set<number>();
  let hasFallback = false;
  for (const rule of model.rules) {
    if (
      rule.condition.opcode === undefined &&
      rule.condition.opcodes === undefined &&
      rule.condition.lengthEquals === undefined &&
      rule.condition.maxMessageLength === undefined
    ) {
      hasFallback = true;
    }
    if (rule.condition.opcode !== undefined) covered.add(rule.condition.opcode);
    for (const opcode of rule.condition.opcodes ?? []) covered.add(opcode);
  }

  if (hasFallback) {
    lines.push(
      "Модель содержит безусловное правило — любое сообщение будет разобрано (возможно, частично).",
    );
  }
  if (covered.size > 0) {
    const list = [...covered].sort((a, b) => a - b).map(formatOpcode);
    lines.push(`Опкоды, покрытые правилами: ${list.join(", ")}.`);
  } else if (!hasFallback) {
    lines.push("Правила не задают условия по опкоду — покрытие опкодов не определено.");
  }

  // Опкоды, встреченные в записи, но не покрытые условиями.
  if (data.opcodes && !hasFallback && covered.size > 0) {
    const uncovered = [...data.opcodes.entries()]
      .filter(([opcode]) => !covered.has(opcode))
      .sort((a, b) => b[1] - a[1]);
    if (uncovered.length === 0) {
      lines.push("Все опкоды, встреченные в записи, покрыты правилами.");
    } else {
      const list = uncovered
        .slice(0, PACKET_LIMIT)
        .map(([opcode, count]) => `${formatOpcode(opcode)} (${count})`);
      lines.push(
        `Опкоды в записи, не покрытые правилами: ${list.join(", ")}${uncovered.length > PACKET_LIMIT ? ` и ещё ${uncovered.length - PACKET_LIMIT}` : ""}.`,
      );
    }
  }

  if (data.applyByMessage) {
    const partial: Message[] = [];
    const missing: Message[] = [];
    for (const message of data.messages) {
      const status = data.applyByMessage.get(message.id);
      if (status === "partial") partial.push(message);
      else if (status === "not-parsed") missing.push(message);
    }

    lines.push("");
    if (partial.length === 0 && missing.length === 0) {
      lines.push("Все сообщения записи разобраны моделью полностью.");
    } else {
      lines.push(
        `Частично разобрано: ${partial.length}. Не разобрано: ${missing.length}.`,
      );
      if (partial.length > 0) {
        lines.push("");
        lines.push(`Частично (пакеты): ${packetList(partial)}.`);
      }
      if (missing.length > 0) {
        lines.push("");
        lines.push(`Не разобраны (пакеты): ${packetList(missing)}.`);
      }
    }
  }

  lines.push("");
  lines.push(
    "Модель описывает структуру сообщений внутри уже выделенных байтов. Чтение PCAP и восстановление потока к ней не относятся.",
  );

  return lines.join("\n");
}

function packetList(messages: Message[]): string {
  const numbers = messages.map((item) => `№${item.packetNumber}`);
  if (numbers.length <= PACKET_LIMIT) return numbers.join(", ");
  return `${numbers.slice(0, PACKET_LIMIT).join(", ")} и ещё ${numbers.length - PACKET_LIMIT}`;
}

/* ── 7. Открытые вопросы ──────────────────────────────────────────────── */

function sectionOpenQuestions(
  data: ExportData,
  messagesById: Map<string, Message>,
): string {
  const open = data.observations.filter(
    (item) => resolveObservationStatus(item) === "draft",
  );
  const lines = ["## 7. Открытые вопросы", ""];

  if (open.length === 0) {
    lines.push("Открытых вопросов нет.");
    return lines.join("\n");
  }

  lines.push(
    "Наблюдения, остающиеся черновиками: комментарии без решения и гипотезы без проверки.",
  );
  lines.push("");
  for (const item of open) {
    lines.push(
      `- ${observationRef(item, messagesById)}${KIND_LABEL[item.kind]} со статусом «черновик»${observationText(item)}`,
    );
  }

  return lines.join("\n");
}

/* ── 8. Способ применения ─────────────────────────────────────────────── */

function sectionHowToApply(data: ExportData): string {
  const model = data.model;
  const base = model ? safeBaseName(model.name) : "model";
  const lines = ["## 8. Способ применения", ""];

  lines.push(
    `Модель выгружается в файл \`${base}.json\` (схема version 1). Вместе с ней скачивается \`${base}-README.md\`: описание формата JSON, полный алгоритм разбора и эталонный пример кода на TypeScript.`,
  );
  lines.push("");
  lines.push("Алгоритм применения модели к другим данным:");
  lines.push("");
  lines.push("1. Получить байты одного сообщения.");
  lines.push("2. Пройти по правилам модели по порядку.");
  lines.push(
    "3. Применить первое правило, чьи условия выполнены (условия AND, пустое условие подходит всегда).",
  );
  lines.push(
    "4. Для каждого поля вычислить offset и length (с учётом «end-2», «rest», «rest-2»), взять срез байт и оформить значение по типу поля.",
  );
  lines.push(
    "5. Результат — список полей с именем, типом, значением и диапазоном байтов. Если ни одно правило не подошло — сообщение не разобрано.",
  );
  lines.push("");
  lines.push(
    "Ограничения: модель не читает PCAP/PCAPNG и не восстанавливает TCP-поток — байты сообщений должен выделить другой инструмент. Модель не вычисляет контрольную сумму и не интерпретирует значения полей.",
  );

  return lines.join("\n");
}

function safeBaseName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, "-").trim();
  return cleaned.length > 0 ? cleaned : "model";
}

/* ── Помощники ────────────────────────────────────────────────────────── */

/** Ссылка на сообщение: пакет, смещение в потоке, длина. */
function messageRef(message: Message): string {
  const offset = `0x${message.byteOffset.toString(16).toUpperCase().padStart(8, "0")}`;
  return `пакет №${message.packetNumber}, смещение ${offset}, ${message.length} Б`;
}

/** Экранирование ячейки Markdown-таблицы. */
function mdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
