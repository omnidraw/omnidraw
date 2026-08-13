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
import { For, Show, createEffect, createSignal, onCleanup, untrack } from 'solid-js';
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
                aria-pressed={key(props.value) === key(option.value)}
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
                ? props.value === swatch.color
                : props.semanticCode === swatch.code}
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

export function SelectionStyleMenu(props: TSelectionStyleMenuProps) {
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
  createEffect(() => {
    const current = fnSelectionStyleSharedValue<number>(control('font-size'));
    const selection = props.state.selectedRootIds.join('\0');
    const factor = untrack(fontSizeFactor);
    if (selection !== fontSizeSelection) endOpacity();
    if (selection !== fontSizeSelection
      || current !== (fontSizeBase === null ? null : fontSizeBase * factor)) {
      fontSizeSelection = selection;
      fontSizeBase = current;
      setFontSizeFactor(1);
    }
  });
  onCleanup(endOpacity);

  return (
    <aside
      class="omnidraw-selection-style-menu"
      aria-label="Selection styles"
      on:pointerdown={(event) => event.stopPropagation()}
      on:pointermove={(event) => event.stopPropagation()}
      on:pointerup={(event) => event.stopPropagation()}
      on:pointercancel={(event) => event.stopPropagation()}
      on:wheel={(event) => event.stopPropagation()}
      on:keydown={(event) => event.stopPropagation()}
      on:keyup={(event) => event.stopPropagation()}
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
        {(control) => (
          <section class="omnidraw-selection-style-section">
            <label for="omnidraw-selection-opacity">
              <span>OPACITY</span>
              <output>
                {fnSelectionStyleSharedValue<number>(control()) === null
                  && opacityPreview() === null
                  ? 'Mixed'
                  : `${Math.round(opacityValue() * 100)}%`}
              </output>
            </label>
            <input
              id="omnidraw-selection-opacity"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={opacityValue()}
              style={{ '--omnidraw-style-opacity': `${opacityValue() * 100}%` }}
              on:pointerdown={beginOpacity}
              on:pointerup={endOpacity}
              on:pointercancel={endOpacity}
              onInput={(event) => updateOpacity(
                event.currentTarget.valueAsNumber,
              )}
              on:change={endOpacity}
              on:blur={endOpacity}
              on:keydown={(event) => {
                if (isOpacityKey(event.key)) beginOpacity();
              }}
              on:keyup={(event) => {
                if (isOpacityKey(event.key)) endOpacity();
              }}
            />
          </section>
        )}
      </Show>
    </aside>
  );
}
