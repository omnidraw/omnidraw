import type { Component } from 'solid-js';

export type TCanvasToolId =
  | 'hand'
  | 'select'
  | 'rect'
  | 'ellipse'
  | 'pen'
  | 'text'
  | 'connector'
  | 'arrow'
  | 'widget'
  | 'eraser';

export type TCanvasToolDefinition = Readonly<{
  id: TCanvasToolId;
  label: string;
  shortcut?: string;
  Icon: Component<Readonly<{ size?: number }>>;
}>;
