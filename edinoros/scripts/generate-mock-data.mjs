/**
 * Генератор мок-данных для «Лаборатории протоколов».
 *
 * Запуск:  node scripts/generate-mock-data.mjs
 *
 * Пишет src/mocks/{captures,sessions,messages,observations,actions}.json.
 * Данные детерминированные (сид фиксирован), чтобы пересборка давала тот же результат.
 *
 * Формат кадра — правдоподобный TLV-подобный обмен:
 *   AA 55 | opcode(1) | length(2 BE) | payload(length) | crc16(2 BE)
 * Это мок-слой и он удаляется вместе с остальными моками.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "src", "mocks");
mkdirSync(outDir, { recursive: true });

/* ── утилиты ─────────────────────────────────────────────────────────── */

function mulberry32(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function crc16modbus(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc & 0xffff;
}

const toHex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

const hex16 = (value) => `0x${value.toString(16).toUpperCase().padStart(4, "0")}`;
const hex8 = (value) => `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;

/* ── протокол ────────────────────────────────────────────────────────── */

const SYNC = [0xaa, 0x55];

const OPCODES = {
  0x01: { name: "GET_STATUS", reply: 0x81 },
  0x02: { name: "SET_PARAM", reply: 0x82 },
  0x03: { name: "READ_BLOCK", reply: 0x83 },
  0x04: { name: "WRITE_PARAM", reply: 0x84 },
  0x10: { name: "EVENT", reply: null },
  0x7f: { name: "NACK", reply: null },
};

function buildFrame(opcode, payload) {
  const body = [opcode, (payload.length >> 8) & 0xff, payload.length & 0xff, ...payload];
  const crc = crc16modbus(body);
  return {
    bytes: Uint8Array.from([...SYNC, ...body, (crc >> 8) & 0xff, crc & 0xff]),
    crc,
  };
}

/** Поля кадра: байтовые диапазоны, на которые будут ссылаться ReferenceChip. */
function frameFields(messageId, opcode, payloadLength, crc, kind, frameLength) {
  // Сообщение, не укладывающееся в модель: sync плюс неописанный хвост.
  if (kind === "raw") {
    return [
      {
        id: `${messageId}-f-sync`,
        name: "sync",
        type: "uint16be",
        value: "0xAA55",
        range: { offset: 0, length: 2 },
      },
      {
        id: `${messageId}-f-raw`,
        name: "raw",
        type: "bytes",
        value: `${frameLength - 2} Б`,
        range: { offset: 2, length: frameLength - 2 },
        note: "Хвост не описан моделью",
      },
    ];
  }

  const fields = [
    {
      id: `${messageId}-f-sync`,
      name: "sync",
      type: "uint16be",
      value: "0xAA55",
      range: { offset: 0, length: 2 },
    },
    {
      id: `${messageId}-f-opcode`,
      name: "opcode",
      type: "uint8",
      value: hex8(opcode),
      range: { offset: 2, length: 1 },
      ...(kind === "unknown" ? { note: "Значение не описано моделью" } : {}),
    },
    {
      id: `${messageId}-f-length`,
      name: "length",
      type: "uint16be",
      value: String(payloadLength),
      range: { offset: 3, length: 2 },
    },
  ];

  if (kind !== "error") {
    fields.push({
      id: `${messageId}-f-payload`,
      name: "payload",
      type: "bytes",
      value: `${payloadLength} Б`,
      range: { offset: 5, length: payloadLength },
    });
  }

  if (kind === "parsed") {
    fields.push({
      id: `${messageId}-f-crc`,
      name: "crc16",
      type: "uint16be",
      value: hex16(crc),
      range: { offset: 5 + payloadLength, length: 2 },
      note: "Контрольная сумма кадра",
    });
  }

  return fields;
}

/* ── конструирование сессий ──────────────────────────────────────────── */

const random = mulberry32(20260314);

const SESSION_DEFS = [
  {
    id: "sess-01",
    tuple: {
      source: { address: "192.168.10.42", port: 51044 },
      destination: { address: "192.168.10.7", port: 5000 },
    },
    startedAt: "2026-03-14T09:12:03.114Z",
    hostId: "lab-rig-3",
  },
  {
    id: "sess-02",
    tuple: {
      source: { address: "192.168.10.42", port: 51051 },
      destination: { address: "192.168.10.7", port: 5000 },
    },
    startedAt: "2026-03-14T09:31:47.002Z",
    hostId: "lab-rig-3",
  },
  {
    id: "sess-03",
    tuple: {
      source: { address: "192.168.10.11", port: 40222 },
      destination: { address: "192.168.10.7", port: 5000 },
    },
    startedAt: "2026-03-14T11:02:19.880Z",
    hostId: "bench-a",
  },
];

const messages = [];
let packetNumber = 1;
let byteOffset = 0;

function pushMessage({ session, opcode, payload, raw, direction, role, status, interpretation, label, verified, kind, timestamp }) {
  const frame = raw
    ? { bytes: Uint8Array.from(raw), crc: 0 }
    : buildFrame(opcode, payload);
  const { bytes, crc } = frame;
  const id = `msg-${String(packetNumber).padStart(4, "0")}`;

  const message = {
    id,
    sessionId: session.id,
    packetNumber,
    byteOffset,
    direction,
    role,
    length: bytes.length,
    status,
    label,
    timestamp,
    interpretation,
    verified,
    hex: toHex(bytes),
    fields: frameFields(
      id,
      opcode ?? 0,
      payload ? payload.length : 0,
      crc,
      kind,
      bytes.length,
    ),
  };

  messages.push(message);
  packetNumber += 1;
  byteOffset += bytes.length;
  return message;
}

/* ── журнал действий оператора (R4 «Проверка») ───────────────────────── */

const journal = [];
/** WRITE_PARAM-действия — чтобы в демо-примере подправить одно значение. */
const writeActions = [];

/**
 * Действие журнала привязывается к тому же кадру, что и цикл протокола:
 * журнал и сообщение — два взгляда на одно событие, отсюда настоящая связь
 * в checkModel, а не рисованная.
 */
function pushAction({ message, name, description, value }) {
  const action = {
    id: `act-${String(journal.length + 1).padStart(3, "0")}`,
    timestamp: message ? message.timestamp.slice(11, 19) : "09:10:00",
    name,
    description,
    value,
    expectedMessageId: message ? message.id : null,
  };
  journal.push(action);
  return action;
}

/** Запись в журнал операторского запроса (payload уже известен). */
function logOperatorAction(message, opcode, payload) {
  switch (opcode) {
    case 0x01:
      pushAction({ message, name: "GET_STATUS", description: "Прочитать статус", value: null });
      break;
    case 0x02: {
      // SET_PARAM: value = первые два байта payload BE (см. obs-002: 0x012C = 300).
      const value = (payload[0] << 8) | payload[1];
      pushAction({ message, name: "SET_PARAM", description: `Установить ${value}`, value });
      break;
    }
    case 0x03: {
      const address = (payload[0] << 8) | payload[1];
      pushAction({ message, name: "READ_BLOCK", description: `Прочитать блок ${hex16(address)}`, value: null });
      break;
    }
    case 0x04: {
      // WRITE_PARAM: [адрес, значение].
      const action = pushAction({
        message,
        name: "WRITE_PARAM",
        description: `Записать регистр ${payload[0]} = ${payload[1]}`,
        value: payload[1],
      });
      writeActions.push(action);
      break;
    }
  }
}

/** Основная сессия: 34 сообщения, включая все крайние случаи §11. */
function buildMainSession() {
  const session = SESSION_DEFS[0];
  const base = new Date(session.startedAt).getTime();
  let clock = 0;
  const stamp = () => {
    clock += Math.round(40 + random() * 260);
    return new Date(base + clock).toISOString();
  };

  const cycles = [
    { opcode: 0x01, payload: [] },
    { opcode: 0x02, payload: [0x01, 0x2c, 0x00, 0x00] },
    { opcode: 0x03, payload: [0x00, 0x10, 0x00, 0x20] },
    { opcode: 0x04, payload: [0x07, 0x0a] },
    { opcode: 0x01, payload: [] },
    { opcode: 0x03, payload: [0x02, 0x00, 0x00, 0x40] },
    { opcode: 0x02, payload: [0x03, 0x64, 0x00, 0x01] },
    { opcode: 0x01, payload: [] },
    { opcode: 0x04, payload: [0x05, 0x1e] },
    { opcode: 0x03, payload: [0x04, 0x00, 0x00, 0x18] },
  ];

  const created = [];

  for (const cycle of cycles) {
    const spec = OPCODES[cycle.opcode];

    const request = pushMessage({
      session,
      opcode: cycle.opcode,
      payload: cycle.payload,
      direction: "request",
      role: "REQ",
      status: "parsed",
      interpretation: "parsed",
      label: spec.name,
      verified: true,
      kind: "parsed",
      timestamp: stamp(),
    });
    created.push(request);
    logOperatorAction(request, cycle.opcode, cycle.payload);

    const replyPayload =
      cycle.opcode === 0x01
        ? [0x00, 0x0e, 0x4a, 0x11, 0x02, 0x00]
        : [0x00, 0x00];

    created.push(
      pushMessage({
        session,
        opcode: spec.reply,
        payload: replyPayload,
        direction: "response",
        role: "RSP",
        status: "parsed",
        interpretation: "parsed",
        label: `${spec.name} · ответ`,
        verified: true,
        kind: "parsed",
        timestamp: stamp(),
      }),
    );

    if (random() > 0.55) {
      created.push(
        pushMessage({
          session,
          opcode: 0x10,
          payload: [0x21, 0x00, 0x03, 0x00],
          direction: "response",
          role: "NOTIFY",
          status: "parsed",
          interpretation: "partial",
          label: "EVENT · перегрев",
          verified: false,
          kind: "parsed",
          timestamp: stamp(),
        }),
      );
    }
  }

  // Крайний случай: минимальный корректный кадр — 7 байт (sync + opcode + length + crc).
  created.push(
    pushMessage({
      session,
      opcode: 0x7f,
      payload: [],
      direction: "response",
      role: "RSP",
      status: "parsed",
      interpretation: "parsed",
      label: "NACK",
      verified: true,
      kind: "parsed",
      timestamp: stamp(),
    }),
  );

  // Крайний случай: сообщение минимальной длины — 4 байта, вне модели разбора.
  created.push(
    pushMessage({
      session,
      raw: [0xaa, 0x55, 0x00, 0x00],
      direction: "response",
      role: "NOTIFY",
      status: "unknown",
      interpretation: "not-parsed",
      label: "Маркер · 4 Б",
      verified: false,
      kind: "raw",
      timestamp: stamp(),
    }),
  );

  // Крайний случай: статус «неизвестно» — опкод вне модели разбора.
  created.push(
    pushMessage({
      session,
      opcode: 0x3c,
      payload: [0x00, 0x01, 0x9a, 0x33, 0x71],
      direction: "response",
      role: "RSP",
      status: "unknown",
      interpretation: "not-parsed",
      label: "Неизвестный опкод",
      verified: false,
      kind: "unknown",
      timestamp: stamp(),
    }),
  );

  // Крайний случай: статус «ошибка» — кадр оборван, контрольная сумма не сходится.
  created.push(
    pushMessage({
      session,
      opcode: 0x83,
      payload: [0x00, 0xff],
      direction: "response",
      role: "RSP",
      status: "error",
      interpretation: "not-parsed",
      label: "Ошибка разбора",
      verified: false,
      kind: "error",
      timestamp: stamp(),
    }),
  );

  // Крайний случай: максимальная длина — около 4 КиБ payload.
  const bulk = Uint8Array.from({ length: 4096 }, () => Math.floor(random() * 256));
  created.push(
    pushMessage({
      session,
      opcode: 0x83,
      payload: Array.from(bulk),
      direction: "response",
      role: "RSP",
      status: "parsed",
      interpretation: "parsed",
      label: "READ_BLOCK · 4 КиБ",
      verified: false,
      kind: "parsed",
      timestamp: stamp(),
    }),
  );

  return created;
}

/** Сессия с одним сообщением (§11). */
function buildSingleMessageSession() {
  const session = SESSION_DEFS[1];
  return [
    pushMessage({
      session,
      opcode: 0x01,
      payload: [],
      direction: "request",
      role: "REQ",
      status: "parsed",
      interpretation: "parsed",
      label: "GET_STATUS",
      verified: true,
      kind: "parsed",
      timestamp: "2026-03-14T09:31:47.309Z",
    }),
  ];
}

/** Сессия с сотнями сообщений — для проверки виртуализации (§11). */
function buildBulkSession() {
  const session = SESSION_DEFS[2];
  const base = new Date(session.startedAt).getTime();
  const created = [];

  for (let index = 0; index < 300; index += 1) {
    const isRequest = index % 2 === 0;
    const opcode = isRequest ? 0x03 : 0x83;
    const payload = isRequest
      ? [0x00, (index >> 8) & 0xff, index & 0xff, 0x10]
      : Array.from({ length: 16 }, () => Math.floor(random() * 256));

    created.push(
      pushMessage({
        session,
        opcode,
        payload,
        direction: isRequest ? "request" : "response",
        role: isRequest ? "REQ" : "RSP",
        status: index % 97 === 0 ? "unknown" : "parsed",
        interpretation: index % 97 === 0 ? "not-parsed" : "parsed",
        label: isRequest ? `READ_BLOCK · 0x${(index >> 8).toString(16).padStart(2, "0")}${(index & 0xff).toString(16).padStart(2, "0")}` : "READ_BLOCK · данные",
        verified: index % 97 !== 0,
        kind: index % 97 === 0 ? "unknown" : "parsed",
        timestamp: new Date(base + index * 37).toISOString(),
      }),
    );
  }

  return created;
}

const mainSession = buildMainSession();
buildSingleMessageSession();
buildBulkSession();

/* ── журнал: демонстрационные состояния «Проверки» (R4) ──────────────── */

// ❌ Расхождение: в кадре значение 30 (0x1E), в журнале оператор записал 31.
if (writeActions[1]) writeActions[1].value = 31;

// ❓ Действие, чьё сообщение модель не разобрала — статус «не проверено».
const unknownMessage = messages.find((m) => m.label === "Неизвестный опкод");
if (unknownMessage) {
  pushAction({ message: unknownMessage, name: "GET_MEASURE", description: "Получить измерение", value: 74 });
}

// ❓ Ручная запись в журнале без связанного кадра.
pushAction({ message: null, name: "REBOOT", description: "Перезагрузка стенда", value: null });

/* ── наблюдения ──────────────────────────────────────────────────────── */

const withBigMessage = messages.find((m) => m.length > 4000);
const withUnknown = messages.find((m) => m.status === "unknown");
const withError = messages.find((m) => m.status === "error");
const notifyMessage = messages.find((m) => m.role === "NOTIFY");

const observations = [
  {
    id: "obs-001",
    messageId: messages[0].id,
    kind: "comment",
    text: "Первый кадр сессии всегда GET_STATUS без payload — похоже на handshake.",
    createdAt: "2026-03-14T12:04:11.000Z",
  },
  {
    id: "obs-002",
    messageId: mainSession[5].id,
    kind: "range",
    text: "Здесь значение параметра: 0x012C = 300, совпадает с уставкой на стенде.",
    range: { offset: 5, length: 4 },
    createdAt: "2026-03-14T12:09:38.000Z",
  },
  // Крайний случай §11: наблюдение без комментария.
  {
    id: "obs-003",
    messageId: mainSession[9].id,
    kind: "range",
    range: { offset: 3, length: 2 },
    createdAt: "2026-03-14T12:15:02.000Z",
  },
  {
    id: "obs-004",
    messageId: notifyMessage.id,
    kind: "hypothesis",
    text: "Гипотеза: старший байт payload — код события, остальные — аргументы.",
    hypothesis: "unchecked",
    createdAt: "2026-03-14T12:22:45.000Z",
  },
  {
    id: "obs-005",
    messageId: withUnknown.id,
    kind: "comment",
    text: "Опкод 0x3C не описан моделью. Встречается только после перезагрузки устройства.",
    createdAt: "2026-03-14T12:31:07.000Z",
  },
  {
    id: "obs-006",
    messageId: withError.id,
    kind: "comment",
    text: "Кадр оборван: length обещает 0xFFFF байт, в потоке их нет.",
    createdAt: "2026-03-14T12:33:52.000Z",
  },
  {
    id: "obs-007",
    messageId: withBigMessage.id,
    kind: "hypothesis",
    text: "Гипотеза: блок 4 КиБ — это дамп памяти, а не ответ на чтение регистров.",
    hypothesis: "refuted",
    createdAt: "2026-03-14T12:41:19.000Z",
  },
];

/* ── сессии и записи ─────────────────────────────────────────────────── */

const sessions = SESSION_DEFS.map((definition) => ({
  id: definition.id,
  captureId: "cap-01",
  tuple: definition.tuple,
  messageCount: messages.filter((m) => m.sessionId === definition.id).length,
  startedAt: definition.startedAt,
}));

const captures = [
  {
    id: "cap-01",
    fileName: "bench-2026-03-14.pcapng",
    importedAt: "2026-03-14T12:00:00.000Z",
    sizeBytes: byteOffset + 4096,
    sessionCount: sessions.length,
  },
];

/* ── запись ──────────────────────────────────────────────────────────── */

const files = [
  ["captures.json", captures, true],
  ["sessions.json", sessions, true],
  ["observations.json", observations, true],
  ["actions.json", journal, true],
  // messages.json — самый крупный; пишем компактно, иначе файл раздувается вчетверо.
  ["messages.json", messages, false],
];

for (const [name, data, pretty] of files) {
  const path = join(outDir, name);
  const body = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  writeFileSync(path, `${body}\n`, "utf8");
  console.log(`${name}: ${data.length} записей, ${(body.length / 1024).toFixed(0)} КБ`);
}

console.log(`\nВсего сообщений: ${messages.length}`);
for (const session of sessions) {
  console.log(`  ${session.id}: ${session.messageCount} сообщений`);
}
