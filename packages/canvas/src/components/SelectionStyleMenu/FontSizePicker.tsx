import { For } from "solid-js";
import { fnGetFontSizePresetOptions, type TFontSizePreset } from "../../core/fn.text-style";
import { TEXT_FONT_SIZE_TOKEN_BY_PRESET } from "../../plugins/text/CONSTANTS";

export function FontSizePicker(props: {
  value: string | undefined;
  onChange: (token: string) => void;
}) {
  const options = fnGetFontSizePresetOptions().map((option) => ({
    ...option,
    token: TEXT_FONT_SIZE_TOKEN_BY_PRESET[option.value as TFontSizePreset],
  }));

  return (
    <div
      style={{
        display: "grid",
        "grid-template-columns": "repeat(4, minmax(0, 1fr))",
        gap: "0.25rem",
      }}
    >
      <For each={options}>
        {(option) => (
          <button
            type="button"
            style={{
              height: "1.875rem",
              border: `1px solid ${props.value === option.token ? "var(--primary)" : "var(--border)"}`,
              background: props.value === option.token ? "var(--accent)" : "var(--background)",
              color: "var(--foreground)",
              "font-size": "0.875rem",
              "font-weight": 500,
            }}
            title={`${option.label} (${option.fontSize}px baseline)`}
            onClick={() => props.onChange(option.token)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  );
}
