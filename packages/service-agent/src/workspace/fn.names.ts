export type TWidgetNameResult =
  | { ok: true; value: string; caseKey: string }
  | { ok: false; message: string };

const RESERVED_WINDOWS_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

export function fnNormalizeWidgetName(input: string): TWidgetNameResult {
  const value = input.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (value.length === 0) return { ok: false, message: 'Widget name must not be empty.' };
  if (value.length > 120) return { ok: false, message: 'Widget name must be at most 120 characters.' };
  if (value === '.' || value === '..') return { ok: false, message: 'Widget name must not be . or ...' };
  if (/[\/\\]/.test(value)) return { ok: false, message: 'Widget name must not contain path separators.' };
  if (/[\u0000-\u001f\u007f]/.test(value)) return { ok: false, message: 'Widget name must not contain control characters.' };
  if (/[<>:"|?*]/.test(value)) return { ok: false, message: 'Widget name contains filesystem-reserved characters.' };
  if (/[. ]$/.test(value)) return { ok: false, message: 'Widget name must not end with a period or space.' };

  const reservedStem = value.split('.', 1)[0]?.toLocaleLowerCase('en-US') ?? '';
  if (RESERVED_WINDOWS_NAMES.has(reservedStem)) {
    return { ok: false, message: `Widget name '${value}' is reserved by the filesystem.` };
  }

  return { ok: true, value, caseKey: value.toLocaleLowerCase('en-US') };
}

export function fnAssertSafeChatId(input: string): string {
  const value = input.trim();
  if (value.length === 0 || value.length > 200) throw new Error('Chat ID must contain between 1 and 200 characters.');
  if (value === '.' || value === '..' || /[\/\\\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('Chat ID is not a safe filesystem segment.');
  }
  return value;
}

export function fnIsCaseCollision(left: string, right: string): boolean {
  return left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US') && left !== right;
}
