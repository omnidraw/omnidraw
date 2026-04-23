import type { TThemeColorPickerPalette } from "@vibecanvas/service-theme";
import { Show, createMemo, createSignal, type JSX } from "solid-js";
import { CapPicker } from "./CapPicker";
import { ColorPalettePanel, ColorPicker } from "./ColorPicker";
import { FontFamilyPicker } from "./FontFamilyPicker";
import { FontSizePicker } from "./FontSizePicker";
import { LineTypePicker } from "./LineTypePicker";
import { OpacitySlider } from "./OpacitySlider";
import { StrokeWidthPicker } from "./StrokeWidthPicker";
import { TextAlignPicker } from "./TextAlignPicker";
import { VerticalAlignPicker } from "./VerticalAlignPicker";
import { DEFAULT_STROKE_WIDTHS, type TCapStyle, type TFontFamily, type TLineType, type TStrokeWidthOption } from "./types";

export type TSelectionStyleMenuSections = {
  showFillPicker: boolean;
  showStrokeColorPicker: boolean;
  showStrokeWidthPicker: boolean;
  showTextPickers: boolean;
  showOpacityPicker: boolean;
  showLineTypePicker: boolean;
  showStartCapPicker: boolean;
  showEndCapPicker: boolean;
};

export type TSelectionStyleMenuValues = {
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: string;
  opacity?: number;
  fontFamily?: TFontFamily;
  fontSize?: string;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  lineType?: TLineType;
  startCap?: TCapStyle;
  endCap?: TCapStyle;
};

const sectionStyle: JSX.CSSProperties = {
  display: "flex",
  "flex-direction": "column",
  gap: "0.25rem",
};

const labelStyle: JSX.CSSProperties = {
  "font-size": "10px",
  color: "var(--muted-foreground)",
  "font-family": "var(--font-mono)",
};

export function SelectionStyleMenu(props: {
  visible: () => boolean;
  sections: () => TSelectionStyleMenuSections;
  values: () => TSelectionStyleMenuValues;
  strokeWidthOptions?: () => TStrokeWidthOption[];
  colorPalette: () => TThemeColorPickerPalette;
  onFillChange: (color: string) => void;
  onStrokeChange: (color: string) => void;
  onStrokeWidthChange: (width: string) => void;
  onOpacityChange: (opacity: number) => void;
  onFontFamilyChange: (fontFamily: TFontFamily) => void;
  onFontSizeChange?: (fontSize: string) => void;
  onTextAlignChange?: (textAlign: "left" | "center" | "right") => void;
  onVerticalAlignChange?: (verticalAlign: "top" | "middle" | "bottom") => void;
  onLineTypeChange: (lineType: TLineType) => void;
  onStartCapChange: (capStyle: TCapStyle) => void;
  onEndCapChange: (capStyle: TCapStyle) => void;
  rootRef?: (element: HTMLDivElement) => void;
  onEscape?: () => void;
  onInteraction?: () => void;
}) {
  const shouldShow = createMemo(() => props.visible());
  const resolvedStrokeWidthOptions = createMemo(() => {
    const options = props.strokeWidthOptions?.() ?? [];
    return options.length > 0 ? options : [...DEFAULT_STROKE_WIDTHS];
  });
  const [expandedColorPanel, setExpandedColorPanel] = createSignal<"fill" | "stroke" | null>(null);

  return (
    <Show when={shouldShow()}>
      <div
        style={{
          position: "absolute",
          left: "0.75rem",
          top: "0.75rem",
          "z-index": 40,
          "pointer-events": "none",
        }}
      >
        <div
          ref={props.rootRef}
          tabIndex={0}
          style={{ display: "flex", gap: "0.5rem", "align-items": "flex-start", outline: "none" }}
          onPointerDown={() => props.onInteraction?.()}
          onKeyDown={(event) => {
            if (event.key !== "Escape") {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            props.onEscape?.();
          }}
        >
          <div
            style={{
              width: "18.5rem",
              height: "24rem",
              border: "1px solid var(--border)",
              background: "var(--card)",
              "box-shadow": "0 6px 18px rgba(0, 0, 0, 0.12)",
              "pointer-events": "auto",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                padding: "0.75rem",
                display: "flex",
                "flex-direction": "column",
                gap: "0.75rem",
                overflow: "auto",
              }}
            >
            <Show when={props.sections().showFillPicker}>
              <div style={sectionStyle}>
                <span style={labelStyle}>FILL</span>
                <ColorPicker
                  value={props.values().fillColor}
                  onChange={props.onFillChange}
                  showTransparent
                  mode="fill"
                  palette={props.colorPalette()}
                  expanded={expandedColorPanel() === "fill"}
                  onExpandedChange={(expanded) => setExpandedColorPanel(expanded ? "fill" : null)}
                />
              </div>
            </Show>

            <Show when={props.sections().showStrokeColorPicker}>
              <div style={sectionStyle}>
                <span style={labelStyle}>COLOR</span>
                <ColorPicker
                  value={props.values().strokeColor}
                  onChange={props.onStrokeChange}
                  mode="stroke"
                  palette={props.colorPalette()}
                  expanded={expandedColorPanel() === "stroke"}
                  onExpandedChange={(expanded) => setExpandedColorPanel(expanded ? "stroke" : null)}
                />
              </div>
            </Show>

            <Show when={props.sections().showStrokeWidthPicker}>
              <div style={sectionStyle}>
                <span style={labelStyle}>WIDTH</span>
                <StrokeWidthPicker
                  options={resolvedStrokeWidthOptions()}
                  value={props.values().strokeWidth}
                  onChange={props.onStrokeWidthChange}
                />
              </div>
            </Show>

            <Show when={props.sections().showTextPickers}>
              <div style={{ display: "flex", "flex-direction": "column", gap: "0.75rem" }}>
                <div style={sectionStyle}>
                  <span style={labelStyle}>FONT</span>
                  <FontFamilyPicker
                    value={props.values().fontFamily}
                    onChange={props.onFontFamilyChange}
                  />
                </div>

                <div style={sectionStyle}>
                  <span style={labelStyle}>SIZE</span>
                  <FontSizePicker
                    value={props.values().fontSize}
                    onChange={(fontSize) => props.onFontSizeChange?.(fontSize)}
                  />
                </div>

                <div style={sectionStyle}>
                  <span style={labelStyle}>ALIGN</span>
                  <TextAlignPicker
                    value={props.values().textAlign}
                    onChange={(textAlign) => props.onTextAlignChange?.(textAlign)}
                  />
                </div>

                <div style={sectionStyle}>
                  <span style={labelStyle}>VERTICAL</span>
                  <VerticalAlignPicker
                    value={props.values().verticalAlign}
                    onChange={(verticalAlign) => props.onVerticalAlignChange?.(verticalAlign)}
                  />
                </div>
              </div>
            </Show>

            <Show when={props.sections().showLineTypePicker}>
              <div style={sectionStyle}>
                <span style={labelStyle}>CURVE</span>
                <LineTypePicker
                  value={props.values().lineType}
                  onChange={props.onLineTypeChange}
                />
              </div>
            </Show>

            <Show when={props.sections().showStartCapPicker}>
              <div style={sectionStyle}>
                <span style={labelStyle}>START</span>
                <CapPicker
                  label="START"
                  value={props.values().startCap}
                  onChange={props.onStartCapChange}
                />
              </div>
            </Show>

            <Show when={props.sections().showEndCapPicker}>
              <div style={sectionStyle}>
                <span style={labelStyle}>END</span>
                <CapPicker
                  label="END"
                  value={props.values().endCap}
                  onChange={props.onEndCapChange}
                />
              </div>
            </Show>

            <Show when={props.sections().showOpacityPicker}>
              <div style={sectionStyle}>
                <span style={labelStyle}>OPACITY</span>
                <OpacitySlider
                  value={props.values().opacity}
                  onChange={props.onOpacityChange}
                />
              </div>
            </Show>
            </div>
          </div>

          <Show when={expandedColorPanel() === "fill" && props.sections().showFillPicker}>
            <div style={{ "pointer-events": "auto" }}>
              <ColorPalettePanel
                value={props.values().fillColor}
                onChange={props.onFillChange}
                palette={props.colorPalette()}
              />
            </div>
          </Show>

          <Show when={expandedColorPanel() === "stroke" && props.sections().showStrokeColorPicker}>
            <div style={{ "pointer-events": "auto" }}>
              <ColorPalettePanel
                value={props.values().strokeColor}
                onChange={props.onStrokeChange}
                palette={props.colorPalette()}
              />
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
