import { TOOLS, type TTool } from "../FloatingCanvasToolbar/toolbar.types";

export type THelpShortcutItem = {
  label: string;
  keys?: string[];
  note?: string;
};

export type THelpSection = {
  title: string;
  items: THelpShortcutItem[];
};

const TOOL_LABELS: Record<TTool, string> = {
  hand: "Hand",
  select: "Select",
  rect: "Rectangle",
  diamond: "Diamond",
  ellipse: "Ellipse",
  arrow: "Arrow",
  line: "Line",
  pen: "Pen",
  text: "Text",
  image: "Image",
  browser: "Browser",
};

const TOOL_SHORTCUT_LABELS = TOOLS.map((tool) => ({
  label: TOOL_LABELS[tool.tool],
  keys: [tool.shortcut, tool.letterShortcut]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toUpperCase()),
  note: tool.tool === "select" ? "Esc also returns to select" : undefined,
}));

export const HELP_SECTIONS: THelpSection[] = [
  {
    title: "Tools",
    items: TOOL_SHORTCUT_LABELS,
  },
  {
    title: "Canvas",
    items: [
      { label: "Pan viewport", keys: ["Wheel"] },
      { label: "Zoom at pointer", keys: ["Ctrl", "Wheel"] },
      { label: "Temporary hand tool", keys: ["Space"] },
      { label: "Toggle grid", keys: ["G"] },
      { label: "Toggle sidebar", keys: ["Cmd/Ctrl", "B"] },
      { label: "Open help", keys: ["?"] },
    ],
  },
  {
    title: "Selection And History",
    items: [
      { label: "Marquee select", note: "Drag on empty canvas" },
      { label: "Add or remove selection", keys: ["Shift", "Click"] },
      { label: "Drill into nested groups", note: "Double click selected group content" },
      { label: "Group selection", keys: ["Cmd/Ctrl", "G"] },
      { label: "Ungroup selection", keys: ["Cmd/Ctrl", "Shift", "G"] },
      { label: "Duplicate by drag", keys: ["Alt", "Drag"] },
      { label: "Undo", keys: ["Cmd/Ctrl", "Z"] },
      { label: "Redo", keys: ["Cmd/Ctrl", "Shift", "Z"] },
    ],
  },
];

export const HELP_CALLOUT =
  "Tools shown here reflect the current toolbar. Rectangle, selection, grouping, and history are the most complete workflows today.";
