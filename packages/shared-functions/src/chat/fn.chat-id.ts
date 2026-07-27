export type TChatIdClassification =
  | { kind: 'dated'; sessionId: string; date: string; createdAt: string }
  | { kind: 'legacy'; sessionId: string };

export type TChatStorageSegments = TChatIdClassification & {
  chat: string[];
  history: string[];
  workspace: string[];
  metadata: string[];
};

const DATED_CHAT_ID_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z--([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const FORMATTED_CHAT_ID_PREFIX_PATTERN = /^\d{4}-\d{2}-\d{2}T/;
const WINDOWS_RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

function fnAssertLegacyChatId(sessionId: string): void {
  if (sessionId.length === 0 || sessionId.length > 200 || sessionId !== sessionId.trim()) {
    throw new Error('Chat ID must contain between 1 and 200 unchanged characters.');
  }
  if (
    sessionId === '.'
    || sessionId === '..'
    || /[\/\\<>:"|?*\u0000-\u001f\u007f]/.test(sessionId)
    || /[. ]$/.test(sessionId)
  ) {
    throw new Error('Chat ID is not a safe cross-platform filesystem segment.');
  }
  const reservedStem = sessionId.split('.', 1)[0]?.toLocaleLowerCase('en-US') ?? '';
  if (WINDOWS_RESERVED_NAMES.has(reservedStem)) {
    throw new Error(`Chat ID '${sessionId}' is reserved by the filesystem.`);
  }
}

function fnIsValidUtcParts(date: string, hour: string, minute: string, second: string): boolean {
  const year = +date.slice(0, 4);
  const month = +date.slice(5, 7);
  const day = +date.slice(8, 10);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1
    && month <= 12
    && day >= 1
    && day <= (days[month - 1] ?? 0)
    && +hour <= 23
    && +minute <= 59
    && +second <= 59;
}

export function fnClassifyChatId(sessionId: string): TChatIdClassification {
  const match = DATED_CHAT_ID_PATTERN.exec(sessionId);
  if (match) {
    const [, date, hour, minute, second, millisecond] = match;
    const createdAt = `${date}T${hour}:${minute}:${second}.${millisecond}Z`;
    if (!fnIsValidUtcParts(date!, hour!, minute!, second!)) {
      throw new Error('Formatted chat ID contains an invalid UTC calendar timestamp.');
    }
    return { kind: 'dated', sessionId, date: date!, createdAt };
  }
  if (FORMATTED_CHAT_ID_PREFIX_PATTERN.test(sessionId)) {
    throw new Error('Formatted chat ID has an invalid timestamp or UUID.');
  }
  fnAssertLegacyChatId(sessionId);
  return { kind: 'legacy', sessionId };
}

export function fnCreateChatId(args: { now: Date; uuid: string }): string {
  const iso = args.now.toISOString();
  const timestamp = iso.replace(/:/g, '-').replace('.', '-');
  const sessionId = `${timestamp}--${args.uuid.toLocaleLowerCase('en-US')}`;
  const classified = fnClassifyChatId(sessionId);
  if (classified.kind !== 'dated') throw new Error('Generated chat ID is not dated.');
  return sessionId;
}

export function fnChatStorageSegments(sessionId: string): TChatStorageSegments {
  const classified = fnClassifyChatId(sessionId);
  const chat = classified.kind === 'dated'
    ? ['chats', classified.date, sessionId]
    : ['chats', 'legacy', sessionId];
  return {
    ...classified,
    chat,
    history: [...chat, 'history'],
    workspace: [...chat, 'workspace'],
    metadata: [...chat, 'chat.json'],
  };
}
