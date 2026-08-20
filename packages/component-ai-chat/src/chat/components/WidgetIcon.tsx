import DOMPurify from "dompurify";
import * as LucideStatic from "lucide-static";
import { Show, type Component } from "solid-js";
import type { TAiChatToolIcon } from "../../contracts.js";
import { Puzzle } from "./icons";

export type TAiChatWidgetIconProps = Readonly<{
  icon: TAiChatToolIcon | null;
  class?: string;
  label?: string;
}>;

export const AiChatWidgetIcon: Component<TAiChatWidgetIconProps> = (props) => {
  const markup = () => {
    const raw = props.icon?.svgIcon?.trim()
      || (props.icon?.lucidIcon
        ? (LucideStatic as Record<string, string>)[props.icon.lucidIcon]
        : undefined);
    return raw
      ? DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } })
      : "";
  };

  return (
    <span
      class={props.class}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : "true"}
    >
      <Show when={markup()} fallback={<Puzzle size={14} />}>
        {(safeMarkup) => <span innerHTML={safeMarkup()} />}
      </Show>
    </span>
  );
};
