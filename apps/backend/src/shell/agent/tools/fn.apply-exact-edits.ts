export type TExactEdit = { oldText: string; newText: string };

export type TApplyExactEditsResult =
  | { ok: true; content: string }
  | { ok: false; message: string };

export function fnApplyExactEdits(source: string, edits: readonly TExactEdit[]): TApplyExactEditsResult {
  if (edits.length === 0) return { ok: false, message: 'Edit requires at least one replacement.' };
  const matches: Array<TExactEdit & { start: number; end: number }> = [];
  for (const edit of edits) {
    if (edit.oldText.length === 0) return { ok: false, message: 'Edit oldText must not be empty.' };
    const start = source.indexOf(edit.oldText);
    if (start < 0) return { ok: false, message: 'Edit oldText was not found in the current file.' };
    if (source.indexOf(edit.oldText, start + 1) >= 0) return { ok: false, message: 'Edit oldText must identify one unique block.' };
    matches.push({ ...edit, start, end: start + edit.oldText.length });
  }
  matches.sort((left, right) => left.start - right.start);
  for (let index = 1; index < matches.length; index += 1) {
    if (matches[index]!.start < matches[index - 1]!.end) return { ok: false, message: 'Edit replacements must not overlap.' };
  }
  let cursor = 0;
  let content = '';
  for (const match of matches) {
    content += source.slice(cursor, match.start) + match.newText;
    cursor = match.end;
  }
  return { ok: true, content: content + source.slice(cursor) };
}
