export type TFontSizePreset = "S" | "M" | "L" | "XL";
export type TTextAlign = "left" | "center" | "right";
export type TVerticalAlign = "top" | "middle" | "bottom";

export function fnGetFontSizePresetOptions() {
  return [
    { label: "S", value: "S" as const, fontSize: 16 },
    { label: "M", value: "M" as const, fontSize: 20 },
    { label: "L", value: "L" as const, fontSize: 28 },
    { label: "XL", value: "XL" as const, fontSize: 36 },
  ];
}

export function fnGetFontSizePresetValue(preset: TFontSizePreset) {
  const match = fnGetFontSizePresetOptions().find((option) => option.value === preset);
  return match?.fontSize ?? 16;
}

export function fnGetNearestFontSizePreset(fontSize: number): TFontSizePreset {
  const [first, ...rest] = fnGetFontSizePresetOptions();
  let nearest = first ?? { value: "S" as const, fontSize: 16 };

  for (const option of rest) {
    if (Math.abs(option.fontSize - fontSize) < Math.abs(nearest.fontSize - fontSize)) {
      nearest = option;
    }
  }

  return nearest.value;
}

export function fnGetScaledFontSizeFromPreset(args: {
  currentFontSize: number;
  currentPreset: TFontSizePreset | undefined;
  nextPreset: TFontSizePreset;
}) {
  const resolvedCurrentPreset = args.currentPreset ?? fnGetNearestFontSizePreset(args.currentFontSize);
  const currentBaseline = fnGetFontSizePresetValue(resolvedCurrentPreset);
  const nextBaseline = fnGetFontSizePresetValue(args.nextPreset);
  const scale = currentBaseline <= 0 ? 1 : args.currentFontSize / currentBaseline;

  return Math.max(1, Math.round(nextBaseline * scale));
}

export function fnGetHorizontalTextAlignOptions() {
  return [
    { label: "L", value: "left" as const },
    { label: "C", value: "center" as const },
    { label: "R", value: "right" as const },
  ];
}

export function fnGetVerticalTextAlignOptions() {
  return [
    { label: "T", value: "top" as const },
    { label: "M", value: "middle" as const },
    { label: "B", value: "bottom" as const },
  ];
}
