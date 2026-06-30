import { For } from "solid-js";
import { LINE_TYPES, type TLineType } from "./types";

export function LineTypePicker(props: {
  value: TLineType | undefined;
  onChange: (lineType: TLineType) => void;
}) {
  return (
    <div style={{ display: "flex", gap: "0.25rem", "flex-wrap": "wrap" }}>
      <For each={LINE_TYPES}>
        {(option) => (
          <button
            type="button"
            style={{
              height: "1.875rem",
              padding: "0 0.625rem",
              border: `1px solid ${props.value === option.value ? "var(--primary)" : "var(--border)"}`,
              background: props.value === option.value ? "var(--accent)" : "var(--background)",
              color: "var(--foreground)",
              "font-size": "0.6875rem",
              "font-family": "var(--font-mono)",
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
