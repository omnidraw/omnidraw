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

export type TCanvasRuntimeExtensionContext = Readonly<{
  config: TCanvasRuntimeConfig;
  document: CanvasDocumentService;
  editor: IStandardCanvasEditor;
  engine: IInfiniteCanvasEngine;
  widgets: IWidgetInteractionController;
}>;

export type TCanvasRuntimeExtensionInstall = Readonly<{
  dispose?(): void | Promise<void>;
}>;

export interface ICanvasRuntimeExtension {
  readonly name: string;
  createWidgetNodes?(
    context: Readonly<{
      config: TCanvasRuntimeConfig;
      creation: TStandardNodeCreationContext;
      engine: IInfiniteCanvasEngine;
    }>,
  ): readonly TSceneNode[] | null;
  install(
    context: TCanvasRuntimeExtensionContext,
  ): TCanvasRuntimeExtensionInstall | Promise<TCanvasRuntimeExtensionInstall>;
}
