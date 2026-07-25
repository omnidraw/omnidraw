import type { IEditorHistory } from "@omnidraw/cangine/editor";

export type TCanvasEditorHistoryPort = {
  canUndo(): boolean;
  canRedo(): boolean;
  retainedWeight(): number;
  subscribe(listener: () => void): () => void;
  undo(): boolean;
  redo(): boolean;
  clear(): void;
};

/**
 * Presents authoritative Vibecanvas CRDT history through Cangine's replaceable
 * editor history contract. It never records or replays engine scene changes.
 */
export class CanvasEditorHistoryAdapter implements IEditorHistory {
  readonly #port: TCanvasEditorHistoryPort;
  #destroyed = false;

  constructor(port: TCanvasEditorHistoryPort) {
    this.#port = port;
  }

  get canUndo(): boolean {
    return !this.#destroyed && this.#port.canUndo();
  }

  get canRedo(): boolean {
    return !this.#destroyed && this.#port.canRedo();
  }

  get retainedWeight(): number {
    return this.#destroyed ? 0 : this.#port.retainedWeight();
  }

  attach(): void {
    this.#assertActive();
  }

  detach(): void {
    // The application history service outlives the editor attachment.
  }

  subscribe(listener: () => void): () => void {
    this.#assertActive();
    return this.#port.subscribe(listener);
  }

  beginCoalescing(_key: string): void {
    this.#assertActive();
    // Product operations already choose their CRDT history grouping.
  }

  endCoalescing(_key?: string): void {
    this.#assertActive();
  }

  undo(): boolean {
    this.#assertActive();
    return this.#port.undo();
  }

  redo(): boolean {
    this.#assertActive();
    return this.#port.redo();
  }

  clear(): void {
    this.#assertActive();
    this.#port.clear();
  }

  destroy(): void {
    this.#destroyed = true;
  }

  #assertActive(): void {
    if (this.#destroyed) {
      throw new Error("Canvas editor history adapter is destroyed.");
    }
  }
}
