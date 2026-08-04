/** @file Pure UTF-8, confined path, and portable icon-shape rules. */

import {
  WIDGET_BUILD_PATH_MAX_BYTES,
  WIDGET_TOOL_ICON_MAX_BYTES,
} from '../CONSTANTS';

const SVG_UNSAFE_PATTERN = /(?:<!doctype|<!entity|<\/?(?:script|iframe|object|embed|foreignobject)\b|\bon[a-z]+\s*=|javascript\s*:|data\s*:\s*text\/html|\b(?:href|src)\s*=\s*["']?\s*https?:|\burl\s*\()/i;
const SINGLE_GRAPHEME_PATTERN = /^(?:\p{Regional_Indicator}{2}|[^\p{Mark}\u200D](?:[\p{Mark}\uFE0F]|\p{Emoji_Modifier})*(?:\u200D[^\p{Mark}\u200D](?:[\p{Mark}\uFE0F]|\p{Emoji_Modifier})*)*)$/u;

export function fnUtf8ByteLength(value: string): number {
  let size = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    size += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return size;
}

export function fnNormalizeWidgetFilesystemRelativePath(value: string): string | null {
  if (
    value.length === 0
    || value !== value.trim()
    || value.includes('\\')
    || value.includes('\0')
    || /[\u0000-\u001f\u007f]/.test(value)
    || value !== value.normalize('NFC')
    || value.startsWith('/')
    || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)
  ) return null;

  let normalized = value;
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  if (normalized.length === 0 || fnUtf8ByteLength(normalized) > WIDGET_BUILD_PATH_MAX_BYTES) {
    return null;
  }
  const segments = normalized.split('/');
  if (segments.some((segment) => (
    segment.length === 0
    || fnUtf8ByteLength(segment) > 255
    || segment === '.'
    || segment === '..'
  ))) return null;
  return segments.join('/');
}

export function fnWidgetToolIconTextError(value: string): string | null {
  if (fnUtf8ByteLength(value) > WIDGET_TOOL_ICON_MAX_BYTES) {
    return 'Custom widget icons must be at most 16 KiB.';
  }
  if (value.length === 0 || value.includes('\0') || value !== value.trim()) {
    return 'Custom widget icons must be one trimmed grapheme or an SVG element.';
  }
  if (/^<svg(?:\s|>)/i.test(value)) {
    if (!/<\/svg>$/i.test(value) || SVG_UNSAFE_PATTERN.test(value)) {
      return 'Custom widget SVG contains unsupported or unsafe markup.';
    }
    return null;
  }
  return SINGLE_GRAPHEME_PATTERN.test(value)
    ? null
    : 'Custom text icons must contain exactly one grapheme.';
}
