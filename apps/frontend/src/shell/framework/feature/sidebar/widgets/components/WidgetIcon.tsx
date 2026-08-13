import type { TOmnidrawToolIcon } from '@omnidraw/sdk';
import DOMPurify from 'dompurify';
import Puzzle from 'lucide-solid/icons/puzzle';
import * as LucideStatic from 'lucide-static';
import { Show, type Component } from 'solid-js';

export type TWidgetIconProps = {
  icon: TOmnidrawToolIcon | null;
  class?: string;
  label?: string;
};

export const WidgetIcon: Component<TWidgetIconProps> = (props) => {
  const markup = () => {
    const raw = props.icon?.svgIcon?.trim()
      || (props.icon?.lucidIcon ? (LucideStatic as Record<string, string>)[props.icon.lucidIcon] : undefined);
    return raw ? DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } }) : '';
  };
  return (
    <span class={props.class} aria-label={props.label} aria-hidden={props.label ? undefined : 'true'}>
      <Show when={markup()} fallback={<Puzzle size={14} />}>
        {(safeMarkup) => <span innerHTML={safeMarkup()} />}
      </Show>
    </span>
  );
};
