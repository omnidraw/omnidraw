const CliUpdateErr = {
  VERSION_COMPARE_INVALID_INPUT: 'FN.CLI_UPDATE.VERSION_COMPARE.INVALID_INPUT',
} as const satisfies Record<string, TErrorCode>;

type TArgs = {
  currentVersion: string;
  latestVersion: string;
};

type TDecision = {
  shouldUpgrade: boolean;
};

function normalize(version: string): string {
  return version.trim().replace(/^v/i, '');
}

function tokenize(version: string): (number | string)[] {
  return normalize(version)
    .split(/[.+-]/g)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()));
}

function cmpPart(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return 1;
  if (typeof b === 'number') return -1;
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

function compareVersion(a: string, b: string): number {
  const aa = tokenize(a);
  const bb = tokenize(b);
  const length = Math.max(aa.length, bb.length);

  for (let i = 0; i < length; i += 1) {
    const left = aa[i] ?? 0;
    const right = bb[i] ?? 0;
    const cmp = cmpPart(left, right);
    if (cmp !== 0) return cmp;
  }

  return 0;
}

export function fnCliUpdateShouldUpgrade(args: TArgs): TErrTuple<TDecision> {
  if (!args.currentVersion || !args.latestVersion) {
    return [
      null,
      {
        code: CliUpdateErr.VERSION_COMPARE_INVALID_INPUT,
        statusCode: 400,
        externalMessage: { en: 'Version values are required' },
      },
    ];
  }

  return [{ shouldUpgrade: compareVersion(args.latestVersion, args.currentVersion) > 0 }, null];
}

export type { TArgs, TDecision };
