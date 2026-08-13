import type { TAvailableWidget } from '../workspace/types';

function widgetNameKey(name: string): string {
  return name.normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

function checksum(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(36);
}

export function fnSortAvailableWidgets(widgets: readonly TAvailableWidget[]): TAvailableWidget[] {
  return [...widgets].sort((left, right) => (
    widgetNameKey(left.name).localeCompare(widgetNameKey(right.name), 'en-US')
    || left.name.localeCompare(right.name, 'en-US')
  ));
}

export function fnWidgetListFingerprint(widgets: readonly TAvailableWidget[]): string {
  return checksum(widgets.map((widget) => (
    `${widgetNameKey(widget.name)}\u0000${widget.kind ?? ''}\u0000${Number(widget.hasDraft)}${Number(widget.hasPublished)}${Number(widget.mountedInThisChat)}\u0000${widget.problemCode ?? ''}`
  )).join('\u0001'));
}

export function fnCreateWidgetListCursor(offset: number, fingerprint: string): string {
  const payload = `${offset.toString(36)}.${fingerprint}`;
  return `vw1.${payload}.${checksum(payload)}`;
}

export function fnParseWidgetListCursor(
  cursor: string,
  expectedFingerprint: string,
): { ok: true; offset: number } | { ok: false } {
  const match = /^vw1\.([0-9a-z]+)\.([0-9a-z]+)\.([0-9a-z]+)$/u.exec(cursor);
  if (!match) return { ok: false };
  const offsetText = match[1]!;
  const fingerprint = match[2]!;
  const payload = `${offsetText}.${fingerprint}`;
  if (match[3] !== checksum(payload) || fingerprint !== expectedFingerprint) return { ok: false };
  const offset = Number.parseInt(offsetText, 36);
  return Number.isSafeInteger(offset) && offset >= 0 ? { ok: true, offset } : { ok: false };
}
