/**
 * Toolbar Types
 * Type definitions for the floating drawing toolbar
 */

export type TTool =
  | "hand"
  | "select"
  | "rect"
  | "diamond"
  | "ellipse"
  | "arrow"
  | "line"
  | "pen"
  | "text"
  | "image"
  | "filesystem"
  | "terminal"
  | "browser";

export interface IToolDefinition {
  tool: TTool;
  shortcut?: string;
  letterShortcut?: string;
}

/** Maps keyboard shortcut keys to tools */
export const TOOL_SHORTCUTS: Record<string, TTool> = {
  // Number shortcuts
  "1": "select",
  "2": "rect",
  "3": "diamond",
  "4": "ellipse",
  "5": "arrow",
  "6": "line",
  "7": "pen",
  "8": "text",
  "9": "image",
  // Letter shortcuts
  "h": "hand",
  "r": "rect",
  "d": "diamond",
  "o": "ellipse",
  "a": "arrow",
  "l": "line",
  "p": "pen",
  "t": "text",
  "f": "filesystem",
  "j": "terminal",
  "w": "browser",
  "Escape": "select",
} as const;

/** Ordered list of tools with their shortcuts */
export const TOOLS: IToolDefinition[] = [
  { tool: "hand", letterShortcut: "h" },
  { tool: "select", shortcut: "1", letterShortcut: "esc" },
  { tool: "rect", shortcut: "2", letterShortcut: "r" },
  { tool: "diamond", shortcut: "3", letterShortcut: "d" },
  { tool: "ellipse", shortcut: "4", letterShortcut: "o" },
  { tool: "arrow", shortcut: "5", letterShortcut: "a" },
  { tool: "line", shortcut: "6", letterShortcut: "l" },
  { tool: "pen", shortcut: "7", letterShortcut: "p" },
  { tool: "text", shortcut: "8", letterShortcut: "t" },
  { tool: "image", shortcut: "9" },
  { tool: "filesystem", letterShortcut: "f" },
  { tool: "terminal", letterShortcut: "j" },
  { tool: "browser", letterShortcut: "w" },
];
