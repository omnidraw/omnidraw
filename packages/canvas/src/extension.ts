import type {
  IInfiniteCanvasEngine,
  TSceneNode,
} from '@omnidraw/cangine';
import type {
  IStandardCanvasEditor,
  IWidgetInteractionController,
  TStandardNodeCreationContext,
} from '@omnidraw/cangine/editor';
import type { CanvasDocumentService } from './services/CanvasDocumentService';
import type { TCanvasRuntimeConfig } from './types';
import type { TReproductionTraceSink } from './debug-trace/typed';
import type {
  TCanvasOverlayOwnership,
  TCanvasShellState,
} from './fn.canvas-shell';

export type TCanvasShellProjectionPort = Readonly<{
  state(): TCanvasShellState;
  owns(ownership: TCanvasOverlayOwnership): boolean;
  subscribe(listener: (state: TCanvasShellState) => void): () => void;
  registerOverlay(contribution: TCanvasOverlayContribution): () => void;
}>;

/** An extension must unmount or mount its host overlay when this callback changes. */
export type TCanvasOverlayContribution = Readonly<{
  ownership: TCanvasOverlayOwnership;
  setMounted(mounted: boolean): void;
}>;

/** Public runtime facts exposed to extensions; product services stay captured by the host. */
export type TCanvasRuntimeExtensionConfig = Readonly<Pick<
  TCanvasRuntimeConfig,
  'canvasId' | 'container' | 'notification'
>>;

export type TCanvasRuntimeExtensionContext = Readonly<{
  config: TCanvasRuntimeExtensionConfig;
  document: CanvasDocumentService;
  editor: IStandardCanvasEditor;
  engine: IInfiniteCanvasEngine;
  trace: TReproductionTraceSink | null;
  widgets: IWidgetInteractionController;
  shell: TCanvasShellProjectionPort;
}>;

export type TCanvasRuntimeExtensionInstall = Readonly<{
  dispose?(): void | Promise<void>;
}>;

export interface ICanvasRuntimeExtension {
  readonly name: string;
  createWidgetNodes?(
    context: Readonly<{
      config: TCanvasRuntimeExtensionConfig;
      creation: TStandardNodeCreationContext;
      engine: IInfiniteCanvasEngine;
    }>,
  ): readonly TSceneNode[] | null;
  install(
    context: TCanvasRuntimeExtensionContext,
  ): TCanvasRuntimeExtensionInstall | Promise<TCanvasRuntimeExtensionInstall>;
}
