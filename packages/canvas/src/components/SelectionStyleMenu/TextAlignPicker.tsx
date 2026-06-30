import { For } from "solid-js";

const OPTIONS = [
  { label: "Left", value: "left" },
  { label: "Center", value: "center" },
  { label: "Right", value: "right" },
] as const satisfies Array<{ label: string; value: "left" | "center" | "right" }>;

export function TextAlignPicker(props: {
  value: "left" | "center" | "right" | undefined;
  onChange: (value: "left" | "center" | "right") => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "repeat(3, minmax(0, 1fr))",
        gap: "0.25rem",
      }}
    >
      <For each={OPTIONS}>
        {(option) => (
          <button
            type="button"
            style={{
              height: "1.875rem",
              border: `1px solid ${props.value === option.value ? "var(--primary)" : "var(--border)"}`,
              background: props.value === option.value ? "var(--accent)" : "var(--background)",
              color: "var(--foreground)",
              "font-size": "0.6875rem",
              padding: "0 0.5rem",
            }}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}
