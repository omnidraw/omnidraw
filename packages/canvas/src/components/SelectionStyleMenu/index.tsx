import type { TColor } from '@omnidraw/cangine';
import type {
  TSelectionStyleChange,
  TSelectionStyleControl,
  TSelectionStylePropertyId,
  TSelectionStyleState,
} from '@omnidraw/cangine/editor';
import type {
  TCanvasFillColorCode,
  TCanvasInkColorCode,
} from '@omnidraw/canvas-contract';
import type {
  TThemeColorPickerPalette,
  TThemeStrokeWidthOption,
} from '@omnidraw/theme';
import {
  For,
  Show,
  createEffect,
  createSignal,
  onSettled,
  untrack,
} from 'solid-js';
import {
  fnCanvasColorToCss,
  fnSelectionStyleControl,
  fnSelectionStyleSharedValue,
} from './fn.selection-style-presentation';

type TChoice = string | number | readonly string[];
type TColorSwatch = TThemeColorPickerPalette['fillQuick'][number]
  | TThemeColorPickerPalette['strokeQuick'][number];
type TChoicePropertyId = Extract<
  TSelectionStylePropertyId,
  'line-routing' | 'stroke-pattern' | 'stroke-width'
  | 'font-family' | 'font-size' | 'font-weight'
>;
type TChoiceSection = Readonly<{
  id: TChoicePropertyId;
  label: string;
  choices?: readonly Readonly<{ label: string; value: TChoice }>[];
  format?(value: TChoice): string;
}>;

type TSelectionStyleMenuProps = Readonly<{
  palette: TThemeColorPickerPalette;
  state: TSelectionStyleState;
  strokeWidths: readonly TThemeStrokeWidthOption[];
  semanticColors?: Readonly<{
    background: TCanvasFillColorCode | null | undefined;
    ink: TCanvasInkColorCode | null | undefined;
  }>;
  onApply(change: TSelectionStyleChange): boolean;
  onSetColor(
    propertyId: 'background' | 'foreground',
    swatch: TColorSwatch,
  ): void;
  onBeginOpacity(): void;
  onUpdateOpacity(opacity: number): void;
  onEndOpacity(): void;
}>;

const LINE_CHOICES = [
  { label: 'Straight', value: 'straight' },
  { label: 'Curved', value: 'curved' },
  { label: 'Elbow', value: 'elbow' },
] as const;
const FONT_SIZE_OPTIONS = [
  { label: 'XS', value: 0.75 }, { label: 'S', value: 0.875 },
  { label: 'M', value: 1 }, { label: 'L', value: 1.25 },
  { label: 'XL', value: 1.5 },
] as const;
const FONT_WEIGHT_LABELS: Readonly<Record<number, string>> = {
  400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold',
};
const CONTAINED_SELECTION_EVENTS = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'wheel',
  'keydown',
  'keyup',
] as const;

function stopSelectionEventPropagation(event: Event): void {
  event.stopPropagation();
}

function isOpacityKey(key: string) {
  return key.startsWith('Arrow') || ['End', 'Home', 'PageDown', 'PageUp'].includes(key);
}

function ChoiceSection(props: Readonly<{
  section: TChoiceSection;
  control: TSelectionStyleControl | null;
  value: TChoice | null;
  onSelect(value: TChoice): void;
}>) {
  const options = () => props.section.choices
    ?? props.control?.options?.map((value) => ({
      label: props.section.format?.(value as TChoice) ?? String(value),
      value: value as TChoice,
  })) ?? [];
  const key = (value: TChoice | null) => JSON.stringify(value);
  return (
    <Show when={props.control}>
      <section class="omnidraw-selection-style-section">
        <span>{props.section.label}</span>
        <div class="omnidraw-selection-style-choices" data-property={props.section.id}>
          <For each={options()}>
            {(option) => (
              <button
                type="button"
                class="omnidraw-selection-style-choice"
                aria-pressed={key(props.value) === key(option.value)
                  ? 'true'
                  : 'false'}
                disabled={props.section.id === 'font-size' && props.value === null}
                onClick={() => props.onSelect(option.value)}
              >
                {option.label}
              </button>
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}

function ColorSection(props: Readonly<{
  label: string;
  value: string | null;
  semanticCode?: TCanvasFillColorCode | TCanvasInkColorCode | null;
  swatches: readonly TColorSwatch[];
  onSelect(swatch: TColorSwatch): void;
}>) {
  return (
    <section class="omnidraw-selection-style-section">
      <span>{props.label}</span>
      <div class="omnidraw-selection-style-colors">
        <For each={props.swatches}>
          {(swatch) => (
            <button
              type="button"
              class="omnidraw-style-color"
              aria-label={`${props.label} ${swatch.label}`}
              aria-pressed={props.semanticCode === undefined
                ? props.value === swatch.color ? 'true' : 'false'
                : props.semanticCode === swatch.code ? 'true' : 'false'}
              title={swatch.label}
              style={{ '--omnidraw-style-color': swatch.color }}
              onClick={() => props.onSelect(swatch)}
            />
          )}
        </For>
      </div>
    </section>
  );
}

function selectedColor(control: TSelectionStyleControl): string | null {
  const color = fnSelectionStyleSharedValue<TColor | null>(control);
  return color === null ? null : fnCanvasColorToCss(color);
}

function OpacitySection(props: Readonly<{
  control: TSelectionStyleControl;
  preview: number | null;
  value: number;
  onBegin(): void;
  onEnd(): void;
  onUpdate(value: number): void;
}>) {
  let inputRef!: HTMLInputElement;
  const begin = () => props.onBegin();
  const end = () => props.onEnd();
  const update = () => props.onUpdate(inputRef.valueAsNumber);
  const beginFromKey = (event: KeyboardEvent) => {
    if (isOpacityKey(event.key)) props.onBegin();
  };
  const endFromKey = (event: KeyboardEvent) => {
    if (isOpacityKey(event.key)) props.onEnd();
  };
  onSettled(() => {
    inputRef.addEventListener('pointerdown', begin);
    inputRef.addEventListener('pointerup', end);
    inputRef.addEventListener('pointercancel', end);
    inputRef.addEventListener('input', update);
    inputRef.addEventListener('change', end);
    inputRef.addEventListener('blur', end);
    inputRef.addEventListener('keydown', beginFromKey);
    inputRef.addEventListener('keyup', endFromKey);
    return () => {
      inputRef.removeEventListener('pointerdown', begin);
      inputRef.removeEventListener('pointerup', end);
      inputRef.removeEventListener('pointercancel', end);
      inputRef.removeEventListener('input', update);
      inputRef.removeEventListener('change', end);
      inputRef.removeEventListener('blur', end);
      inputRef.removeEventListener('keydown', beginFromKey);
      inputRef.removeEventListener('keyup', endFromKey);
    };
  });

  return (
    <section class="omnidraw-selection-style-section">
      <label for="omnidraw-selection-opacity">
        <span>OPACITY</span>
        <output>
          {fnSelectionStyleSharedValue<number>(props.control) === null
            && props.preview === null
            ? 'Mixed'
            : `${Math.round(props.value * 100)}%`}
        </output>
      </label>
      <input
        ref={inputRef}
        id="omnidraw-selection-opacity"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={props.value}
        style={{ '--omnidraw-style-opacity': `${props.value * 100}%` }}
      />
    </section>
  );
}

export function SelectionStyleMenu(props: TSelectionStyleMenuProps) {
  let menuRef!: HTMLElement;
  let opacityContinuous = false;
  let fontSizeSelection = '';
  let fontSizeBase: number | null = null;
  const [fontSizeFactor, setFontSizeFactor] = createSignal(1);
  const [opacityPreview, setOpacityPreview] = createSignal<number | null>(null);
  const control = (id: Parameters<typeof fnSelectionStyleControl>[1]) =>
    fnSelectionStyleControl(props.state, id);
  const choiceSections = () => [
    { id: 'line-routing', label: 'LINE', choices: LINE_CHOICES },
    {
      id: 'stroke-pattern',
      label: 'STROKE',
      format: (value) => String(value).replace(/^\w/, (letter) =>
        letter.toUpperCase()),
    },
    { id: 'stroke-width', label: 'WIDTH', choices: props.strokeWidths },
    {
      id: 'font-family', label: 'FONT',
      format: (value) => (value as readonly string[])[0] ?? 'Font',
    },
    { id: 'font-size', label: 'SIZE', choices: FONT_SIZE_OPTIONS },
    {
      id: 'font-weight', label: 'WEIGHT',
      format: (value) => FONT_WEIGHT_LABELS[Number(value)] ?? String(value),
    },
  ] satisfies readonly TChoiceSection[];
  const applyChoice = (section: TChoiceSection, value: TChoice) => {
    if (section.id !== 'font-size') {
      props.onApply({ propertyId: section.id, value } as TSelectionStyleChange);
      return;
    }
    if (fontSizeBase === null || typeof value !== 'number') return;
    const previousFactor = fontSizeFactor();
    setFontSizeFactor(value);
    if (!props.onApply({
      propertyId: 'font-size',
      value: fontSizeBase * value,
    })) {
      setFontSizeFactor(previousFactor);
    }
  };
  const beginOpacity = () => {
    if (opacityContinuous) return;
    props.onBeginOpacity();
    opacityContinuous = true;
  };
  const endOpacity = () => {
    if (!opacityContinuous) return;
    opacityContinuous = false;
    props.onEndOpacity();
    setOpacityPreview(null);
  };
  const updateOpacity = (value: number) => {
    if (!opacityContinuous) {
      props.onApply({ propertyId: 'opacity', value });
      return;
    }
    setOpacityPreview(value);
    props.onUpdateOpacity(value);
  };
  const opacityValue = () => opacityPreview()
    ?? fnSelectionStyleSharedValue<number>(control('opacity'))
    ?? 0.5;
  createEffect(
    () => {
      const current = fnSelectionStyleSharedValue<number>(control('font-size'));
      const selection = props.state.selectedRootIds.join('\0');
      const factor = untrack(fontSizeFactor);
      const selectionChanged = selection !== fontSizeSelection;
      return {
        current,
        selection,
        selectionChanged,
        shouldReset: selectionChanged || current !== (
          fontSizeBase === null ? null : fontSizeBase * factor
        ),
      } as const;
    },
    (intent) => {
      if (intent.selectionChanged) endOpacity();
      if (!intent.shouldReset) return;
      fontSizeSelection = intent.selection;
      fontSizeBase = intent.current;
      setFontSizeFactor(1);
    },
  );
  onSettled(() => {
    for (const type of CONTAINED_SELECTION_EVENTS) {
      menuRef.addEventListener(type, stopSelectionEventPropagation);
    }
    return () => {
      for (const type of CONTAINED_SELECTION_EVENTS) {
        menuRef.removeEventListener(type, stopSelectionEventPropagation);
      }
      endOpacity();
    };
  });

  return (
    <aside
      ref={menuRef}
      class="omnidraw-selection-style-menu"
      aria-label="Selection styles"
    >
      <For each={choiceSections()}>
        {(section) => (
          <ChoiceSection
            section={section}
            control={control(section.id)}
            value={section.id === 'font-size'
              ? fnSelectionStyleSharedValue(control(section.id)) === null ? null : fontSizeFactor()
              : fnSelectionStyleSharedValue(control(section.id))}
            onSelect={(value) => applyChoice(section, value)}
          />
        )}
      </For>
      <Show when={control('background')}>
        {(entry) => (
          <ColorSection
            label="BACKGROUND"
            value={selectedColor(entry())}
            semanticCode={props.semanticColors?.background}
            swatches={props.palette.fillQuick}
            onSelect={(swatch) => props.onSetColor('background', swatch)}
          />
        )}
      </Show>
      <Show when={control('foreground')}>
        {(entry) => (
          <ColorSection
            label={
              control('background')?.coverage.candidateTargetCount
                === entry().coverage.candidateTargetCount
                ? 'BORDER COLOR'
                : 'COLOR'
            }
            value={selectedColor(entry())}
            semanticCode={props.semanticColors?.ink}
            swatches={props.palette.strokeQuick}
            onSelect={(swatch) => props.onSetColor('foreground', swatch)}
          />
        )}
      </Show>
      <Show when={control('opacity')}>
        {(entry) => (
          <OpacitySection
            control={entry()}
            preview={opacityPreview()}
            value={opacityValue()}
            onBegin={beginOpacity}
            onEnd={endOpacity}
            onUpdate={updateOpacity}
          />
        )}
      </Show>
    </aside>
  );
}
