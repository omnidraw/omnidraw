import { TextField } from "@kobalte/core/text-field";
import type { TVibecanvasToolIcon } from "@vibecanvas/service-actor/core/tool-icon";
import DOMPurify from "dompurify";
import * as Lucide from "lucide-static";
import Code from "lucide-static/icons/code.svg?raw";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import "./styles.css";

type TIconOption = { id: string; label: string; icon: string };
const ICON_NONE_ID = "__none__";
const ICON_CUSTOM_ID = "__custom__";
const MAX_VISIBLE_ICONS = 100;
const SVG_PATTERN = /^\s*(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i;
const ICON_PRESETS: readonly TIconOption[] = Object.entries(Lucide).map(([id, icon]) => ({ id, label: id, icon }));
const ICON_OPTIONS: readonly TIconOption[] = [
  { id: ICON_NONE_ID, label: "No icon", icon: "" },
  { id: ICON_CUSTOM_ID, label: "Custom SVG / emoji / text", icon: Code },
  ...ICON_PRESETS,
];

function sanitizeSvg(value: string) {
  return DOMPurify.sanitize(value, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["script", "foreignObject"],
    FORBID_ATTR: ["onload", "onclick", "onerror", "style"],
  });
}

function firstGrapheme(value: string) {
  const segment = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)[Symbol.iterator]().next();
  return segment.done ? "" : segment.value.segment;
}

export function normalizeCustomToolIcon(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return SVG_PATTERN.test(trimmed) ? sanitizeSvg(trimmed) : firstGrapheme(trimmed);
}

export function resolveToolIconMarkup(icon: TVibecanvasToolIcon | null | undefined) {
  if (icon?.svgIcon?.trim()) return icon.svgIcon.trim();
  return icon?.lucidIcon ? ICON_PRESETS.find((entry) => entry.id === icon.lucidIcon)?.icon : undefined;
}

export function ToolIconGlyph(props: { icon?: string }) {
  const svg = createMemo(() => props.icon && SVG_PATTERN.test(props.icon) ? sanitizeSvg(props.icon) : "");
  return <Show when={props.icon}>{(icon) => (
    <Show when={svg()} fallback={<span class="vc-tool-icon-picker__text">{firstGrapheme(icon())}</span>}>
      {(markup) => <span class="vc-tool-icon-picker__glyph" innerHTML={markup()} aria-hidden="true" />}
    </Show>
  )}</Show>;
}

export function ToolIconPicker(props: {
  value: TVibecanvasToolIcon | null;
  onChange: (icon: TVibecanvasToolIcon | null) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [customIcon, setCustomIcon] = createSignal(props.value?.svgIcon ?? "");
  const [selectedId, setSelectedId] = createSignal(props.value?.svgIcon ? ICON_CUSTOM_ID : props.value?.lucidIcon ?? ICON_NONE_ID);
  createEffect(() => {
    const value = props.value;
    setSelectedId(value?.svgIcon ? ICON_CUSTOM_ID : value?.lucidIcon ?? ICON_NONE_ID);
    if (value?.svgIcon !== undefined) setCustomIcon(value.svgIcon);
  });
  const selected = createMemo(() => ICON_OPTIONS.find((option) => option.id === selectedId()) ?? ICON_OPTIONS[0]);
  const filtered = createMemo(() => {
    const search = query().trim().toLowerCase();
    const options = search ? ICON_OPTIONS.filter((option) => option.label.toLowerCase().includes(search)) : ICON_OPTIONS;
    return options.slice(0, MAX_VISIBLE_ICONS);
  });

  const select = (option: TIconOption) => {
    setOpen(false);
    setSelectedId(option.id);
    if (option.id === ICON_NONE_ID) props.onChange(null);
    else if (option.id === ICON_CUSTOM_ID) {
      const normalized = normalizeCustomToolIcon(customIcon());
      if (normalized) props.onChange({ svgIcon: normalized });
    } else props.onChange({ lucidIcon: option.id });
  };

  return <div class="vc-tool-icon-picker">
    <span class="vc-tool-icon-picker__label">Icon</span>
    <button type="button" class="vc-tool-icon-picker__trigger" aria-haspopup="listbox" aria-expanded={open()} onClick={() => setOpen((value) => !value)}>
      <span class="vc-tool-icon-picker__value"><ToolIconGlyph icon={selected().icon} /><span>{selected().label}</span></span><span aria-hidden="true">⌄</span>
    </button>
    <Show when={open()}>
      <div class="vc-tool-icon-picker__menu">
        <TextField value={query()} onChange={setQuery}>
          <TextField.Input class="vc-tool-icon-picker__search" placeholder="Filter Lucide icons…" autofocus />
        </TextField>
        <div role="listbox" aria-label="Icon choices">
          <For each={filtered()}>{(option) => <button type="button" class="vc-tool-icon-picker__option" classList={{ "vc-tool-icon-picker__option--selected": selectedId() === option.id }} role="option" aria-selected={selectedId() === option.id} onClick={() => select(option)}><ToolIconGlyph icon={option.icon} /><span>{option.label}</span></button>}</For>
        </div>
      </div>
    </Show>
    <Show when={selectedId() === ICON_CUSTOM_ID}>
      <TextField class="vc-tool-icon-picker__custom" value={customIcon()} onChange={(value) => { setCustomIcon(value); const normalized = normalizeCustomToolIcon(value); props.onChange(normalized ? { svgIcon: normalized } : null); }}>
        <TextField.Label class="vc-tool-icon-picker__label">Custom SVG / emoji / text</TextField.Label>
        <TextField.TextArea class="vc-tool-icon-picker__textarea" rows={4} spellcheck={false} />
        <TextField.Description class="vc-tool-icon-picker__help">SVG is preserved. Emoji or text uses its first character.</TextField.Description>
      </TextField>
    </Show>
  </div>;
}
