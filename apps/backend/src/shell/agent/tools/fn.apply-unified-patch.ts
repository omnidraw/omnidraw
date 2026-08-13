export type TApplyPatchResult =
  | { ok: true; content: string }
  | { ok: false; message: string };

type THunk = {
  oldStart: number;
  lines: string[];
};

export function fnApplyUnifiedPatch(source: string, patch: string): TApplyPatchResult {
  const patchLines = patch.replace(/\r\n/g, '\n').split('\n');
  const hunks: THunk[] = [];
  let current: THunk | null = null;
  for (const line of patchLines) {
    const header = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
    if (header) {
      current = { oldStart: Number(header[1]), lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line === '\\ No newline at end of file') continue;
    if (!line.startsWith(' ') && !line.startsWith('+') && !line.startsWith('-')) {
      return { ok: false, message: `Invalid unified patch line: ${line}` };
    }
    current.lines.push(line);
  }
  if (hunks.length === 0) return { ok: false, message: 'Patch must contain at least one unified-diff hunk.' };

  const hadTrailingNewline = source.endsWith('\n');
  const sourceLines = source.replace(/\r\n/g, '\n').split('\n');
  if (hadTrailingNewline) sourceLines.pop();
  const output: string[] = [];
  let sourceIndex = 0;

  for (const hunk of hunks) {
    const hunkIndex = Math.max(0, hunk.oldStart - 1);
    if (hunkIndex < sourceIndex || hunkIndex > sourceLines.length) {
      return { ok: false, message: `Patch hunk starts outside the source at line ${hunk.oldStart}.` };
    }
    output.push(...sourceLines.slice(sourceIndex, hunkIndex));
    sourceIndex = hunkIndex;

    for (const line of hunk.lines) {
      const marker = line[0];
      const value = line.slice(1);
      if (marker === '+') {
        output.push(value);
        continue;
      }
      if (sourceLines[sourceIndex] !== value) {
        return { ok: false, message: `Patch context did not match source line ${sourceIndex + 1}.` };
      }
      if (marker === ' ') output.push(value);
      sourceIndex += 1;
    }
  }

  output.push(...sourceLines.slice(sourceIndex));
  return { ok: true, content: `${output.join('\n')}${hadTrailingNewline ? '\n' : ''}` };
}
