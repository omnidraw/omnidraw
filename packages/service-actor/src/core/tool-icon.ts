import * as Lucid from 'lucide-static';

export const LUCIDE_STATIC_ICON_KEYS = Object.keys(Lucid).sort();
export const LUCIDE_STATIC_ICON_KEY_SET = new Set<string>(LUCIDE_STATIC_ICON_KEYS);

export type TLucidStaticIconKey = string;

export type TVibecanvasToolIcon = {
  readonly lucidIcon?: TLucidStaticIconKey;
  readonly svgIcon?: string;
};

export function isLucideStaticIconKey(value: unknown): value is TLucidStaticIconKey {
  return typeof value === 'string' && LUCIDE_STATIC_ICON_KEY_SET.has(value);
}
