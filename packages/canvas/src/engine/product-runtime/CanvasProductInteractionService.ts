import type {
  ITextEditingSession,
  TConnectorNode,
  TConnectorDraft,
  TDragDraft,
  THitResult,
  TInteractionCancelEvent,
  TMarqueeCommit,
} from "@vibecanvas/canvas-engine";
import { fnResolveCanvasSemanticHit, fnResolveUniqueCanvasSemanticHits } from "../input/fn.semantic-hit";
import {
  fnCanvasEnginePointerEvent,
  fnCanvasProductConnectorDraft,
  fnCanvasProductDragDraft,
  fnCanvasProductInteractionCancel,
  fnCanvasProductStrokeEvent,
} from "./fn.convert";
import { fnCanvasProductNodeId } from "./fn.targets";
import type { TCanvasProductRuntimeEnginePorts } from "./interface";
import type {
  TCanvasProductConnectorDraft,
  TCanvasProductConnectorOptions,
  TCanvasProductCreationOptions,
  TCanvasProductInteractionCancel,
  TCanvasProductMarqueeOptions,
  TCanvasProductPointerEvent,
  TCanvasProductStrokeOptions,
  TCanvasProductTextProjection,
  TCanvasProductTextSession,
  TCanvasProductTextSessionOptions,
} from "./typed";

type TInteractionPorts = Pick<
  TCanvasProductRuntimeEnginePorts,
  | "camera"
  | "getDocument"
  | "getProjectionIndex"
  | "interactions"
  | "onDiagnostic"
  | "transientTargets"
>;

type TCancelOverride = Extract<
  TCanvasProductInteractionCancel["reason"],
  "remote-change" | "destroy"
>;

class ProductTextSession implements TCanvasProductTextSession {
  readonly #session: ITextEditingSession;
  readonly #onDestroy: () => void;
  #destroyed = false;

  constructor(session: ITextEditingSession, onDestroy: () => void) {
    this.#session = session;
    this.#onDestroy = onDestroy;
  }

  get projection(): TCanvasProductTextProjection | null {
    const projection = this.#session.projection;
    return projection === null ? null : {
      visible: projection.visible,
      clientMatrix: [...projection.clientMatrix],
      localSize: { ...projection.localSize },
    };
  }

  sync(): void {
    this.#assertActive();
    this.#session.sync();
  }

  commit(): void {
    this.#assertActive();
    this.#session.commit();
  }

  cancel(): void {
    if (this.#destroyed) {
      return;
    }
    this.#session.cancel();
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    try {
      this.#session.destroy();
    } finally {
      this.#onDestroy();
    }
  }

  #assertActive(): void {
    if (this.#destroyed) {
      throw new Error("Canvas product text session has been destroyed.");
    }
  }
}

export class CanvasProductInteractionService {
  readonly #ports: TInteractionPorts;
  readonly #textSessions = new Set<ProductTextSession>();
  #cancelOverride: TCancelOverride | null = null;
  #destroyed = false;

  constructor(ports: TInteractionPorts) {
    this.#ports = ports;
  }

  get activeKind(): "marquee" | "create" | "stroke" | "connector" | null {
    return this.#ports.interactions.activeKind;
  }

  beginMarquee(
    event: TCanvasProductPointerEvent,
    options: TCanvasProductMarqueeOptions,
  ): void {
    this.#assertActive();
    this.#ports.interactions.beginMarquee(
      fnCanvasEnginePointerEvent(event),
      {
        thresholdViewport: options.thresholdViewport,
        constrainDraft: options.constrainDraft === undefined
          ? undefined
          : (draft) => options.constrainDraft!(
              fnCanvasProductDragDraft(draft),
            ),
        onBegin: options.onBegin === undefined
          ? undefined
          : (draft) => this.#invoke(() => {
              options.onBegin!(fnCanvasProductDragDraft(draft));
            }),
        onUpdate: options.onUpdate === undefined
          ? undefined
          : (draft) => this.#invoke(() => {
              options.onUpdate!(fnCanvasProductDragDraft(draft));
            }),
        onCommit: (commit) => this.#invoke(() => {
          options.onCommit(this.#marqueeCommit(commit));
        }),
        onCancel: options.onCancel === undefined
          ? undefined
          : (cancel) => this.#invoke(() => {
              options.onCancel!(this.#cancelEvent(cancel));
            }),
      },
    );
  }

  beginCreation(
    event: TCanvasProductPointerEvent,
    options: TCanvasProductCreationOptions,
  ): void {
    this.#assertActive();
    this.#ports.interactions.beginCreation(
      fnCanvasEnginePointerEvent(event),
      {
        thresholdViewport: options.thresholdViewport,
        constrainDraft: options.constrainDraft === undefined
          ? undefined
          : (draft) => options.constrainDraft!(
              fnCanvasProductDragDraft(draft),
            ),
        onBegin: options.onBegin === undefined
          ? undefined
          : (draft) => this.#invoke(() => {
              options.onBegin!(fnCanvasProductDragDraft(draft));
            }),
        onUpdate: options.onUpdate === undefined
          ? undefined
          : (draft) => this.#invoke(() => {
              options.onUpdate!(fnCanvasProductDragDraft(draft));
            }),
        onCommit: (commit) => this.#invoke(() => {
          options.onCommit({
            ...fnCanvasProductDragDraft(commit),
            kind: "create",
            phase: "commit",
            belowThreshold: commit.belowThreshold,
          });
        }),
        onCancel: options.onCancel === undefined
          ? undefined
          : (cancel) => this.#invoke(() => {
              options.onCancel!(this.#cancelEvent(cancel));
            }),
      },
    );
  }

  beginStroke(
    event: TCanvasProductPointerEvent,
    options: TCanvasProductStrokeOptions,
  ): void {
    this.#assertActive();
    this.#ports.interactions.beginStroke(
      fnCanvasEnginePointerEvent(event),
      {
        minDistanceViewport: options.minDistanceViewport,
        maxSamples: options.maxSamples,
        onBegin: options.onBegin === undefined
          ? undefined
          : (stroke) => this.#invoke(() => {
              options.onBegin!(fnCanvasProductStrokeEvent(stroke));
            }),
        onUpdate: options.onUpdate === undefined
          ? undefined
          : (stroke) => this.#invoke(() => {
              options.onUpdate!(fnCanvasProductStrokeEvent(stroke));
            }),
        onCommit: (stroke) => this.#invoke(() => {
          options.onCommit(fnCanvasProductStrokeEvent(stroke));
        }),
        onCancel: options.onCancel === undefined
          ? undefined
          : (cancel) => this.#invoke(() => {
              options.onCancel!(this.#cancelEvent(cancel));
            }),
      },
    );
  }

  beginConnector(
    event: TCanvasProductPointerEvent,
    options: TCanvasProductConnectorOptions,
  ): void {
    this.#assertActive();
    const sourceNodeId = options.source === undefined
      ? null
      : this.#targetNodeId(options.source);
    this.#ports.interactions.beginConnector(
      fnCanvasEnginePointerEvent(event),
      {
        thresholdViewport: options.thresholdViewport,
        constrainDraft: options.constrainDraft === undefined
          ? undefined
          : (draft) => options.constrainDraft!(
              fnCanvasProductDragDraft(draft),
            ),
        acceptCandidate: options.acceptCandidate === undefined
          ? undefined
          : (hit) => {
              const semantic = this.#semanticHit(hit);
              return semantic !== null && options.acceptCandidate!(semantic);
            },
        createPreviewNode: (draft) => {
          const semantic = this.#semanticHit(draft.candidate);
          const index = this.#ports.getProjectionIndex();
          const candidateNodeId = semantic === null || index === null
            ? null
            : fnCanvasProductNodeId({
                ref: { target: semantic.target },
                index,
              });
          return this.#connectorPreviewNode(
            draft.start.world,
            draft.current.world,
            sourceNodeId,
            candidateNodeId,
            draft.start.pointerId,
            options,
          );
        },
        onBegin: options.onBegin === undefined
          ? undefined
          : (draft) => this.#invoke(() => {
              options.onBegin!(fnCanvasProductDragDraft(draft));
            }),
        onUpdate: options.onUpdate === undefined
          ? undefined
          : (draft) => this.#invoke(() => {
              options.onUpdate!(this.#connectorDraft(draft));
            }),
        onCommit: (commit) => this.#invoke(() => {
          options.onCommit({
            ...this.#connectorDraft(commit),
            phase: "commit",
            belowThreshold: commit.belowThreshold,
          });
        }),
        onCancel: options.onCancel === undefined
          ? undefined
          : (cancel) => this.#invoke(() => {
              options.onCancel!(this.#cancelEvent(cancel));
            }),
      },
    );
  }

  createTextSession(
    options: TCanvasProductTextSessionOptions,
  ): TCanvasProductTextSession {
    this.#assertActive();
    const index = this.#ports.getProjectionIndex();
    const roles = options.role === undefined
      ? ["inline-text", "render"] as const
      : [options.role];
    const nodeId = index === null
      ? null
      : roles.reduce<string | null>((resolved, role) => {
          return resolved ?? fnCanvasProductNodeId({
            ref: {
              target: options.target,
              role,
            },
            index,
          });
        }, null);
    if (nodeId === null) {
      throw new Error("Text target is not projected.");
    }
    let wrapper: ProductTextSession;
    const session = this.#ports.interactions.createTextEditingSession({
      nodeId,
      element: options.element,
      commitOnBlur: options.commitOnBlur,
      selectOnFocus: options.selectOnFocus,
      onProjection: options.onProjection === undefined
        ? undefined
        : (projection) => this.#invoke(() => {
            options.onProjection!({
              visible: projection.visible,
              clientMatrix: [...projection.clientMatrix],
              localSize: { ...projection.localSize },
            });
          }),
      onCommit: options.onCommit === undefined
        ? undefined
        : (text) => this.#invoke(() => options.onCommit!(text)),
      onCancel: options.onCancel === undefined
        ? undefined
        : () => this.#invoke(() => options.onCancel!()),
    });
    wrapper = new ProductTextSession(session, () => {
      this.#textSessions.delete(wrapper);
    });
    this.#textSessions.add(wrapper);
    return wrapper;
  }

  cancel(): void {
    this.#assertActive();
    this.#ports.interactions.cancelActive();
  }

  cancelForRemoteChange(): void {
    this.#assertActive();
    this.#withCancelOverride("remote-change", () => {
      this.#ports.interactions.cancelActive();
    });
    for (const session of this.#textSessions) {
      session.cancel();
    }
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    let firstError: unknown;
    try {
      this.#withCancelOverride("destroy", () => {
        this.#ports.interactions.cancelActive();
      });
    } catch (error) {
      firstError = error;
      this.#report(error);
    }
    for (const session of [...this.#textSessions]) {
      try {
        session.cancel();
      } catch (error) {
        firstError ??= error;
        this.#report(error);
      }
      try {
        session.destroy();
      } catch (error) {
        firstError ??= error;
        this.#report(error);
      }
    }
    this.#textSessions.clear();
    if (firstError !== undefined) {
      throw firstError;
    }
  }

  #marqueeCommit(commit: TMarqueeCommit) {
    const index = this.#ports.getProjectionIndex();
    const hits = index === null
      ? []
      : fnResolveUniqueCanvasSemanticHits({
          hits: commit.hits,
          index,
          document: this.#ports.getDocument(),
          worldToViewport: (point) => this.#ports.camera.worldToViewport(point),
          resolveTransientTarget: this.#ports.transientTargets.resolve,
        });
    return {
      ...fnCanvasProductDragDraft(commit),
      kind: "marquee" as const,
      phase: "commit" as const,
      hits,
      belowThreshold: commit.belowThreshold,
    };
  }

  #connectorDraft(draft: TConnectorDraft): TCanvasProductConnectorDraft {
    return fnCanvasProductConnectorDraft({
      draft,
      candidate: this.#semanticHit(draft.candidate),
      route: draft.route,
    });
  }

  #connectorPreviewNode(
    start: { x: number; y: number },
    current: { x: number; y: number },
    sourceNodeId: string | null,
    candidateNodeId: string | null,
    pointerId: number,
    options: TCanvasProductConnectorOptions,
  ): TConnectorNode {
    const previewStroke = options.preview?.stroke ?? {
      color: { r: 0.1, g: 0.45, b: 0.95, a: 1 },
      width: 2,
    };
    const routing = options.preview?.routing ?? "straight";
    return {
      id: `vc:interaction:connector-preview:${pointerId}`,
      parentId: null,
      orderKey: "A",
      kind: "connector",
      transform: {
        position: { x: 0, y: 0 },
        rotation: 0,
        scale: { x: 1, y: 1 },
        skew: { x: 0, y: 0 },
        origin: { x: 0, y: 0 },
      },
      from: sourceNodeId === null
        ? { type: "point", point: { ...start } }
        : { type: "node", nodeId: sourceNodeId, anchor: "auto" },
      to: candidateNodeId === null
        ? { type: "point", point: { ...current } }
        : { type: "node", nodeId: candidateNodeId, anchor: "auto" },
      routing: { type: routing },
      stroke: {
        paint: {
          type: "solid",
          color: {
            space: "srgb",
            ...previewStroke.color,
          },
        },
        width: previewStroke.width,
        ...(previewStroke.dash === undefined
          ? {}
          : { dash: [...previewStroke.dash] }),
      },
    };
  }

  #targetNodeId(
    target: NonNullable<TCanvasProductConnectorOptions["source"]>,
  ): string | null {
    const index = this.#ports.getProjectionIndex();
    return index === null
      ? null
      : fnCanvasProductNodeId({ ref: { target }, index });
  }

  #semanticHit(hit: THitResult | null) {
    const index = this.#ports.getProjectionIndex();
    return index === null || hit === null
      ? null
      : fnResolveCanvasSemanticHit({
          hit,
          viewport: this.#ports.camera.worldToViewport(hit.worldPoint),
          index,
          document: this.#ports.getDocument(),
          resolveTransientTarget: this.#ports.transientTargets.resolve,
        });
  }

  #cancelEvent(
    cancel: TInteractionCancelEvent,
  ): TCanvasProductInteractionCancel {
    const converted = fnCanvasProductInteractionCancel(cancel);
    return this.#cancelOverride === null
      ? converted
      : { ...converted, reason: this.#cancelOverride };
  }

  #withCancelOverride(reason: TCancelOverride, operation: () => void): void {
    this.#cancelOverride = reason;
    try {
      operation();
    } finally {
      this.#cancelOverride = null;
    }
  }

  #invoke(callback: () => void): void {
    try {
      callback();
    } catch (error) {
      this.#report(error);
    }
  }

  #report(error: unknown): void {
    try {
      this.#ports.onDiagnostic?.({
        operation: "interaction-callback",
        error,
      });
    } catch {
      // Diagnostics cannot break engine-owned session cleanup.
    }
  }

  #assertActive(): void {
    if (this.#destroyed) {
      throw new Error("CanvasProductInteractionService has been destroyed.");
    }
  }
}
