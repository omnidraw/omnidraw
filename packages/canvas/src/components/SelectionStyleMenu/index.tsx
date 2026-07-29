import type {
  TThemeColorPickerPalette,
  TThemeStrokeWidthOption,
} from '@vibecanvas/service-theme';
import { For, Show } from 'solid-js';
import type {
  TSelectionLineShape,
  TSelectionStylePatch,
  TSelectionStyleState,
} from './fn.selection-style';
import './styles.css';

type TSelectionStyleMenuProps = Readonly<{
  palette: TThemeColorPickerPalette;
  state: TSelectionStyleState;
  strokeWidths: readonly TThemeStrokeWidthOption[];
  onApply(patch: TSelectionStylePatch): void;
  onSetLineShape(lineShape: TSelectionLineShape): void;
}>;

const LINE_SHAPES = [
  { label: 'Straight', value: 'straight' },
  { label: 'Curved', value: 'curved' },
  { label: 'Elbow', value: 'elbow' },
] as const satisfies readonly Readonly<{
  label: string;
  value: TSelectionLineShape;
}>[];

function ColorButton(props: Readonly<{
  color: string;
  label: string;
  selected: boolean;
  onSelect(): void;
}>) {
  return (
    <button
      type="button"
      class="vc-style-color"
      classList={{ 'vc-style-color--selected': props.selected }}
      aria-label={props.label}
      aria-pressed={props.selected}
      title={props.label}
      style={{ '--vc-style-color': props.color }}
      onClick={props.onSelect}
    />
  );
}

export function SelectionStyleMenu(props: TSelectionStyleMenuProps) {
  const activateLineShapeFromKeyboard = (
    event: KeyboardEvent,
    lineShape: TSelectionLineShape,
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    props.onSetLineShape(lineShape);
  };

  return (
    <aside
      class="vc-selection-style-menu"
      aria-label="Selection styles"
      on:pointerdown={(event) => event.stopPropagation()}
      on:pointermove={(event) => event.stopPropagation()}
      on:pointerup={(event) => event.stopPropagation()}
      on:pointercancel={(event) => event.stopPropagation()}
      on:wheel={(event) => event.stopPropagation()}
      on:keydown={(event) => event.stopPropagation()}
      on:keyup={(event) => event.stopPropagation()}
    >
      <Show when={props.state.showLine}>
        <section class="vc-selection-style-section">
          <span>LINE</span>
          <div class="vc-selection-style-lines">
            <For each={LINE_SHAPES}>
              {(option) => (
                <button
                  type="button"
                  classList={{
                    'vc-selection-style-choice': true,
                    'vc-selection-style-choice--selected':
                      props.state.lineShape === option.value,
                  }}
                  aria-pressed={props.state.lineShape === option.value}
                  onClick={() => props.onSetLineShape(option.value)}
                  on:keydown={(event) => (
                    activateLineShapeFromKeyboard(event, option.value)
                  )}
                >
                  {option.label}
                </button>
              )}
            </For>
          </div>
        </section>
      </Show>

      <Show when={props.state.showFill}>
        <section class="vc-selection-style-section">
          <span>FILL</span>
          <div class="vc-selection-style-colors">
            <For each={props.palette.fillQuick}>
              {(swatch) => (
                <ColorButton
                  color={swatch.color}
                  label={`Fill ${swatch.label}`}
                  selected={props.state.fillColor === swatch.color}
                  onSelect={() => props.onApply({ fillColor: swatch.color })}
                />
              )}
            </For>
          </div>
        </section>
      </Show>

      <Show when={props.state.showStroke}>
        <section class="vc-selection-style-section">
          <span>COLOR</span>
          <div class="vc-selection-style-colors">
            <For each={props.palette.strokeQuick}>
              {(swatch) => (
                <ColorButton
                  color={swatch.color}
                  label={`Stroke ${swatch.label}`}
                  selected={props.state.strokeColor === swatch.color}
                  onSelect={() => props.onApply({ strokeColor: swatch.color })}
                />
              )}
            </For>
          </div>
        </section>
      </Show>

      <Show when={props.state.showStrokeWidth}>
        <section class="vc-selection-style-section">
          <span>WIDTH</span>
          <div class="vc-selection-style-widths">
            <For each={props.strokeWidths}>
              {(option) => (
                <button
                  type="button"
                  classList={{
                    'vc-selection-style-choice': true,
                    'vc-selection-style-choice--selected':
                      props.state.strokeWidth === option.value,
                  }}
                  aria-pressed={props.state.strokeWidth === option.value}
                  onClick={() => props.onApply({ strokeWidth: option.value })}
                >
                  {option.label}
                </button>
              )}
            </For>
          </div>
        </section>
      </Show>

      <Show when={props.state.showOpacity}>
        <section class="vc-selection-style-section">
          <label for="vc-selection-opacity">
            <span>OPACITY</span>
            <output>{Math.round(props.state.opacity * 100)}%</output>
          </label>
          <input
            id="vc-selection-opacity"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={props.state.opacity}
            onInput={(event) => props.onApply({
              opacity: event.currentTarget.valueAsNumber,
            })}
          />
        </section>
      </Show>
    </aside>
  );
}
