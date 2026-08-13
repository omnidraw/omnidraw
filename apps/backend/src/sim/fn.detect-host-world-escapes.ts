export type THostWorldEscape = Readonly<{
  capability:
    | 'wall-clock'
    | 'entropy'
    | 'network'
    | 'filesystem'
    | 'os-process'
    | 'timer'
    | 'microtask'
    | 'native-promise'
    | 'default-effect-runtime';
  line: number;
  excerpt: string;
}>;

const FORBIDDEN_HOST_PATTERNS: readonly Readonly<{
  capability: THostWorldEscape['capability'];
  pattern: RegExp;
}>[] = Object.freeze([
  {
    capability: 'wall-clock',
    pattern: new RegExp(String.raw`\b(?:Da${'te'}\.n${'ow'}\s*\(|new\s+Da${'te'}\s*\(|performance\.n${'ow'}\s*\()`),
  },
  {
    capability: 'entropy',
    pattern: new RegExp(String.raw`\b(?:Ma${'th'}\.ran${'dom'}\s*\(|crypto\.(?:randomUUID|getRandomValues)\s*\()|['"]node:crypto['"]`),
  },
  {
    capability: 'network',
    pattern: new RegExp(String.raw`\b(?:fet${'ch'}\s*\(|new\s+WebSoc${'ket'}\s*\()|['"]node:(?:http|https|net|tls|dgram)['"]`),
  },
  {
    capability: 'filesystem',
    pattern: new RegExp(String.raw`['"]node:fs(?:/promises)?['"]|\bBun\.file\s*\(`),
  },
  {
    capability: 'os-process',
    pattern: new RegExp(String.raw`\bprocess\.(?:env|cwd|exit|kill|on|once)\b|['"]node:child_process['"]`),
  },
  {
    capability: 'timer',
    pattern: new RegExp(String.raw`\b(?:setTime${'out'}|setInter${'val'}|setImmediate)\s*\(`),
  },
  {
    capability: 'microtask',
    pattern: new RegExp(String.raw`\bqueueMicro${'task'}\s*\(|\bprocess\.nextTick\s*\(`),
  },
  {
    capability: 'native-promise',
    pattern: new RegExp(String.raw`\bnew\s+Promise\b|\bPromise\.(?:all|race|resolve|reject|any)\s*\(|\basync\s+(?:function|\(|[A-Za-z_$])`),
  },
  {
    capability: 'default-effect-runtime',
    pattern: new RegExp(String.raw`\bEffect\.r${'un'}(?:Promise|Sync|Fork)\b`),
  },
]);

/** Pure source audit used by conformance to keep simulation adapters off ambient host APIs. */
export function fnDetectHostWorldEscapes(source: string): readonly THostWorldEscape[] {
  const issues: THostWorldEscape[] = [];
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    const code = line.replace(/\/\/.*$/u, '');
    for (const forbidden of FORBIDDEN_HOST_PATTERNS) {
      forbidden.pattern.lastIndex = 0;
      if (!forbidden.pattern.test(code)) continue;
      issues.push(Object.freeze({
        capability: forbidden.capability,
        line: index + 1,
        excerpt: code.trim(),
      }));
    }
  }
  return Object.freeze(issues);
}
