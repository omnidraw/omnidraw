import { For } from "solid-js";
import { CAP_STYLES, type TCapStyle } from "./types";

export function CapPicker(props: {
  value: TCapStyle | undefined;
  onChange: (capStyle: TCapStyle) => void;
  label: "START" | "END";
}) {
  return (
    <div style={{ display: "flex", gap: "0.25rem", "flex-wrap": "wrap" }}>
      <For each={CAP_STYLES}>
        {(option) => (
          <button
            type="button"
            style={{
              height: "1.875rem",
              padding: "0 0.5rem",
              border: `1px solid ${props.value === option.value ? "var(--primary)" : "var(--border)"}`,
              background: props.value === option.value ? "var(--accent)" : "var(--background)",
              color: "var(--foreground)",
              "font-size": "0.6875rem",
            }}
            title={`${props.label}: ${option.name}`}
            onClick={() => props.onChange(option.value)}
          >
            {option.name}
          </button>
        )}
      </For>
    </div>
  );
}
