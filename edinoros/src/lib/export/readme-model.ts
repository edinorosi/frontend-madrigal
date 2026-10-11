/**
 * README-model.md — документация «как применить JSON модели к другим данным»
 * (R6.3). Скачивается вместе с экспортом модели.
 *
 * Пример кода внутри — читаемая эталонная реализация алгоритма, не импорт
 * из приложения: внешний инженер не имеет доступа к исходникам.
 */
import { MODEL_STATUS_LABEL } from "@/src/lib/model-status";
import type { Model, ModelField } from "@/src/types/domain";

function formatOffset(offset: ModelField["offset"]): string {
  return offset === "end-2" ? '"end-2"' : String(offset);
}

function formatLength(length: ModelField["length"]): string {
  return length === "rest" || length === "rest-2" ? `"${length}"` : String(length);
}

/**
 * Полный текст README-model.md для модели.
 * `modelFileName` — имя JSON-файла модели, на который ссылается документ.
 */
export function buildModelReadme(model: Model, modelFileName: string): string {
  const generatedAt = new Date().toISOString();

  const ruleSections = model.rules
    .map((rule, index) => {
      const condition =
        Object.keys(rule.condition).length === 0
          ? "всегда (fallback)"
          : describeCondition(rule.condition);
      const fields = rule.fields
        .map(
          (field) =>
            `- \`${field.name}\` — ${field.type}, offset ${formatOffset(field.offset)}, length ${formatLength(field.length)}${field.note ? ` — ${field.note}` : ""}`,
        )
        .join("\n");
      return `### Правило ${index + 1}: ${rule.name}\n\nУсловие: ${condition}\n\nПоля:\n\n${fields || "(нет полей)"}`;
    })
    .join("\n\n");

  return `# Модель разбора «${model.name}»

Документ описывает формат JSON-модели и способ применить её к байтам
сообщений из другой записи. Статус модели на момент выгрузки:
**${MODEL_STATUS_LABEL[model.status]}**.

Файл модели: \`${modelFileName}\`.
Сгенерировано: ${generatedAt}.

## Формат JSON модели

\`\`\`json
{
  "schemaVersion": 1,
  "metadata": { "exportedAt": "...", "author": null },
  "model": {
    "id": "…",
    "name": "${model.name}",
    "status": "${model.status}",
    "createdAt": "…",
    "rules": [
      {
        "id": "…",
        "name": "Название правила",
        "condition": { "opcodes": [2, 4] },
        "fields": [
          { "name": "opcode", "type": "uint8", "offset": 2, "length": 1 }
        ]
      }
    ]
  },
  "source": { "captureName": "…" }
}
\`\`\`

Описание полей:

| Поле | Тип | Смысл |
| --- | --- | --- |
| \`schemaVersion\` | число | Версия схемы. Текущая — \`1\`. |
| \`metadata.exportedAt\` | строка | Когда модель выгружена, ISO 8601. |
| \`metadata.author\` | строка или null | Автор; null — автор неизвестен. |
| \`model.id\` | строка | Идентификатор внутри приложения. При импорте заменяется. |
| \`model.name\` | строка | Название модели. |
| \`model.status\` | строка | \`draft\` / \`checked\` / \`stale\`. |
| \`model.createdAt\` | строка | Когда модель создана, ISO 8601. |
| \`model.rules[]\` | массив | Правила разбора, проверяются по порядку. |
| \`rules[].condition\` | объект | Условие срабатывания; пустой \`{}\ \` — всегда. |
| \`rules[].condition.opcode\` | число | Опкод равен (байт смещения 2). |
| \`rules[].condition.opcodes\` | массив чисел | Опкод в списке. |
| \`rules[].condition.lengthEquals\` | число | Поле length кадра равно (u16be по смещению 3). |
| \`rules[].condition.maxMessageLength\` | число | Сообщение не длиннее N байт. |
| \`rules[].fields[]\` | массив | Поля, которые правило извлекает. |
| \`fields[].offset\` | число или \`"end-2"\` | Смещение от начала сообщения; \`"end-2"\` — предпоследние 2 байта. |
| \`fields[].length\` | число, \`"rest"\` или \`"rest-2"\` | Длина поля; \`"rest"\` — до конца, \`"rest-2"\` — до конца минус 2 байта. |
| \`source.captureName\` | строка или null | Имя PCAP-записи, на которой модель исследовалась. |

Все условия правила выполняются одновременно (И). Побеждает первое
подошедшее правило; поля остальных не учитываются.

## Как применить к другим данным

Алгоритм:

1. Взять байты одного сообщения (массив \`Uint8Array\`).
2. Пройти по \`rules\` по порядку.
3. Для каждого правила проверить условие: \`opcode\` — байт смещения 2,
   \`length\` — u16be по смещению 3. Условия AND-ятся; пустое условие
   подходит всегда.
4. Применить первое подошедшее правило: для каждого поля вычислить
   \`offset\` и \`length\` (учитывая \`"end-2"\`, \`"rest"\`, \`"rest-2"\`),
   взять срез байт и представить по типу поля.
5. Результат — список полей с именем, типом, значением и диапазоном
   байтов. Если ни одно правило не подошло — сообщение не разобрано.

## Пример кода (TypeScript)

\`\`\`typescript
type Field = {
  name: string;
  type: string;
  offset: number | "end-2";
  length: number | "rest" | "rest-2";
};

type Rule = {
  condition: {
    opcode?: number;
    opcodes?: number[];
    lengthEquals?: number;
    maxMessageLength?: number;
  };
  fields: Field[];
};

type Model = { rules: Rule[] };

type ParsedField = {
  name: string;
  type: string;
  offset: number;
  length: number;
  value: string;
};

function readOpcode(bytes: Uint8Array): number | null {
  return bytes.length > 2 ? bytes[2] : null;
}

function readLengthField(bytes: Uint8Array): number | null {
  return bytes.length > 4 ? (bytes[3] << 8) | bytes[4] : null;
}

function ruleMatches(bytes: Uint8Array, rule: Rule): boolean {
  const c = rule.condition;
  if (c.maxMessageLength !== undefined && bytes.length > c.maxMessageLength) {
    return false;
  }
  if (c.opcode !== undefined || c.opcodes !== undefined) {
    const opcode = readOpcode(bytes);
    if (opcode === null) return false;
    if (c.opcode !== undefined && opcode !== c.opcode) return false;
    if (c.opcodes !== undefined && !c.opcodes.includes(opcode)) return false;
  }
  if (c.lengthEquals !== undefined) {
    const length = readLengthField(bytes);
    if (length === null || length !== c.lengthEquals) return false;
  }
  return true;
}

function resolveOffset(offset: Field["offset"], total: number): number {
  return offset === "end-2" ? total - 2 : offset;
}

function resolveLength(
  length: Field["length"],
  offset: number,
  total: number,
): number {
  if (length === "rest") return total - offset;
  if (length === "rest-2") return total - offset - 2;
  return length;
}

function formatValue(
  bytes: Uint8Array,
  offset: number,
  length: number,
  type: string,
): string {
  const slice = bytes.subarray(offset, offset + length);
  switch (type) {
    case "uint8":
      return slice.length >= 1 ? "0x" + slice[0].toString(16).toUpperCase() : "—";
    case "uint16be": {
      if (slice.length < 2) return "—";
      const v = (slice[0] << 8) | slice[1];
      return "0x" + v.toString(16).toUpperCase().padStart(4, "0");
    }
    case "uint32be": {
      if (slice.length < 4) return "—";
      const v = ((slice[0] << 24) | (slice[1] << 16) | (slice[2] << 8) | slice[3]) >>> 0;
      return "0x" + v.toString(16).toUpperCase().padStart(8, "0");
    }
    case "string": {
      let out = "";
      for (const byte of slice) {
        out += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : "·";
      }
      return out;
    }
    default:
      return length + " Б";
  }
}

/** Применить модель к одному сообщению. null — ни одно правило не подошло. */
function applyModel(bytes: Uint8Array, model: Model): ParsedField[] | null {
  const rule = model.rules.find((item) => ruleMatches(bytes, item));
  if (!rule) return null;

  const fields: ParsedField[] = [];
  for (const field of rule.fields) {
    const offset = resolveOffset(field.offset, bytes.length);
    const length = resolveLength(field.length, offset, bytes.length);
    if (offset < 0 || length < 0 || offset + length > bytes.length) continue;
    fields.push({
      name: field.name,
      type: field.type,
      offset,
      length,
      value: formatValue(bytes, offset, length, field.type),
    });
  }
  return fields;
}
\`\`\`

## Ограничения

Модель описывает структуру сообщений внутри уже выделенных байтов. Она:

- **не читает PCAP/PCAPNG** и не восстанавливает TCP-поток — байты
  сообщений должен выделить другой инструмент (например, Wireshark
  или бэкенд «Лаборатории протоколов»);
- **не интерпретирует значения** — только извлекает поля по смещениям;
  смысл опкодов и полей остаётся за исследователем;
- **не проверяет целостность** — контрольная сумма кадра моделью
  не вычисляется и не сверяется;
- **не переносит поля между сообщениями** — каждое сообщение разбирается
  независимо, состояние между сообщениями не накапливается.

## Список правил текущей модели

${ruleSections || "(в модели нет правил)"}
`;
}

function describeCondition(condition: {
  opcode?: number;
  opcodes?: number[];
  lengthEquals?: number;
  maxMessageLength?: number;
}): string {
  const parts: string[] = [];
  if (condition.opcode !== undefined) {
    parts.push(`opcode = 0x${condition.opcode.toString(16).toUpperCase()}`);
  }
  if (condition.opcodes !== undefined) {
    parts.push(
      `opcodes = [${condition.opcodes.map((item) => `0x${item.toString(16).toUpperCase()}`).join(", ")}]`,
    );
  }
  if (condition.lengthEquals !== undefined) {
    parts.push(`length = ${condition.lengthEquals}`);
  }
  if (condition.maxMessageLength !== undefined) {
    parts.push(`длина ≤ ${condition.maxMessageLength} Б`);
  }
  return parts.length > 0 ? parts.join(", ") : "всегда";
}
