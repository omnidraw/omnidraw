import type { TOmnidrawToolIcon } from '@omnidraw/sdk';
import DOMPurify from 'dompurify';
import { Puzzle } from '@/shell/framework/components/icons';
import * as LucideStatic from 'lucide-static';
import { Show, type Component } from 'solid-js';

export type TWidgetIconProps = {
  icon: TOmnidrawToolIcon | null;
  class?: string;
  label?: string;
};

const HOST_RESOURCE_SVG_PATTERN = /(?:<\s*(?:a|image|use|feimage|mpath|style|animate(?:motion|transform)?|set|font-face-uri)\b|(?:^|[\s<])(?:href|xlink:href|src|srcset|style)\s*=|@import\b|\burl\b)/i;
const STATIC_SVG_TAGS = [
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'title',
  'desc',
];
const STATIC_SVG_ATTRIBUTES = [
  'viewBox',
  'width',
  'height',
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'opacity',
  'd',
  'points',
  'x',
  'y',
  'x1',
  'x2',
  'y1',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'transform',
  'role',
  'aria-hidden',
  'focusable',
  'preserveAspectRatio',
];

export function publishedWidgetIconSafetyError(
  icon: TOmnidrawToolIcon | null,
): string | null {
  const svgIcon = icon?.svgIcon;
  return svgIcon !== undefined && HOST_RESOURCE_SVG_PATTERN.test(svgIcon)
    ? 'Published custom SVG icons cannot contain resource, navigation, animation, or style markup.'
    : null;
}

const STATIC_PAINT_PATTERN = /^(?:none|currentColor|transparent|#[0-9a-f]{3,8}|[a-z]+|(?:rgb|rgba|hsl|hsla)\([0-9.,%+\-\s/deg]+\))$/i;

function sanitizeCustomSvg(raw: string): string {
  if (publishedWidgetIconSafetyError({ svgIcon: raw }) !== null) return '';
  const sanitized = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: STATIC_SVG_TAGS,
    ALLOWED_ATTR: STATIC_SVG_ATTRIBUTES,
    ALLOW_DATA_ATTR: false,
  });
  const parsed = new DOMParser().parseFromString(sanitized, 'image/svg+xml');
  if (parsed.querySelector('parsererror') !== null || parsed.documentElement.tagName !== 'svg') return '';
  for (const element of [parsed.documentElement, ...parsed.querySelectorAll('*')]) {
    for (const attribute of ['fill', 'stroke']) {
      const value = element.getAttribute(attribute);
      if (value !== null && !STATIC_PAINT_PATTERN.test(value)) return '';
    }
  }
  return sanitized;
}

export const WidgetIcon: Component<TWidgetIconProps> = (props) => {
  const custom = () => props.icon?.svgIcon?.trim();
  const customText = () => {
    const raw = custom();
    return raw && !/^<svg(?:\s|>)/i.test(raw) ? raw : '';
  };
  const markup = () => {
    const raw = custom();
    if (raw) return sanitizeCustomSvg(raw);
    const lucide = props.icon?.lucidIcon
      ? (LucideStatic as Record<string, string>)[props.icon.lucidIcon]
      : undefined;
    return lucide
      ? DOMPurify.sanitize(lucide, { USE_PROFILES: { svg: true } })
      : '';
  };
  return (
    <span class={props.class} aria-label={props.label} aria-hidden={props.label ? undefined : 'true'}>
      <Show when={customText()} fallback={
        <Show when={markup()} fallback={<Puzzle size={14} />}>
          {(safeMarkup) => <span innerHTML={safeMarkup()} />}
        </Show>
      }>
        {(text) => <span>{text()}</span>}
      </Show>
    </span>
  );
};
