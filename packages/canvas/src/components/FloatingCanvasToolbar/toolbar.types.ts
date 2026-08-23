import type { Component } from 'solid-js';

export type TCanvasStandardToolId =
  | 'select'
  | 'hand'
  | 'rect'
  | 'ellipse'
  | 'pen'
  | 'text'
  | 'connector'
  | 'arrow'
  | 'widget'
  | 'eraser';

export type TCanvasToolId = Exclude<TCanvasStandardToolId, 'widget'>;

export type TCanvasToolDefinition = Readonly<{
  id: TCanvasToolId;
  label: string;
  shortcuts?: readonly string[];
  Icon: Component<Readonly<{ size?: number }>>;
}>;

export type TCanvasKeyboardShortcut = Readonly<{
  key: string;
  label: string;
  /** Matches Ctrl on Windows/Linux and Command on macOS. */
  primary?: boolean;
  alt?: boolean;
  shift?: boolean;
}>;

type TCanvasToolbarContributionBase = Readonly<{
  id: string;
  label: string;
  Icon: Component<Readonly<{ size?: number }>>;
  shortcuts?: readonly TCanvasKeyboardShortcut[];
}>;

/** A host-named button that activates an editor tool such as a product tool. */
export type TCanvasToolbarToolContribution =
  TCanvasToolbarContributionBase & Readonly<{
    kind: 'tool';
    toolId: TCanvasStandardToolId;
  }>;

/** A host-owned action. Persistent actions remain visible when tools collapse. */
export type TCanvasToolbarActionContribution =
  TCanvasToolbarContributionBase & Readonly<{
    kind: 'action';
    placement?: 'tools' | 'persistent';
    active?(): boolean;
    attention?(): boolean;
    onActivate(): void;
  }>;

export type TCanvasToolbarContribution =
  | TCanvasToolbarToolContribution
  | TCanvasToolbarActionContribution;
