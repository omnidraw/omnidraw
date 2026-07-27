const RESOURCE_NAME_MAX_LENGTH = 120;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type TNormalizedResourceName = {
  name: string;
  key: string;
};

export type TNormalizeResourceNameResult =
  | { ok: true; value: TNormalizedResourceName }
  | { ok: false; code: 'RESOURCE_NAME_INVALID'; message: string };

export function fnResourceNameKey(name: string): string {
  return name.normalize('NFC').trim().toLowerCase();
}

export function fnNormalizeResourceName(name: unknown): TNormalizeResourceNameResult {
  if (typeof name !== 'string') {
    return { ok: false, code: 'RESOURCE_NAME_INVALID', message: 'Resource names must be strings.' };
  }
  const displayName = name.normalize('NFC').trim();
  if (displayName.length === 0) {
    return { ok: false, code: 'RESOURCE_NAME_INVALID', message: 'Resource names cannot be empty.' };
  }
  if (displayName.length > RESOURCE_NAME_MAX_LENGTH) {
    return {
      ok: false,
      code: 'RESOURCE_NAME_INVALID',
      message: `Resource names cannot exceed ${RESOURCE_NAME_MAX_LENGTH} characters.`,
    };
  }
  if (CONTROL_CHARACTER_PATTERN.test(displayName)) {
    return { ok: false, code: 'RESOURCE_NAME_INVALID', message: 'Resource names cannot contain control characters.' };
  }
  return {
    ok: true,
    value: {
      name: displayName,
      key: fnResourceNameKey(displayName),
    },
  };
}
