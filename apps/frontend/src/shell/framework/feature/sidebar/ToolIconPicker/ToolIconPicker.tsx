import * as Combobox from '@kobalte/core/combobox';
import { TextField } from '@kobalte/core/text-field';
import {
  LUCIDE_STATIC_ICON_KEYS,
  type TOmnidrawToolIcon,
} from '@omnidraw/sdk/tool-icon';
import * as Lucide from 'lucide-static';
import CircleAlert from 'lucide-static/icons/circle-alert.svg?raw';
import Code from 'lucide-static/icons/code.svg?raw';
import Ban from 'lucide-static/icons/ban.svg?raw';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import { Show, createEffect, createMemo, createSignal } from 'solid-js';
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

export function ToolIconPicker(props: {
  value: TOmnidrawToolIcon | null;
  onChange: (icon: TOmnidrawToolIcon | null) => void;
}) {
  const [custom, setCustom] = createSignal(
    props.value !== null && 'svgIcon' in props.value ? props.value.svgIcon ?? '' : '',
  );
  const [query, setQuery] = createSignal('');
  let lastEmitted: TOmnidrawToolIcon | null | undefined;
  createEffect(() => {
    const value = props.value;
    if (value === lastEmitted) {
      lastEmitted = undefined;
      return;
    }
    setCustom(value !== null && 'svgIcon' in value ? value.svgIcon ?? '' : '');
  });
  const selected = createMemo(() => optionFor(props.value));
  const validationError = createMemo(() => toolIconValidationError(props.value));
  const visibleOptions = createMemo(() => {
    const querySearch = normalizeIconSearch(query());
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

  return <div class={styles.picker}>
    <Combobox.Root<TIconOption>
      class={styles.combobox}
      options={visibleOptions()}
      value={selected()}
      onChange={select}
      onInputChange={setQuery}
      onOpenChange={(open) => {
        if (!open) setQuery('');
      }}
      optionValue="id"
      optionTextValue="label"
      optionLabel="label"
      defaultFilter={(option, inputValue) => {
        const search = normalizeIconSearch(inputValue);
        return search.length === 0
          || search === normalizeIconSearch(selected().label)
          || normalizeIconSearch(option.label).includes(search);
      }}
      placeholder="Search Lucide icons…"
      itemComponent={(itemProps) => (
        <Combobox.Item item={itemProps.item} class={styles.option}>
          <ToolIconGlyph icon={itemProps.item.rawValue.icon} />
          <Combobox.ItemLabel class={styles.optionLabel}>
            {itemProps.item.rawValue.label}
          </Combobox.ItemLabel>
        </Combobox.Item>
      )}
      placement="bottom-start"
      gutter={4}
      sameWidth
    >
      <Combobox.Label class={styles.label}>Icon</Combobox.Label>
      <Combobox.Control class={styles.control}>
        <span class={styles.selectedGlyph}>
          <ToolIconGlyph icon={selected().icon} />
        </span>
        <Combobox.Input class={styles.input} />
        <Combobox.Trigger class={styles.trigger} aria-label="Show icon choices">
          <Combobox.Icon class={styles.triggerIcon} aria-hidden="true">
            <ChevronDown size={14} />
          </Combobox.Icon>
        </Combobox.Trigger>
      </Combobox.Control>
      <Combobox.HiddenSelect />
      <Combobox.Portal>
        <Combobox.Content class={styles.content}>
          <Combobox.Listbox class={styles.listbox} />
        </Combobox.Content>
      </Combobox.Portal>
    </Combobox.Root>

    <Show when={selected().id === ICON_CUSTOM_ID}>
      <TextField
        class={styles.custom}
        value={custom()}
        onChange={(value) => {
          setCustom(value);
          emit({ svgIcon: value });
        }}
        validationState={validationError() === null ? 'valid' : 'invalid'}
      >
        <TextField.Label class={styles.label}>Custom SVG or emoji</TextField.Label>
        <TextField.TextArea
          class={styles.textarea}
          rows={4}
          spellcheck={false}
        />
        <TextField.Description class={styles.help}>
          Paste one trimmed grapheme or one accepted SVG element (16 KiB maximum).
        </TextField.Description>
        <TextField.ErrorMessage class={styles.error}>
          {validationError()}
        </TextField.ErrorMessage>
      </TextField>
    </Show>
    <Show when={selected().id !== ICON_CUSTOM_ID ? validationError() : null}>
      {(message) => <p class={styles.error} role="alert">{message()}</p>}
    </Show>
  </div>;
}
