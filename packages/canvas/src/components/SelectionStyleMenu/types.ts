export const DEFAULT_STROKE_WIDTHS = [
  { name: "Thin", value: "@stroke-width/thin" },
  { name: "Medium", value: "@stroke-width/medium" },
  { name: "Thick", value: "@stroke-width/thick" },
] as const;

export const PEN_STROKE_WIDTHS = [
  { name: "Medium", value: "@stroke-width/medium" },
  { name: "Thick", value: "@stroke-width/thick" },
  { name: "Heavy", value: "@stroke-width/heavy" },
] as const;

export const FONT_FAMILIES = [
  { name: "Sans", value: "Arial, sans-serif" },
  { name: "Mono", value: "monospace" },
  { name: "Serif", value: "Georgia, serif" },
] as const;

export const LINE_TYPES = [
  { name: "Straight", value: "straight" },
  { name: "Curved", value: "curved" },
] as const;

export const CAP_STYLES = [
  { name: "None", value: "none" },
  { name: "Arrow", value: "arrow" },
  { name: "Dot", value: "dot" },
  { name: "Diamond", value: "diamond" },
] as const;

export type TStrokeWidthOption = {
  name: string;
  value: string;
};

export type TFontFamily = typeof FONT_FAMILIES[number]["value"];
export type TLineType = typeof LINE_TYPES[number]["value"];
export type TCapStyle = typeof CAP_STYLES[number]["value"];
