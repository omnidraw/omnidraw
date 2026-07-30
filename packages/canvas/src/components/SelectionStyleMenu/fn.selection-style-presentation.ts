import type { TColor } from '@omnidraw/cangine';
import type {
  TSelectionStyleControl,
  TSelectionStylePropertyId,
  TSelectionStyleState,
} from '@omnidraw/cangine/editor';

const RENDERED_PROPERTIES = new Set<TSelectionStylePropertyId>([
  'background',
  'foreground',
  'stroke-width',
  'stroke-pattern',
  'line-routing',
  'font-family',
  'font-size',
  'font-weight',
  'opacity',
]);

export function fnSelectionStyleControl(
  state: TSelectionStyleState,
  id: TSelectionStylePropertyId,
): TSelectionStyleControl | null {
  return state.controls.find((control) => control.id === id) ?? null;
}

export function fnSelectionStyleSharedValue<T>(
  control: TSelectionStyleControl | null,
): T | null {
  return control?.value.status === 'shared'
    ? control.value.value as T
    : null;
}

export function fnSelectionStyleMenuVisible(
  state: TSelectionStyleState,
): boolean {
  return state.status === 'attached'
    && state.controls.some((control) => RENDERED_PROPERTIES.has(control.id));
}

export function fnParseCssColor(input: string): TColor | null {
  const normalized = input.trim().toLowerCase();
  const hex = normalized === 'transparent'
    ? '00000000'
    : normalized.startsWith('#')
      ? normalized.slice(1)
      : '';
  const expanded = hex.length === 3 || hex.length === 4
    ? [...hex].map((part) => `${part}${part}`).join('')
    : hex;
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(expanded)) return null;
  const channel = (offset: number) =>
    Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255;
  return {
    space: 'srgb',
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: expanded.length === 8 ? channel(6) : 1,
  };
}

export function fnCanvasColorToCss(input: TColor): string {
  const channels = [input.r, input.g, input.b]
    .map((channel) => Math.round(channel * 255));
  if (input.a === 0) return 'transparent';
  if (input.a < 1) return `rgba(${channels.join(', ')}, ${input.a})`;
  return `#${channels
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}
