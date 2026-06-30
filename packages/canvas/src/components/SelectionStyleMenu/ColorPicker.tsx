import { isThemeColorToken, type TThemeColorPickerPalette, type TThemeColorSwatch, type TThemeColorToken } from "@vibecanvas/service-theme";
import { For, Show, createMemo } from "solid-js";

type TMode = "fill" | "stroke";

const FALLBACK_COLOR = "#1f1f22";

function normalizeSelectionValue(value: string | undefined) {
  if (value === "transparent") {
    return "@transparent";
  }

  return value;
}

function swatchButtonStyle(args: { selected: boolean; disabled?: boolean }) {
  return {
    position: "relative",
    width: "1.75rem",
    height: "1.75rem",
    overflow: "hidden",
    border: `1px solid ${args.selected ? "var(--primary)" : "var(--border)"}`,
    "border-radius": "0.45rem",
    padding: "0",
    opacity: args.disabled ? 0.45 : 1,
    "box-shadow": args.selected ? "0 0 0 2px color-mix(in srgb, var(--primary) 20%, transparent)" : "none",
    background: "var(--card)",
    cursor: args.disabled ? "default" : "pointer",
  } as const;
}

function renderSwatch(color: string, token?: string) {
  if (token === "@transparent" || color === "transparent") {
    return (
      <div style={{ position: "relative", width: "100%", height: "100%", background: "var(--background)" }}>
        <div style={{ position: "absolute", inset: 0, background: "var(--muted)", opacity: 0.4 }} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "font-size": "10px",
            color: "var(--muted-foreground)",
          }}
        >
          ×
        </div>
      </div>
    );
  }

  return <div style={{ width: "100%", height: "100%", background: color }} />;
}

function sectionTitle(title: string) {
  return (
    <span style={{ "font-size": "10px", "font-family": "var(--font-mono)", color: "var(--muted-foreground)", "text-transform": "uppercase", "letter-spacing": "0.04em" }}>
      {title}
    </span>
  );
}

function SelectedBadge(props: { visible: boolean }) {
  return (
    <Show when={props.visible}>
      <div
        style={{
          position: "absolute",
          right: "2px",
          bottom: "2px",
          width: "0.7rem",
          height: "0.7rem",
          "border-radius": "999px",
          background: "var(--primary)",
          color: "var(--primary-foreground)",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "font-size": "9px",
          "font-weight": "700",
          "line-height": "1",
          "pointer-events": "none",
        }}
      >
        ✓
      </div>
    </Show>
  );
}

function fxGetSwatchByValue(args: {
  palette: TThemeColorPickerPalette;
  value: string | undefined;
}) {
  const normalizedValue = normalizeSelectionValue(args.value);
  const entries = [...args.palette.fillQuick, ...args.palette.strokeQuick, ...args.palette.groups.flatMap((group) => group.swatches)];
  return entries.find((swatch) => swatch.token === normalizedValue);
}

export function ColorPicker(props: {
  value: string | undefined;
  onChange: (color: string) => void;
  showTransparent?: boolean;
  mode: TMode;
  palette: TThemeColorPickerPalette;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const quickColors = createMemo(() => {
    const next = props.mode === "fill" ? props.palette.fillQuick : props.palette.strokeQuick;
    return props.showTransparent ? next : next.filter((swatch) => swatch.token !== "@transparent");
  });
  const currentValue = createMemo(() => normalizeSelectionValue(props.value));
  const currentToken = createMemo<TThemeColorToken | undefined>(() => {
    const value = currentValue();
    return isThemeColorToken(value) ? value : undefined;
  });
  const currentSwatch = createMemo(() => fxGetSwatchByValue({ palette: props.palette, value: props.value }));
  const currentSwatchColor = createMemo(() => {
    if (currentSwatch()) {
      return currentSwatch()!.color;
    }

    if (props.value === "transparent") {
      return "transparent";
    }

    return props.value ?? FALLBACK_COLOR;
  });

  const isSelected = (token: string) => currentValue() === normalizeSelectionValue(token);
  const applyColor = (swatch: TThemeColorSwatch) => {
    props.onChange(swatch.token);
  };

  return (
    <div style={{ display: "flex", height: "1.75rem", "align-items": "center", gap: "0.25rem" }}>
      <div style={{ display: "flex", "align-items": "center", gap: "0.25rem" }}>
        <For each={quickColors()}>
          {(swatch) => (
            <button
              type="button"
              style={swatchButtonStyle({ selected: isSelected(swatch.token) })}
              title={swatch.label}
              onClick={() => applyColor(swatch)}
            >
              {renderSwatch(swatch.color, swatch.token)}
              <SelectedBadge visible={isSelected(swatch.token)} />
            </button>
          )}
        </For>
      </div>

      <div aria-hidden="true" style={{ width: "1px", height: "1.25rem", background: "var(--border)" }} />

      <button
        type="button"
        style={swatchButtonStyle({ selected: props.expanded || Boolean(currentToken()) })}
        title={currentSwatch()?.label ?? "Open color panel"}
        onClick={() => props.onExpandedChange(!props.expanded)}
      >
        {renderSwatch(currentSwatchColor(), currentSwatch()?.token ?? currentValue())}
        <SelectedBadge visible={Boolean(currentToken())} />
      </button>
    </div>
  );
}

export function ColorPalettePanel(props: {
  value: string | undefined;
  onChange: (color: string) => void;
  palette: TThemeColorPickerPalette;
}) {
  const currentValue = createMemo(() => normalizeSelectionValue(props.value));
  const isSelected = (token: string) => currentValue() === normalizeSelectionValue(token);

  return (
    <div
      style={{
        width: "230px",
        height: "24rem",
        "box-sizing": "border-box",
        border: "1px solid var(--border)",
        background: "var(--popover)",
        "box-shadow": "0 6px 18px rgba(0, 0, 0, 0.12)",
        padding: "0.75rem",
        display: "flex",
        "flex-direction": "column",
        gap: "0.75rem",
        overflow: "auto",
      }}
    >
      <For each={props.palette.groups}>
        {(group) => (
          <div style={{ display: "flex", "flex-direction": "column", gap: "0.25rem" }}>
            {sectionTitle(group.label)}
            <div style={{ display: "grid", "grid-template-columns": "repeat(5, minmax(0, 1fr))", gap: "0.25rem" }}>
              <For each={group.swatches}>
                {(swatch) => (
                  <button
                    type="button"
                    style={swatchButtonStyle({ selected: isSelected(swatch.token) })}
                    title={swatch.label}
                    onClick={() => props.onChange(swatch.token)}
                  >
                    {renderSwatch(swatch.color, swatch.token)}
                    <SelectedBadge visible={isSelected(swatch.token)} />
                  </button>
                )}
              </For>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}
