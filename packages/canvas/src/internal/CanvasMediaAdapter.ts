import { createImageDropController, type IStandardCanvasEditor } from '@omnidraw/cangine/editor';
import type { IEditorImageImportPort } from '@omnidraw/cangine/editor';
import { CANVAS_RUNTIME_CONTENT_LAYER_ID } from './cangine-contract-adapter';

/** Concrete DOM/file-drop binding; upload policy remains in document authority. */
export function createCanvasImageDropAdapter(args: Readonly<{
  editor: IStandardCanvasEditor;
  container: HTMLDivElement;
  input: HTMLInputElement;
  imageImportPort: IEditorImageImportPort;
  onError(error: unknown): void;
}>) {
  return createImageDropController({
    editor: args.editor,
    dropTarget: args.container,
    fileInput: args.input,
    parentId: CANVAS_RUNTIME_CONTENT_LAYER_ID,
    imageImportPort: args.imageImportPort,
    onError: args.onError,
  });
}
