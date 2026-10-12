/**
 * Сравнение двух моделей разбора (R10.2).
 *
 * Чистые функции: ни стора, ни сервисов, ни сайд-эффектов.
 * Модели сопоставляются по id; при несовпадении id — эвристика по имени
 * (одинаковое имя считается изменённым правилом, а не удалённым + добавленным).
 * Поля внутри правила сопоставляются по имени.
 */
import type { Model, ModelField, ModelRule } from "@/src/types/domain";

export interface ModelRuleDiff {
  type: "added" | "removed" | "changed" | "unchanged";
  ruleId: string;
  ruleName: string;
  fieldsDiff?: ModelFieldDiff[];
  changes?: {
    condition?: { before: ModelRule["condition"]; after: ModelRule["condition"] };
    name?: { before: string; after: string };
  };
}

export interface ModelFieldDiff {
  type: "added" | "removed" | "changed" | "unchanged";
  name: string;
  changes?: {
    type?: { before: string; after: string };
    offset?: { before: number | "end-2"; after: number | "end-2" };
    length?: { before: number | "rest" | "rest-2"; after: number | "rest" | "rest-2" };
    note?: { before: string; after: string };
  };
}

export interface ModelDiffResult {
  rules: ModelRuleDiff[];
  summary: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
  };
}

/** Условие правила: JSON-сравнение достаточно для структур без функций. */
function conditionsEqual(
  a: ModelRule["condition"],
  b: ModelRule["condition"],
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** diffFields — сопоставление полей правила по имени. */
function diffFields(
  fieldsA: ModelField[],
  fieldsB: ModelField[],
): ModelFieldDiff[] {
  const mapB = new Map<string, ModelField>();
  for (const field of fieldsB) mapB.set(field.name, field);

  const result: ModelFieldDiff[] = fieldsA.map((field) => {
    const other = mapB.get(field.name);
    if (!other) return { type: "removed", name: field.name };

    const changes: ModelFieldDiff["changes"] = {};
    if (other.type !== field.type) {
      changes.type = { before: field.type, after: other.type };
    }
    if (other.offset !== field.offset) {
      changes.offset = { before: field.offset, after: other.offset };
    }
    if (other.length !== field.length) {
      changes.length = { before: field.length, after: other.length };
    }
    if (other.note !== field.note) {
      changes.note = { before: field.note ?? "", after: other.note ?? "" };
    }

    const hasChanges = Object.keys(changes).length > 0;
    return hasChanges
      ? { type: "changed", name: field.name, changes }
      : { type: "unchanged", name: field.name };
  });

  const namesA = new Set(fieldsA.map((field) => field.name));
  for (const field of fieldsB) {
    if (namesA.has(field.name)) continue;
    result.push({ type: "added", name: field.name });
  }

  return result;
}

/** Изменения самого правила (имя, условие) — сравнение с моделью A. */
function ruleChanges(
  ruleA: ModelRule,
  ruleB: ModelRule,
): ModelRuleDiff["changes"] | undefined {
  const changes: NonNullable<ModelRuleDiff["changes"]> = {};
  if (ruleA.name !== ruleB.name) {
    changes.name = { before: ruleA.name, after: ruleB.name };
  }
  if (!conditionsEqual(ruleA.condition, ruleB.condition)) {
    changes.condition = { before: ruleA.condition, after: ruleB.condition };
  }
  return Object.keys(changes).length > 0 ? changes : undefined;
}

/**
 * Сопоставление правил двух моделей: сначала по id, для непaired — по имени.
 * Возвращает пары (A, B | null) и добавленные (null, B) в порядке B.
 */
function pairRules(
  rulesA: ModelRule[],
  rulesB: ModelRule[],
): Array<{ a: ModelRule | null; b: ModelRule | null }> {
  const byIdB = new Map<string, ModelRule>();
  for (const rule of rulesB) byIdB.set(rule.id, rule);

  const byNameB = new Map<string, ModelRule>();
  for (const rule of rulesB) {
    if (!byNameB.has(rule.name)) byNameB.set(rule.name, rule);
  }

  const pairs: Array<{ a: ModelRule | null; b: ModelRule | null }> = [];
  const consumedB = new Set<string>();

  for (const ruleA of rulesA) {
    const byId = byIdB.get(ruleA.id);
    if (byId) {
      pairs.push({ a: ruleA, b: byId });
      consumedB.add(byId.id);
      continue;
    }
    // id не совпал — эвристика по имени (одинаковое имя = изменённое).
    const byName = byNameB.get(ruleA.name);
    if (byName && !consumedB.has(byName.id)) {
      pairs.push({ a: ruleA, b: byName });
      consumedB.add(byName.id);
      continue;
    }
    pairs.push({ a: ruleA, b: null });
  }

  for (const ruleB of rulesB) {
    if (consumedB.has(ruleB.id)) continue;
    pairs.push({ a: null, b: ruleB });
  }

  return pairs;
}

/**
 * Сравнение двух моделей: правила по id (эвристика по имени при расхождении),
 * поля — по имени. Результат — дерево изменений и сводка счётчиков.
 */
export function diffModels(a: Model, b: Model): ModelDiffResult {
  const pairs = pairRules(a.rules, b.rules);

  const rules: ModelRuleDiff[] = [];
  const summary = { added: 0, removed: 0, changed: 0, unchanged: 0 };

  for (const pair of pairs) {
    if (pair.a && pair.b) {
      const fieldsDiff = diffFields(pair.a.fields, pair.b.fields);
      const changed =
        !conditionsEqual(pair.a.condition, pair.b.condition) ||
        pair.a.name !== pair.b.name ||
        fieldsDiff.some((field) => field.type !== "unchanged");

      if (changed) summary.changed += 1;
      else summary.unchanged += 1;

      rules.push({
        type: changed ? "changed" : "unchanged",
        ruleId: pair.a.id,
        ruleName: pair.a.name,
        fieldsDiff,
        changes: ruleChanges(pair.a, pair.b),
      });
    } else if (pair.b) {
      summary.added += 1;
      rules.push({
        type: "added",
        ruleId: pair.b.id,
        ruleName: pair.b.name,
        fieldsDiff: pair.b.fields.map((field) => ({
          type: "added" as const,
          name: field.name,
        })),
      });
    } else if (pair.a) {
      summary.removed += 1;
      rules.push({
        type: "removed",
        ruleId: pair.a.id,
        ruleName: pair.a.name,
        fieldsDiff: pair.a.fields.map((field) => ({
          type: "removed" as const,
          name: field.name,
        })),
      });
    }
  }

  return { rules, summary };
}
