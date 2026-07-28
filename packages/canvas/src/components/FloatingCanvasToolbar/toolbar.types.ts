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
  | 'eraser';

export type TCanvasToolDefinition = Readonly<{
  id: TCanvasToolId;
  label: string;
  shortcuts?: readonly string[];
  Icon: Component<Readonly<{ size?: number }>>;
}>;
