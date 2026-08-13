/**
 * @file Pure defense-in-depth admission checks for unsupported continuations.
 */

export type TFunctionArtifactAdmission =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; token: string }>;

const FORBIDDEN_RUNTIME_PATTERNS = [
  ['Bun.sleep', /\bBun\s*\.\s*sleep\s*\(/],
  ['Atomics.wait', /\bAtomics\s*\.\s*wait(?:Async)?\s*\(/],
  ['waitUntil', /\bwaitUntil\s*\(/],
  ['checkpoint', /\bcheckpoint\s*\(/],
  ['schedule', /\b(?:schedule|scheduleAt|scheduleAfter)\s*\(/],
  ['dynamic import', /\bimport\s*\(/],
  ['static import', /(?:^|[;\n])\s*import\s+(?!\.)/m],
  ['re-export', /\bexport\s+(?:\*|\{[^}]*\})\s+from\s*['"]/],
  ['import.meta', /\bimport\s*\.\s*meta\b/],
  ['require', /\brequire\s*\(/],
] as const;

export function fnFunctionArtifactAdmission(source: string): TFunctionArtifactAdmission {
  for (const [token, pattern] of FORBIDDEN_RUNTIME_PATTERNS) {
    if (pattern.test(source)) return { allowed: false, token };
  }
  return { allowed: true };
}
