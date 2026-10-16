/**
 * Готовые скрипты для диалога «Скрипты» (п.3).
 * Выполняются сервером: POST /api/v1/scripts/run.
 * Контекст — env LAB_CONTEXT (JSON-файл):
 * {capture_id, messages: [{id, byteOffset, length, status, direction}],
 *  bytes_file}. Печатай в stdout — он вернётся в диалог.
 */
export interface ScriptPreset {
  id: string;
  name: string;
  code: string;
}

export const SCRIPT_PRESETS: ScriptPreset[] = [
  {
    id: "hello",
    name: "Привет: что в контексте",
    code: [
      "import json, os",
      "",
      "with open(os.environ['LAB_CONTEXT'], encoding='utf-8') as f:",
      "    ctx = json.load(f)",
      "",
      "print('capture:', ctx.get('capture_id'))",
      "print('сообщений:', len(ctx.get('messages', [])))",
      "print('байты:', ctx.get('bytes_file'))",
      "",
      "lengths = {}",
      "for m in ctx.get('messages', []):",
      "    lengths[m['length']] = lengths.get(m['length'], 0) + 1",
      "print('длины:', dict(sorted(lengths.items())))",
      "",
    ].join("\n"),
  },
  {
    id: "find-opcode",
    name: "Найти сообщения с кодом",
    code: [
      "import json, os",
      "",
      "OPCODE = 0x01  # поменяй под свой кадр",
      "",
      "with open(os.environ['LAB_CONTEXT'], encoding='utf-8') as f:",
      "    ctx = json.load(f)",
      "with open(ctx['bytes_file'], 'rb') as f:",
      "    stream = f.read()",
      "",
      "hits = []",
      "for m in ctx.get('messages', []):",
      "    chunk = stream[m['byteOffset']:m['byteOffset'] + m['length']]",
      "    if len(chunk) > 2 and chunk[2] == OPCODE:",
      "        hits.append(m['id'][:8])",
      "",
      "print(f'код {OPCODE:#04x}: {len(hits)} сообщений')",
      "for h in hits[:20]:",
      "    print(' ', h)",
      "",
    ].join("\n"),
  },
  {
    id: "lengths",
    name: "Статистика длин",
    code: [
      "import json, os",
      "",
      "with open(os.environ['LAB_CONTEXT'], encoding='utf-8') as f:",
      "    ctx = json.load(f)",
      "",
      "messages = ctx.get('messages', [])",
      "if not messages:",
      "    print('сообщений нет (открой запись с импортированным pcap)')",
      "else:",
      "    total = sum(m['length'] for m in messages)",
      "    print(f'сообщений: {len(messages)}, байт: {total}')",
      "    print(f'мин: {min(m[\"length\"] for m in messages)}, '",
      "          f'макс: {max(m[\"length\"] for m in messages)}')",
      "",
    ].join("\n"),
  },
];
