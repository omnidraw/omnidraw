export type ThemeId = string;

export type TThemeColors = {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  muted: string;
  mutedForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  success: string;
  successForeground: string;
  warning: string;
  warningForeground: string;
  border: string;
  input: string;
  ring: string;
  canvasBackground: string;
  canvasGridMinor: string;
  canvasGridMajor: string;
  canvasSelectionFill: string;
  canvasSelectionStroke: string;
  canvasGroupBoundary: string;
  canvasDebugText: string;
  canvasText: string;
  canvasTextEditorOutline: string;
  terminalBackground: string;
  terminalForeground: string;
  terminalCursor: string;
  terminalSelectionBackground: string;
  terminalErrorForeground: string;
};

export type TThemeDefinition = {
  id: ThemeId;
  label: string;
  appearance: "light" | "dark";
  colors: TThemeColors;
};

export const THEME_ID_LIGHT = "light" satisfies ThemeId;
export const THEME_ID_DARK = "dark" satisfies ThemeId;
export const THEME_ID_SEPIA = "sepia" satisfies ThemeId;
export const THEME_ID_GRAPHITE = "graphite" satisfies ThemeId;
export const DEFAULT_THEME_ID = THEME_ID_LIGHT;

export const BUILTIN_THEMES: TThemeDefinition[] = [
  {
    id: THEME_ID_LIGHT,
    label: "Light",
    appearance: "light",
    colors: {
      background: "#fafaf9",
      foreground: "#1c1917",
      card: "#f5f5f4",
      cardForeground: "#1c1917",
      popover: "#ffffff",
      popoverForeground: "#1c1917",
      muted: "#e7e5e4",
      mutedForeground: "#57534e",
      primary: "#f59e0b",
      primaryForeground: "#0c0a09",
      secondary: "#e7e5e4",
      secondaryForeground: "#1c1917",
      accent: "#fef3c7",
      accentForeground: "#78350f",
      destructive: "#dc2626",
      destructiveForeground: "#fafaf9",
      success: "#16a34a",
      successForeground: "#fafaf9",
      warning: "#d97706",
      warningForeground: "#0c0a09",
      border: "#d6d3d1",
      input: "#d6d3d1",
      ring: "#f59e0b",
      canvasBackground: "rgba(168, 162, 158, 0.10)",
      canvasGridMinor: "rgba(71, 85, 105, 0.16)",
      canvasGridMajor: "rgba(71, 85, 105, 0.28)",
      canvasSelectionFill: "rgba(59, 130, 246, 0.12)",
      canvasSelectionStroke: "#3b82f6",
      canvasGroupBoundary: "#1e1e1e",
      canvasDebugText: "rgba(71, 85, 105, 0.80)",
      canvasText: "#000000",
      canvasTextEditorOutline: "#3b82f6",
      terminalBackground: "#111214",
      terminalForeground: "#e5e7eb",
      terminalCursor: "#f59e0b",
      terminalSelectionBackground: "#374151",
      terminalErrorForeground: "#fecaca"
    }
  },
  {
    id: THEME_ID_DARK,
    label: "Dark",
    appearance: "dark",
    colors: {
      background: "#0c0a09",
      foreground: "#fafaf9",
      card: "#1c1917",
      cardForeground: "#fafaf9",
      popover: "#1c1917",
      popoverForeground: "#fafaf9",
      muted: "#292524",
      mutedForeground: "#a8a29e",
      primary: "#f59e0b",
      primaryForeground: "#0c0a09",
      secondary: "#292524",
      secondaryForeground: "#fafaf9",
      accent: "#44403c",
      accentForeground: "#fcd34d",
      destructive: "#ef4444",
      destructiveForeground: "#fafaf9",
      success: "#22c55e",
      successForeground: "#0c0a09",
      warning: "#fbbf24",
      warningForeground: "#0c0a09",
      border: "#292524",
      input: "#292524",
      ring: "#f59e0b",
      canvasBackground: "rgba(12, 10, 9, 0.92)",
      canvasGridMinor: "rgba(148, 163, 184, 0.16)",
      canvasGridMajor: "rgba(148, 163, 184, 0.28)",
      canvasSelectionFill: "rgba(96, 165, 250, 0.18)",
      canvasSelectionStroke: "#60a5fa",
      canvasGroupBoundary: "#e7e5e4",
      canvasDebugText: "rgba(214, 211, 209, 0.72)",
      canvasText: "#fafaf9",
      canvasTextEditorOutline: "#60a5fa",
      terminalBackground: "#111214",
      terminalForeground: "#e5e7eb",
      terminalCursor: "#f59e0b",
      terminalSelectionBackground: "#374151",
      terminalErrorForeground: "#fecaca"
    }
  },
  {
    id: THEME_ID_SEPIA,
    label: "Sepia",
    appearance: "light",
    colors: {
      background: "#f8f1e5",
      foreground: "#433422",
      card: "#f2e8d8",
      cardForeground: "#433422",
      popover: "#fff8ed",
      popoverForeground: "#433422",
      muted: "#eadcc7",
      mutedForeground: "#7c6549",
      primary: "#c17b2e",
      primaryForeground: "#fff8ed",
      secondary: "#eadcc7",
      secondaryForeground: "#433422",
      accent: "#f3e1b7",
      accentForeground: "#6a4518",
      destructive: "#b8573d",
      destructiveForeground: "#fff8ed",
      success: "#4f8a4b",
      successForeground: "#fff8ed",
      warning: "#b7791f",
      warningForeground: "#2a1c0c",
      border: "#d7c3a1",
      input: "#d7c3a1",
      ring: "#c17b2e",
      canvasBackground: "rgba(215, 195, 161, 0.20)",
      canvasGridMinor: "rgba(124, 101, 73, 0.14)",
      canvasGridMajor: "rgba(124, 101, 73, 0.24)",
      canvasSelectionFill: "rgba(193, 123, 46, 0.16)",
      canvasSelectionStroke: "#c17b2e",
      canvasGroupBoundary: "#6b4f2d",
      canvasDebugText: "rgba(67, 52, 34, 0.68)",
      canvasText: "#362718",
      canvasTextEditorOutline: "#c17b2e",
      terminalBackground: "#241d17",
      terminalForeground: "#f6e7cf",
      terminalCursor: "#d6a14d",
      terminalSelectionBackground: "#5d4630",
      terminalErrorForeground: "#fecaca"
    }
  },
  {
    id: THEME_ID_GRAPHITE,
    label: "Graphite",
    appearance: "dark",
    colors: {
      background: "#111827",
      foreground: "#f3f4f6",
      card: "#1f2937",
      cardForeground: "#f3f4f6",
      popover: "#1f2937",
      popoverForeground: "#f3f4f6",
      muted: "#334155",
      mutedForeground: "#94a3b8",
      primary: "#f59e0b",
      primaryForeground: "#111827",
      secondary: "#334155",
      secondaryForeground: "#f3f4f6",
      accent: "#374151",
      accentForeground: "#fbbf24",
      destructive: "#f87171",
      destructiveForeground: "#111827",
      success: "#4ade80",
      successForeground: "#111827",
      warning: "#fbbf24",
      warningForeground: "#111827",
      border: "#374151",
      input: "#374151",
      ring: "#f59e0b",
      canvasBackground: "rgba(15, 23, 42, 0.92)",
      canvasGridMinor: "rgba(148, 163, 184, 0.16)",
      canvasGridMajor: "rgba(148, 163, 184, 0.30)",
      canvasSelectionFill: "rgba(96, 165, 250, 0.18)",
      canvasSelectionStroke: "#60a5fa",
      canvasGroupBoundary: "#cbd5e1",
      canvasDebugText: "rgba(203, 213, 225, 0.72)",
      canvasText: "#f3f4f6",
      canvasTextEditorOutline: "#60a5fa",
      terminalBackground: "#0b1120",
      terminalForeground: "#e5e7eb",
      terminalCursor: "#f59e0b",
      terminalSelectionBackground: "#334155",
      terminalErrorForeground: "#fecaca"
    }
  }
];
