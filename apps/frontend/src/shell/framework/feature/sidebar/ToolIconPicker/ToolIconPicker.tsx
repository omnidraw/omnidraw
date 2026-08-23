import {
  LUCIDE_STATIC_ICON_KEYS,
  type TOmnidrawToolIcon,
} from '@omnidraw/sdk/tool-icon';
import * as Lucide from 'lucide-static';
import CircleAlert from 'lucide-static/icons/circle-alert.svg?raw';
import Code from 'lucide-static/icons/code.svg?raw';
import Ban from 'lucide-static/icons/ban.svg?raw';
import { Portal } from '@solidjs/web';
import { ChevronDown } from '@/shell/framework/components/icons';
import {
  anchoredPopupPortalTarget,
  connectAnchoredPopup,
} from '@/shell/framework/components/ui/anchored-popup';
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  onSettled,
  untrack,
} from 'solid-js';
import styles from './ToolIconPicker.module.css';

type TIconOption = Readonly<{ id: string; label: string; icon: string }>;

const ICON_NONE_ID = '__none__';
const ICON_CUSTOM_ID = '__custom__';
const SVG_UNSAFE_PATTERN = /(?:<!doctype|<!entity|<\/?(?:script|iframe|object|embed|foreignobject)\b|\bon[a-z]+\s*=|javascript\s*:|data\s*:\s*text\/html|\b(?:href|src)\s*=\s*["']?\s*https?:|\burl\s*\()/i;
const SINGLE_GRAPHEME_PATTERN = /^(?:\p{Regional_Indicator}{2}|[^\p{Mark}\u200D](?:[\p{Mark}\uFE0F]|\p{Emoji_Modifier})*(?:\u200D[^\p{Mark}\u200D](?:[\p{Mark}\uFE0F]|\p{Emoji_Modifier})*)*)$/u;
const ICON_PRESETS: readonly TIconOption[] = LUCIDE_STATIC_ICON_KEYS.flatMap((id) => {
  const icon = (Lucide as Record<string, unknown>)[id];
  return typeof icon === 'string' ? [{ id, label: id, icon }] : [];
});
const ICON_UTILITY_OPTIONS: readonly TIconOption[] = [
  { id: ICON_NONE_ID, label: 'No icon', icon: Ban },
  { id: ICON_CUSTOM_ID, label: 'Custom SVG or emoji', icon: Code },
];
const ICON_OPTIONS: readonly TIconOption[] = [
  ...ICON_UTILITY_OPTIONS,
  ...ICON_PRESETS,
];

// A deliberately varied default collection. Search still covers every pinned
// lucide-static icon, while opening the picker starts with useful concepts
// instead of the first page of one alphabetical family.
export const CURATED_LUCIDE_ICON_IDS = Object.freeze([
  'Home', 'Search', 'Settings', 'User', 'Users', 'Bell', 'Mail', 'Calendar', 'Clock', 'Star',
  'Heart', 'Bookmark', 'Tag', 'Flag', 'MapPin', 'Globe', 'Link', 'ExternalLink', 'Menu', 'Ellipsis',
  'Plus', 'Minus', 'X', 'Check', 'CircleHelp', 'CircleAlert', 'Info', 'Ban', 'ChevronDown', 'ArrowRight',
  'ArrowLeft', 'ArrowUp', 'ArrowDown', 'RefreshCw', 'Undo2', 'Redo2', 'Move', 'Maximize2', 'Minimize2', 'File',
  'FileText', 'Folder', 'FolderOpen', 'Archive', 'Inbox', 'Download', 'Upload', 'Save', 'Copy', 'Clipboard',
  'Trash2', 'Pencil', 'PenTool', 'Scissors', 'Paperclip', 'Image', 'Camera', 'Video', 'Music', 'Mic',
  'Volume2', 'Play', 'Pause', 'List', 'Grid3X3', 'Table', 'Columns3', 'Rows3', 'LayoutDashboard', 'MessageCircle',
  'MessagesSquare', 'Send', 'Share2', 'Phone', 'AtSign', 'Hash', 'Wifi', 'Radio', 'Rss', 'Briefcase',
  'Building2', 'Store', 'ShoppingCart', 'CreditCard', 'Wallet', 'Receipt', 'DollarSign', 'TrendingUp', 'BarChart3', 'PieChart',
  'LineChart', 'Calculator', 'Scale', 'Landmark', 'Package', 'Truck', 'Wrench', 'Hammer', 'SlidersHorizontal', 'Filter',
  'Code2', 'Terminal', 'Braces', 'Database', 'Server', 'Cloud', 'HardDrive', 'Cpu', 'MemoryStick', 'Monitor',
  'Smartphone', 'Tablet', 'Laptop', 'Printer', 'Scan', 'QrCode', 'Key', 'Lock', 'Unlock', 'Shield',
  'ShieldCheck', 'Fingerprint', 'Bug', 'Sun', 'Moon', 'CloudRain', 'CloudSnow', 'CloudLightning', 'Wind', 'Droplets',
  'Flame', 'Leaf', 'TreePine', 'Flower2', 'Mountain', 'Waves', 'Snowflake', 'Umbrella', 'Rainbow', 'Sunrise',
  'Sunset', 'Contact', 'Baby', 'Accessibility', 'Smile', 'Frown', 'Meh', 'ThumbsUp', 'ThumbsDown', 'Hand',
  'Footprints', 'Eye', 'Ear', 'Brain', 'Stethoscope', 'Pill', 'Syringe', 'Cross', 'HeartPulse', 'Activity',
  'Dumbbell', 'Map', 'Navigation', 'Compass', 'Plane', 'Car', 'Bus', 'Train', 'Ship', 'Bike',
  'Rocket', 'Tent', 'Bed', 'Bath', 'Utensils', 'Coffee', 'Beer', 'Wine', 'Cake', 'Pizza',
  'Lightbulb', 'Battery', 'Plug', 'Zap', 'Magnet', 'Gift', 'Trophy', 'Medal', 'Crown', 'Gem',
  'Sparkles', 'Palette', 'Brush', 'Shapes', 'Puzzle', 'Dice5', 'Gamepad2', 'BookOpen', 'GraduationCap', 'Languages',
]);
const ICON_PRESET_BY_ID = new Map(ICON_PRESETS.map((option) => [option.id, option]));
const CURATED_ICON_OPTIONS: readonly TIconOption[] = [
  ...ICON_UTILITY_OPTIONS,
  ...CURATED_LUCIDE_ICON_IDS.flatMap((id) => {
    const option = ICON_PRESET_BY_ID.get(id);
    return option === undefined ? [] : [option];
  }),
];
const MAX_VISIBLE_ICONS = CURATED_LUCIDE_ICON_IDS.length + ICON_UTILITY_OPTIONS.length + 1;

function normalizeIconSearch(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

// Keep this browser-local mirror aligned with the pure SDK authority in
// packages/sdk/src/contracts/core/fn.filesystem-path.ts. Focused tests compare
// its boundary corpus with fnWidgetToolIconTextError without bundling the SDK's
// broad contract entrypoint into the product sidebar.
export function toolIconValidationError(icon: TOmnidrawToolIcon | null): string | null {
  if (icon === null) return null;
  if (icon.lucidIcon !== undefined && icon.svgIcon !== undefined) {
    return 'Choose either a Lucide icon or a custom icon.';
  }
  if (icon.lucidIcon !== undefined) {
    return ICON_PRESETS.some((option) => option.id === icon.lucidIcon)
      ? null
      : 'Unknown Lucide static icon key.';
  }
  const value = icon.svgIcon ?? '';
  if (new TextEncoder().encode(value).byteLength > 16 * 1_024) {
    return 'Custom widget icons must be at most 16 KiB.';
  }
  if (value.length === 0 || value.includes('\0') || value !== value.trim()) {
    return 'Custom widget icons must be one trimmed grapheme or an SVG element.';
  }
  if (/^<svg(?:\s|>)/i.test(value)) {
    return !/<\/svg>$/i.test(value) || SVG_UNSAFE_PATTERN.test(value)
      ? 'Custom widget SVG contains unsupported or unsafe markup.'
      : null;
  }
  return SINGLE_GRAPHEME_PATTERN.test(value)
    ? null
    : 'Custom text icons must contain exactly one grapheme.';
}

function optionFor(icon: TOmnidrawToolIcon | null): TIconOption {
  if (icon !== null && 'svgIcon' in icon) return ICON_OPTIONS[1]!;
  if (icon?.lucidIcon) {
    return ICON_PRESETS.find((option) => option.id === icon.lucidIcon) ?? {
      id: icon.lucidIcon,
      label: `${icon.lucidIcon} (unknown Lucide icon)`,
      icon: CircleAlert,
    };
  }
  return ICON_OPTIONS[0]!;
}

// Every caller supplies markup from the pinned, first-party lucide-static package.
function ToolIconGlyph(props: { icon: string }) {
  return <span class={styles.glyph} innerHTML={props.icon} aria-hidden="true" />;
}

function eventNode(ownerDocument: Document, target: EventTarget | null): Node | undefined {
  const NodeConstructor = ownerDocument.defaultView?.Node;
  return NodeConstructor !== undefined && target instanceof NodeConstructor ? target : undefined;
}

export function ToolIconPicker(props: {
  value: TOmnidrawToolIcon | null;
  onChange: (icon: TOmnidrawToolIcon | null) => void;
}) {
  const [custom, setCustom] = createSignal(
    untrack(() => props.value !== null && 'svgIcon' in props.value ? props.value.svgIcon ?? '' : ''),
  );
  // `null` means the closed control is displaying the selected label. An empty
  // string is a real editing value, so clearing the field must stay visibly
  // empty while the listbox is open.
  const [query, setQuery] = createSignal<string | null>(null);
  const [open, setOpen] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(0);
  const fieldId = createUniqueId();
  let root: HTMLDivElement | undefined;
  let control: HTMLDivElement | undefined;
  let choicesContent: HTMLDivElement | undefined;
  let input: HTMLInputElement | undefined;
  let lastEmitted: TOmnidrawToolIcon | null | undefined;
  createEffect(
    () => props.value,
    (value) => {
      if (value === lastEmitted) {
        lastEmitted = undefined;
        return;
      }
      setCustom(value !== null && 'svgIcon' in value ? value.svgIcon ?? '' : '');
    },
  );
  const selected = createMemo(() => optionFor(props.value));
  const validationError = createMemo(() => toolIconValidationError(props.value));
  const visibleOptions = createMemo(() => {
    const querySearch = normalizeIconSearch(query() ?? '');
    const search = querySearch === normalizeIconSearch(selected().label) ? '' : querySearch;
    const candidates = search.length === 0
      ? CURATED_ICON_OPTIONS
      : ICON_OPTIONS.filter((option) => normalizeIconSearch(option.label).includes(search));
    const options: TIconOption[] = [];
    for (const option of [selected(), ...candidates]) {
      if (options.some((candidate) => candidate.id === option.id)) continue;
      options.push(option);
      if (options.length === MAX_VISIBLE_ICONS) break;
    }
    return options;
  });
  const closeChoices = () => {
    setOpen(false);
    setQuery(null);
  };
  onSettled(() => {
    const ownerDocument = root?.ownerDocument;
    if (ownerDocument === undefined) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = eventNode(ownerDocument, event.target);
      if (target === undefined || root?.contains(target) || choicesContent?.contains(target)) return;
      closeChoices();
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (!open()) return;
      const target = eventNode(ownerDocument, event.target);
      if (target !== undefined && (root?.contains(target) || choicesContent?.contains(target))) return;
      closeChoices();
    };
    ownerDocument.addEventListener('pointerdown', handlePointerDown);
    ownerDocument.addEventListener('focusin', handleFocusIn);
    return () => {
      ownerDocument.removeEventListener('pointerdown', handlePointerDown);
      ownerDocument.removeEventListener('focusin', handleFocusIn);
    };
  });
  const emit = (value: TOmnidrawToolIcon | null) => {
    lastEmitted = value;
    props.onChange(value);
  };

  const select = (option: TIconOption | null) => {
    if (option === null || option.id === ICON_NONE_ID) {
      emit(null);
      return;
    }
    if (option.id === ICON_CUSTOM_ID) {
      emit({ svgIcon: custom() });
      return;
    }
    emit({ lucidIcon: option.id });
  };

  const commitOption = (option: TIconOption) => {
    select(option);
    setQuery(null);
    setOpen(false);
    setActiveIndex(0);
    input?.focus();
  };

  const handleInput = (value: string) => {
    setQuery(value);
    setOpen(true);
    setActiveIndex(0);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const options = visibleOptions();
    if (event.key === 'Escape') {
      if (!open()) return;
      event.preventDefault();
      closeChoices();
      input?.focus();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open()) {
        setOpen(true);
        setActiveIndex(event.key === 'ArrowDown' ? 0 : Math.max(0, options.length - 1));
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => options.length === 0
        ? 0
        : (index + delta + options.length) % options.length);
      return;
    }
    if (event.key === 'Enter' && open()) {
      const option = options[activeIndex()];
      if (option === undefined) return;
      event.preventDefault();
      commitOption(option);
    }
  };

  const activeOptionId = () => open() && visibleOptions()[activeIndex()] !== undefined
    ? `${fieldId}-option-${activeIndex()}`
    : undefined;

  createEffect(
    activeOptionId,
    (id) => {
      if (id === undefined) return;
      queueMicrotask(() => input?.ownerDocument.getElementById(id)?.scrollIntoView({ block: 'nearest' }));
    },
  );

  const IconChoices = () => {
    const anchor = control;
    if (anchor === undefined) return null;
    const ownerDocument = anchor.ownerDocument;
    let content!: HTMLDivElement;
    onSettled(() => {
      choicesContent = content;
      const connection = connectAnchoredPopup({
        anchor,
        matchAnchorWidth: true,
        popup: content,
      });
      return () => {
        connection.disconnect();
        if (choicesContent === content) choicesContent = undefined;
      };
    });
    return <Portal mount={anchoredPopupPortalTarget(anchor)}>
      <div
        ref={content}
        class={styles.content}
        data-anchored-popup="tool-icon-picker"
        onFocusOut={(event) => {
          const next = eventNode(ownerDocument, event.relatedTarget);
          if (next !== undefined && (root?.contains(next) || content.contains(next))) return;
          closeChoices();
        }}
      >
        <div
          id={`${fieldId}-listbox`}
          class={styles.listbox}
          role="listbox"
          aria-label="Lucide icon choices"
        >
          <For each={visibleOptions()}>{(option, index) => (
            <div
              id={`${fieldId}-option-${index()}`}
              class={styles.option}
              role="option"
              aria-selected={selected().id === option.id ? 'true' : 'false'}
              data-highlighted={activeIndex() === index() ? '' : undefined}
              data-selected={selected().id === option.id ? '' : undefined}
              onPointerMove={() => setActiveIndex(index())}
              onClick={() => commitOption(option)}
            >
              <ToolIconGlyph icon={option.icon} />
              <span class={styles.optionLabel}>{option.label}</span>
            </div>
          )}</For>
        </div>
      </div>
    </Portal>;
  };

  return <div
    ref={root}
    class={styles.picker}
    onFocusOut={(event) => {
      if (!open()) return;
      const ownerDocument = event.currentTarget.ownerDocument;
      const next = eventNode(ownerDocument, event.relatedTarget);
      if (next !== undefined && (event.currentTarget.contains(next) || choicesContent?.contains(next))) return;
      closeChoices();
    }}
  >
    <div class={styles.combobox}>
      <label class={styles.label} for={`${fieldId}-input`}>Icon</label>
      <div ref={control} class={styles.control} data-expanded={open() ? '' : undefined}>
        <span class={styles.selectedGlyph}>
          <ToolIconGlyph icon={selected().icon} />
        </span>
        <input
          ref={input}
          id={`${fieldId}-input`}
          class={styles.input}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={`${fieldId}-listbox`}
          aria-expanded={open() ? 'true' : 'false'}
          aria-activedescendant={activeOptionId()}
          value={query() ?? selected().label}
          placeholder="Search Lucide icons…"
          onInput={(event) => handleInput(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          class={styles.trigger}
          aria-label="Show icon choices"
          aria-controls={`${fieldId}-listbox`}
          aria-expanded={open() ? 'true' : 'false'}
          data-expanded={open() ? '' : undefined}
          onClick={() => {
            setOpen((current) => !current);
            setQuery(null);
            setActiveIndex(0);
            input?.focus();
          }}
        >
          <span class={styles.triggerIcon} aria-hidden="true">
            <ChevronDown size={14} />
          </span>
        </button>
      </div>
      <Show when={open()}>
        <IconChoices />
      </Show>
    </div>

    <Show when={selected().id === ICON_CUSTOM_ID}>
      <div class={styles.custom}>
        <label class={styles.label} for={`${fieldId}-custom`}>Custom SVG or emoji</label>
        <textarea
          id={`${fieldId}-custom`}
          class={styles.textarea}
          rows={4}
          spellcheck="false"
          value={custom()}
          aria-invalid={validationError() === null ? undefined : 'true'}
          aria-describedby={validationError() === null
            ? `${fieldId}-custom-help`
            : `${fieldId}-custom-help ${fieldId}-custom-error`}
          data-invalid={validationError() === null ? undefined : ''}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setCustom(value);
            emit({ svgIcon: value });
          }}
        />
        <p id={`${fieldId}-custom-help`} class={styles.help}>
          Paste one trimmed grapheme or one accepted SVG element (16 KiB maximum).
        </p>
        <Show when={validationError()}>{(message) => (
          <p id={`${fieldId}-custom-error`} class={styles.error} role="alert">{message()}</p>
        )}</Show>
      </div>
    </Show>
    <Show when={selected().id !== ICON_CUSTOM_ID ? validationError() : null}>
      {(message) => <p class={styles.error} role="alert">{message()}</p>}
    </Show>
  </div>;
}
