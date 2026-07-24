import type {
  THitResult,
  TInputDisposition,
  TInputEvent,
  TVec2,
} from "@vibecanvas/canvas-engine";
import { fnNormalizeCanvasKeyEvent } from "./fn.normalize-event";
import {
  fnNormalizeCanvasPointerEvent,
  fnNormalizeCanvasWheelEvent,
} from "./fn.normalize-event";
import {
  fnResolveCanvasSemanticHit,
  fnResolveUniqueCanvasSemanticHits,
} from "./fn.semantic-hit";
import type {
  TCanvasInputAdapterConfig,
  TCanvasInputDiagnostic,
  TCanvasInputEvent,
  TCanvasInputListener,
  TCanvasSemanticHitPolicy,
  TCanvasSemanticHitQuery,
  TCanvasSemanticRectQuery,
} from "./typed";

function mergeDisposition(
  current: TInputDisposition,
  next: TInputDisposition,
): TInputDisposition {
  const merged: TInputDisposition = {
    handled: current.handled === true || next.handled === true,
    preventDefault:
      current.preventDefault === true || next.preventDefault === true,
    stopPropagation:
      current.stopPropagation === true || next.stopPropagation === true,
  };
  if (next.capturePointer === true && next.releasePointer !== true) {
    merged.capturePointer = true;
    merged.releasePointer = false;
  } else if (next.releasePointer === true && next.capturePointer !== true) {
    merged.capturePointer = false;
    merged.releasePointer = true;
  } else {
    merged.capturePointer = current.capturePointer;
    merged.releasePointer = current.releasePointer;
  }
  return merged;
}

export class CanvasInputAdapter {
  readonly #config: TCanvasInputAdapterConfig;
  readonly #listeners = new Set<TCanvasInputListener>();
  readonly #explicitCaptures = new Map<number, string>();
  #unsubscribeEngine: (() => void) | null;
  #focused = false;
  #destroyed = false;

  constructor(config: TCanvasInputAdapterConfig) {
    this.#config = config;
    this.#unsubscribeEngine = config.input.subscribe((event) => {
      return this.#onEngineInput(event);
    });
  }

  subscribe(listener: TCanvasInputListener): () => void {
    this.#assertActive();
    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      this.#listeners.delete(listener);
    };
  }

  hitTestViewport(query: TCanvasSemanticHitQuery) {
    this.#assertActive();
    const hits = this.#config.input.hitTestViewport(
      query.point,
      query.options,
    );
    return this.#resolveHits(hits, query.policy);
  }

  hitTestWorld(query: TCanvasSemanticHitQuery) {
    this.#assertActive();
    const hits = this.#config.input.hitTestWorld(query.point, query.options);
    return this.#resolveHits(hits, query.policy);
  }

  queryWorldRect(query: TCanvasSemanticRectQuery) {
    this.#assertActive();
    const hits = this.#config.input.queryWorldRect(query.rect, query.options);
    return this.#resolveHits(hits, query.policy);
  }

  capturePointer(pointerId: number, owner: string): void {
    this.#assertActive();
    const currentOwner = this.#explicitCaptures.get(pointerId);
    if (currentOwner === owner) {
      return;
    }
    if (currentOwner !== undefined) {
      this.#config.input.releasePointer(pointerId, currentOwner);
    }
    this.#config.input.capturePointer(pointerId, owner);
    this.#explicitCaptures.set(pointerId, owner);
  }

  releasePointer(pointerId: number, owner: string): void {
    this.#assertActive();
    if (this.#explicitCaptures.get(pointerId) !== owner) {
      return;
    }
    this.#config.input.releasePointer(pointerId, owner);
    this.#explicitCaptures.delete(pointerId);
  }

  focus(): void {
    this.#assertActive();
    if (this.#focused) {
      return;
    }
    this.#config.input.focus();
    this.#focused = true;
  }

  blur(): void {
    this.#assertActive();
    if (!this.#focused) {
      return;
    }
    this.#config.input.blur();
    this.#focused = false;
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    const captures = [...this.#explicitCaptures];
    this.#explicitCaptures.clear();
    for (const [pointerId, owner] of captures) {
      try {
        this.#config.input.releasePointer(pointerId, owner);
      } catch (error) {
        this.#reportError(error, {
          operation: "release-pointer",
          pointerId,
          owner,
        });
      }
    }
    if (this.#focused) {
      this.#focused = false;
      try {
        this.#config.input.blur();
      } catch (error) {
        this.#reportError(error, { operation: "blur" });
      }
    }
    const unsubscribe = this.#unsubscribeEngine;
    this.#unsubscribeEngine = null;
    try {
      unsubscribe?.();
    } catch (error) {
      this.#reportError(error, { operation: "unsubscribe" });
    }
    this.#listeners.clear();
  }

  #resolveHits(
    hits: readonly THitResult[],
    policy?: TCanvasSemanticHitPolicy,
  ) {
    const index = this.#config.getProjectionIndex();
    if (index === null) {
      return [];
    }
    return fnResolveUniqueCanvasSemanticHits({
      hits,
      index,
      document: this.#config.getDocument(),
      worldToViewport: this.#config.worldToViewport,
      policy: policy ?? this.#config.policy,
      resolveTransientTarget: this.#config.resolveTransientTarget,
    });
  }

  #resolveEvent(event: TInputEvent): TCanvasInputEvent | null {
    if (event.type === "key-down" || event.type === "key-up") {
      return fnNormalizeCanvasKeyEvent({ event });
    }
    if (event.type === "wheel") {
      return fnNormalizeCanvasWheelEvent({
        event,
        hit: this.#resolveHit(event.hit, event.viewport),
      });
    }
    if (
      event.type === "pointer-down"
      || event.type === "pointer-move"
      || event.type === "pointer-up"
      || event.type === "pointer-cancel"
      || event.type === "pointer-enter"
      || event.type === "pointer-leave"
    ) {
      return fnNormalizeCanvasPointerEvent({
        event,
        hit: this.#resolveHit(event.hit, event.viewport),
      });
    }
    return null;
  }

  #resolveHit(hit: THitResult | null, viewport: TVec2) {
    const index = this.#config.getProjectionIndex();
    return index === null
      ? null
      : fnResolveCanvasSemanticHit({
          hit,
          viewport,
          index,
          document: this.#config.getDocument(),
          policy: this.#config.policy,
          resolveTransientTarget: this.#config.resolveTransientTarget,
        });
  }

  #onEngineInput(event: TInputEvent): TInputDisposition | void {
    const normalized = this.#resolveEvent(event);
    if (normalized === null) {
      return;
    }
    let aggregate: TInputDisposition | undefined;
    for (const listener of [...this.#listeners]) {
      if (!this.#listeners.has(listener)) {
        continue;
      }
      let disposition: TInputDisposition | void;
      try {
        disposition = listener(normalized);
      } catch (error) {
        this.#reportError(error, { operation: "listener" });
        continue;
      }
      if (disposition === undefined) {
        continue;
      }
      aggregate = mergeDisposition(aggregate ?? {}, disposition);
      if (disposition.stopPropagation === true) {
        break;
      }
    }
    return aggregate;
  }

  #assertActive(): void {
    if (this.#destroyed) {
      throw new Error("CanvasInputAdapter has been destroyed.");
    }
  }

  #reportError(error: unknown, diagnostic: TCanvasInputDiagnostic): void {
    try {
      this.#config.onError?.(error, diagnostic);
    } catch {
      // Diagnostics must never interrupt input dispatch or lifecycle cleanup.
    }
  }
}
