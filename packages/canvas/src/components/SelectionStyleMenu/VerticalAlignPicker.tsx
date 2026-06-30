import { For } from "solid-js";

const OPTIONS = [
  { label: "Top", value: "top" },
  { label: "Middle", value: "middle" },
  { label: "Bottom", value: "bottom" },
] as const satisfies Array<{ label: string; value: "top" | "middle" | "bottom" }>;

export function VerticalAlignPicker(props: {
  value: "top" | "middle" | "bottom" | undefined;
  onChange: (value: "top" | "middle" | "bottom") => void;
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
