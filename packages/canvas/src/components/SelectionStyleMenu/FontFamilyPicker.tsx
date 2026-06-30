import { For } from "solid-js";
import { FONT_FAMILIES, type TFontFamily } from "./types";

export function FontFamilyPicker(props: {
  value: TFontFamily | undefined;
  onChange: (family: TFontFamily) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "repeat(3, minmax(0, 1fr))",
        gap: "0.25rem",
      }}
    >
      <For each={FONT_FAMILIES}>
        {(option) => (
          <button
            type="button"
            style={{
              height: "1.875rem",
              border: `1px solid ${props.value === option.value ? "var(--primary)" : "var(--border)"}`,
              background: props.value === option.value ? "var(--accent)" : "var(--background)",
              color: "var(--foreground)",
              "font-size": "0.6875rem",
            }}
            title={option.name}
            onClick={() => props.onChange(option.value)}
          >
            {option.name}
          </button>
        )}
      </For>
    </div>
  );
}
