import type { TTool, TToolIcon } from "../../services/tool/types";

export type TToolGroupDefinition = {
  icon: TToolIcon;
  label?: string;
};

export type TToolbarToolSlot = {
  type: "tool";
  key: string;
  tool: TTool;
  estimatedHeight: number;
};

export type TToolbarGroupSlot = {
  type: "group";
  key: string;
  group: string;
  label: string;
  icon: TToolIcon;
  tools: TTool[];
  active: boolean;
  estimatedHeight: number;
};

export type TToolbarSlot = TToolbarToolSlot | TToolbarGroupSlot;

export type TToolbarColumnLayout = {
  columns: TToolbarSlot[][];
  needsScroll: boolean;
};

type TFnBuildToolbarSlotsArgs = {
  tools: TTool[];
  activeToolId: string;
  definitions: Readonly<Record<string, TToolGroupDefinition>>;
  toolHeight: number;
  wideToolHeight: number;
};

function fnEstimateToolHeight(tool: TTool, toolHeight: number, wideToolHeight: number) {
  const hasWideShortcut = tool.shortcuts?.some((shortcut) => shortcut.length > 3) ?? false;
  return hasWideShortcut ? wideToolHeight : toolHeight;
}

export function fnBuildToolbarSlots(args: TFnBuildToolbarSlotsArgs): TToolbarSlot[] {
  const groupedTools = new Map<string, TTool[]>();

  for (const tool of args.tools) {
    const group = tool.group?.trim();
    if (!group || !args.definitions[group]) {
      continue;
    }

    const members = groupedTools.get(group) ?? [];
    members.push(tool);
    groupedTools.set(group, members);
  }

  const emittedGroups = new Set<string>();
  const slots: TToolbarSlot[] = [];

  for (const tool of args.tools) {
    const group = tool.group?.trim();
    const members = group && args.definitions[group] ? groupedTools.get(group) : undefined;

    if (!group || !members || members.length < 2) {
      slots.push({
        type: "tool",
        key: `tool:${tool.id}`,
        tool,
        estimatedHeight: fnEstimateToolHeight(tool, args.toolHeight, args.wideToolHeight),
      });
      continue;
    }

    if (emittedGroups.has(group)) {
      continue;
    }

    emittedGroups.add(group);
    const definition = args.definitions[group];
    slots.push({
      type: "group",
      key: `group:${group}`,
      group,
      label: definition.label?.trim() || group,
      icon: definition.icon,
      tools: members,
      active: members.some((member) => member.id === args.activeToolId || Boolean(member.active)),
      estimatedHeight: args.toolHeight,
    });
  }

  return slots;
}

type TFnBuildToolbarColumnsArgs = {
  slots: TToolbarSlot[];
  availableHeight: number;
  maxColumns: number;
};

export function fnBuildToolbarColumns(args: TFnBuildToolbarColumnsArgs): TToolbarColumnLayout {
  if (args.slots.length === 0) {
    return { columns: [[]], needsScroll: false };
  }

  const availableHeight = Math.max(1, args.availableHeight);
  const maxColumns = Math.max(1, Math.floor(args.maxColumns));
  const totalHeight = args.slots.reduce((height, slot) => height + slot.estimatedHeight, 0);
  const columnCount = Math.min(maxColumns, Math.max(1, Math.ceil(totalHeight / availableHeight)));
  const columns: TToolbarSlot[][] = [];
  let slotIndex = 0;
  let remainingHeight = totalHeight;

  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    const column: TToolbarSlot[] = [];
    const remainingColumns = columnCount - columnIndex;
    const targetHeight = remainingHeight / remainingColumns;
    let columnHeight = 0;

    while (slotIndex < args.slots.length) {
      const remainingSlots = args.slots.length - slotIndex;
      if (column.length > 0 && remainingSlots <= remainingColumns - 1) {
        break;
      }

      const slot = args.slots[slotIndex];
      if (column.length > 0 && columnHeight >= targetHeight) {
        break;
      }

      column.push(slot);
      columnHeight += slot.estimatedHeight;
      slotIndex += 1;
    }

    columns.push(column);
    remainingHeight -= columnHeight;
  }

  const columnHeights = columns.map((column) => {
    return column.reduce((height, slot) => height + slot.estimatedHeight, 0);
  });

  return {
    columns,
    needsScroll: columnHeights.some((height) => height > availableHeight),
  };
}
