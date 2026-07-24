import type {
  TNodeTransformProposal,
  TSelectionAppearance,
  TTransformGestureEvent,
  TTransformPolicy,
} from "@vibecanvas/canvas-engine";
import type { TCanvasModifierState } from "../../semantic/typed";
import {
  fnCanvasProductTransformProposal,
  fnCanvasProductTransformToEngine,
} from "./fn.convert";
import {
  fnCanvasEngineElementId,
  fnCanvasEngineGroupId,
} from "../projection/fn.ids";
import { fnCanvasProductNodeId, fnCanvasProductTarget } from "./fn.targets";
import { fnCanvasTransformHandoffProjection } from "./fn.transient";
import type { TCanvasProductRuntimeEnginePorts } from "./interface";
import type {
  TCanvasDurableHandoff,
  TCanvasDurableHandoffState,
  TCanvasProductCloneIdentity,
  TCanvasProductClonePlanProvider,
  TCanvasProductSelection,
  TCanvasProductSelectionAppearance,
  TCanvasProductTransformEvent,
  TCanvasProductTransformPolicy,
  TCanvasProductTransformProposal,
} from "./typed";

type TTransformPorts = Pick<
  TCanvasProductRuntimeEnginePorts,
  | "getProjectionIndex"
  | "onDiagnostic"
  | "scene"
  | "transforms"
  | "transients"
>;

type TTransformListener = (event: TCanvasProductTransformEvent) => void;

function engineColor(color: {
  r: number;
  g: number;
  b: number;
  a: number;
}) {
  return {
    type: "solid" as const,
    color: {
      space: "srgb" as const,
      ...color,
    },
  };
}

function engineAppearance(
  appearance: TCanvasProductSelectionAppearance,
): TSelectionAppearance {
  return {
    outline: {
      paint: engineColor(appearance.outline.color),
      width: appearance.outline.width,
      ...(appearance.outline.dash === undefined
        ? {}
        : { dash: [...appearance.outline.dash] }),
    },
    handleFill: engineColor(appearance.handleFill),
    handleStroke: {
      paint: engineColor(appearance.handleStroke.color),
      width: appearance.handleStroke.width,
      ...(appearance.handleStroke.dash === undefined
        ? {}
        : { dash: [...appearance.handleStroke.dash] }),
    },
    handleSize: appearance.handleSize,
    rotateHandleOffset: appearance.rotateHandleOffset,
    ...(appearance.outlinePadding === undefined
      ? {}
      : { outlinePadding: appearance.outlinePadding }),
  };
}

function enginePolicy(
  policy: TCanvasProductTransformPolicy,
): TTransformPolicy {
  return {
    handles: [...policy.handles],
    ...(policy.keepAspectRatio === undefined
      ? {}
      : { keepAspectRatio: policy.keepAspectRatio }),
    ...(policy.allowFlip === undefined
      ? {}
      : { allowFlip: policy.allowFlip }),
    ...(policy.allowRotate === undefined
      ? {}
      : { allowRotate: policy.allowRotate }),
    ...(policy.minSize === undefined
      ? {}
      : { minSize: { ...policy.minSize } }),
    ...(policy.maxSize === undefined
      ? {}
      : { maxSize: { ...policy.maxSize } }),
    ...(policy.snapRotationRadians === undefined
      ? {}
      : { snapRotationRadians: policy.snapRotationRadians }),
    previewMode: "ephemeral-engine-preview",
  };
}

function modifiers(
  value: TTransformGestureEvent["modifiers"],
): TCanvasModifierState {
  return {
    alt: value.alt,
    control: value.ctrl,
    meta: value.meta,
    shift: value.shift,
  };
}

class DurableHandoff implements TCanvasDurableHandoff {
  readonly id: string;
  readonly #onSettle: (
    state: Exclude<TCanvasDurableHandoffState, "pending">,
    error?: unknown,
  ) => void;
  #state: TCanvasDurableHandoffState = "pending";
  #retained = false;
  #dispatchOpen = true;

  constructor(
    id: string,
    onSettle: (
      state: Exclude<TCanvasDurableHandoffState, "pending">,
      error?: unknown,
    ) => void,
  ) {
    this.id = id;
    this.#onSettle = onSettle;
  }

  get state(): TCanvasDurableHandoffState {
    return this.#state;
  }

  retain(): void {
    this.#assertPending();
    if (!this.#dispatchOpen) {
      throw new Error("Durable handoff must be retained during commit dispatch.");
    }
    this.#retained = true;
  }

  waitFor(operation: PromiseLike<unknown>): void {
    this.retain();
    try {
      operation.then(
        () => this.complete(),
        (error) => this.fail(error),
      );
    } catch (error) {
      this.fail(error);
    }
  }

  complete(): void {
    this.#settle("completed");
  }

  fail(error?: unknown): void {
    this.#settle("failed", error);
  }

  cancel(reason?: string): void {
    this.#settle("cancelled", reason);
  }

  sealDispatch(): void {
    this.#dispatchOpen = false;
    if (this.#state === "pending" && !this.#retained) {
      this.complete();
    }
  }

  #settle(
    state: Exclude<TCanvasDurableHandoffState, "pending">,
    error?: unknown,
  ): void {
    if (this.#state !== "pending") {
      return;
    }
    this.#state = state;
    this.#onSettle(state, error);
  }

  #assertPending(): void {
    if (this.#state !== "pending") {
      throw new Error(`Durable handoff is already ${this.#state}.`);
    }
  }
}

export class CanvasProductTransformService {
  readonly #ports: TTransformPorts;
  readonly #listeners = new Set<TTransformListener>();
  readonly #handoffs = new Map<string, DurableHandoff>();
  readonly #altCloneOwners = new Set<string>();
  readonly #cloneIdentities = new Map<
    string,
    TCanvasProductCloneIdentity | null
  >();
  #clonePlanProvider: TCanvasProductClonePlanProvider | null = null;
  #unsubscribe: (() => void) | null;
  #destroyed = false;

  constructor(ports: TTransformPorts) {
    this.#ports = ports;
    this.#unsubscribe = ports.transforms.subscribe((event) => {
      this.#onEngineEvent(event);
    });
  }

  subscribe(listener: TTransformListener): () => void {
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

  setClonePlanProvider(
    provider: TCanvasProductClonePlanProvider,
  ): () => void {
    this.#assertActive();
    if (
      this.#clonePlanProvider !== null
      && this.#clonePlanProvider !== provider
    ) {
      this.#discardAllCloneIdentities("provider-replaced");
    }
    this.#clonePlanProvider = provider;
    let registered = true;
    return () => {
      if (!registered || this.#clonePlanProvider !== provider) {
        return;
      }
      registered = false;
      this.#discardAllCloneIdentities("provider-removed");
      this.#clonePlanProvider = null;
    };
  }

  setSelection(selection: TCanvasProductSelection | null): void {
    this.#assertActive();
    if (selection === null) {
      this.#ports.transforms.setSelection(null);
      return;
    }
    const index = this.#ports.getProjectionIndex();
    if (index === null) {
      this.#ports.transforms.setSelection(null);
      return;
    }
    const nodeIds = selection.targets.flatMap((target) => {
      const nodeId = this.#selectionNodeId(target, index);
      return nodeId === null ? [] : [nodeId];
    });
    if (nodeIds.length === 0) {
      this.#ports.transforms.setSelection(null);
      return;
    }
    const focusedNodeId = selection.focused === undefined
      ? undefined
      : this.#selectionNodeId(selection.focused, index) ?? undefined;
    this.#ports.transforms.setSelection({
      nodeIds: [...new Set(nodeIds)],
      ...(focusedNodeId === undefined ? {} : { focusedNodeId }),
      appearance: engineAppearance(selection.appearance),
      policy: enginePolicy(selection.policy),
    });
  }

  setPolicy(policy: Partial<TCanvasProductTransformPolicy>): void {
    this.#assertActive();
    this.#ports.transforms.setPolicy({
      ...(policy.handles === undefined
        ? {}
        : { handles: [...policy.handles] }),
      ...(policy.keepAspectRatio === undefined
        ? {}
        : { keepAspectRatio: policy.keepAspectRatio }),
      ...(policy.allowFlip === undefined
        ? {}
        : { allowFlip: policy.allowFlip }),
      ...(policy.allowRotate === undefined
        ? {}
        : { allowRotate: policy.allowRotate }),
      ...(policy.minSize === undefined
        ? {}
        : { minSize: { ...policy.minSize } }),
      ...(policy.maxSize === undefined
        ? {}
        : { maxSize: { ...policy.maxSize } }),
      ...(policy.snapRotationRadians === undefined
        ? {}
        : { snapRotationRadians: policy.snapRotationRadians }),
      previewMode: "ephemeral-engine-preview",
    });
  }

  applyPreview(
    proposals: readonly TCanvasProductTransformProposal[],
  ): void {
    this.#assertActive();
    this.#ports.transforms.applyPreview(this.#engineProposals(proposals));
  }

  clearPreview(): void {
    this.#assertActive();
    this.#ports.transforms.clearPreview();
  }

  cancel(): void {
    this.#assertActive();
    this.#ports.transforms.cancelActiveGesture();
    this.#cancelHandoffs("explicit");
    this.#clearAltCloneState("explicit");
  }

  cancelForRemoteChange(): void {
    this.#assertActive();
    this.#ports.transforms.cancelActiveGesture();
    this.#cancelHandoffs("remote-change");
    this.#clearAltCloneState("remote-change");
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    const unsubscribe = this.#unsubscribe;
    this.#unsubscribe = null;
    let firstError: unknown;
    try {
      unsubscribe?.();
    } catch (error) {
      firstError = error;
      this.#report({
        operation: "teardown",
        error,
      });
    }
    try {
      this.#ports.transforms.cancelActiveGesture();
    } catch (error) {
      firstError ??= error;
      this.#report({
        operation: "teardown",
        error,
      });
    }
    this.#cancelHandoffs("destroy");
    this.#clearAltCloneState("destroy");
    this.#clonePlanProvider = null;
    this.#listeners.clear();
    if (firstError !== undefined) {
      throw firstError;
    }
  }

  #onEngineEvent(event: TTransformGestureEvent): void {
    if (this.#destroyed) {
      return;
    }
    const index = this.#ports.getProjectionIndex();
    const proposals = index === null
      ? []
      : event.proposals.flatMap((proposal) => {
          const target = fnCanvasProductTarget({
            nodeId: proposal.nodeId,
            index,
          });
          return target === null
            ? []
            : [fnCanvasProductTransformProposal({ target, proposal })];
        });
    const clone = this.#syncAltClonePreview(event, proposals, index);
    const base = {
      gestureId: event.gestureId,
      handle: event.handle,
      pointerId: event.pointerId,
      proposals,
      worldPointer: { ...event.worldPointer },
      modifiers: modifiers(event.modifiers),
      ...(clone === null ? {} : { clone }),
    };
    if (event.type !== "transform-commit") {
      if (event.type === "transform-cancel") {
        this.#handoffs.get(event.gestureId)?.cancel("engine-cancel");
      }
      this.#emit({
        ...base,
        type: event.type,
      });
      return;
    }
    const handoff = this.#createHandoff(event, clone, index);
    this.#emit({
      ...base,
      type: "transform-commit",
      handoff,
    });
    handoff.sealDispatch();
    this.#discardCloneIdentity(event.gestureId, "commit-dispatched");
  }

  #createHandoff(
    event: TTransformGestureEvent,
    clone: TCanvasProductCloneIdentity | null,
    index: NonNullable<ReturnType<TTransformPorts["getProjectionIndex"]>> | null,
  ): DurableHandoff {
    this.#handoffs.get(event.gestureId)?.cancel("replaced");
    const ownerId = `vc:transient:transform-handoff:${event.gestureId}`;
    let nodes: Readonly<ReturnType<TTransformPorts["scene"]["get"]>>[] = [];
    try {
      nodes = this.#collectProposalSubtrees(event.proposals);
      this.#ports.transients.sync(ownerId, fnCanvasTransformHandoffProjection({
        ownerId,
        proposals: event.proposals,
        nodes: nodes.flatMap((node) => node === null ? [] : [node]),
        ...(clone === null || index === null
          ? {}
          : {
              durableNodeIds: this.#durableCloneNodeIds(clone, index),
            }),
      }));
    } catch (error) {
      this.#report({
        operation: "handoff-create",
        error,
        gestureId: event.gestureId,
        ownerId,
      });
    }
    const handoff = new DurableHandoff(event.gestureId, (state, error) => {
      try {
        this.#ports.transients.release(ownerId);
      } catch (releaseError) {
        this.#report({
          operation: "teardown",
          error: releaseError,
          gestureId: event.gestureId,
          ownerId,
        });
      }
      if (state === "failed") {
        this.#report({
          operation: "handoff-failure",
          error,
          gestureId: event.gestureId,
          ownerId,
        });
      }
      if (this.#handoffs.get(event.gestureId) === handoff) {
        this.#handoffs.delete(event.gestureId);
      }
    });
    this.#handoffs.set(event.gestureId, handoff);
    return handoff;
  }

  #syncAltClonePreview(
    event: TTransformGestureEvent,
    proposals: readonly TCanvasProductTransformProposal[],
    index: NonNullable<ReturnType<TTransformPorts["getProjectionIndex"]>> | null,
  ): TCanvasProductCloneIdentity | null {
    const ownerId = `vc:transient:alt-clone:${event.gestureId}`;
    if (
      event.type === "transform-cancel"
      || event.handle !== "move"
      || !event.modifiers.alt
    ) {
      this.#releaseAltCloneOwner(ownerId);
      this.#discardCloneIdentity(event.gestureId, event.type);
      return null;
    }
    const clone = this.#ensureCloneIdentity(event.gestureId, proposals);
    if (clone === null || index === null) {
      this.#releaseAltCloneOwner(ownerId);
      return null;
    }
    if (event.type === "transform-commit") {
      this.#releaseAltCloneOwner(ownerId);
      return clone;
    }
    try {
      this.#ports.transforms.clearPreview();
      const nodes = this.#collectProposalSubtrees(event.proposals);
      this.#ports.transients.sync(ownerId, fnCanvasTransformHandoffProjection({
        ownerId,
        proposals: event.proposals,
        nodes,
        durableNodeIds: this.#durableCloneNodeIds(clone, index),
      }));
      this.#altCloneOwners.add(ownerId);
    } catch (error) {
      this.#report({
        operation: "transform-callback",
        error,
        gestureId: event.gestureId,
        ownerId,
      });
    }
    return clone;
  }

  #releaseAltCloneOwner(ownerId: string): void {
    if (!this.#altCloneOwners.delete(ownerId)) {
      return;
    }
    try {
      this.#ports.transients.release(ownerId);
    } catch (error) {
      this.#report({
        operation: "teardown",
        error,
        ownerId,
      });
    }
  }

  #ensureCloneIdentity(
    gestureId: string,
    proposals: readonly TCanvasProductTransformProposal[],
  ): TCanvasProductCloneIdentity | null {
    if (this.#cloneIdentities.has(gestureId)) {
      return this.#cloneIdentities.get(gestureId) ?? null;
    }
    const provider = this.#clonePlanProvider;
    if (provider === null) {
      return null;
    }
    try {
      const clone = provider.prepare({
        gestureId,
        targets: proposals.map((proposal) => ({ ...proposal.target })),
      });
      if (clone === null) {
        this.#cloneIdentities.set(gestureId, null);
        return null;
      }
      this.#cloneIdentities.set(gestureId, clone);
      return clone;
    } catch (error) {
      this.#report({
        operation: "transform-callback",
        error,
        gestureId,
      });
      this.#cloneIdentities.set(gestureId, null);
      return null;
    }
  }

  #discardCloneIdentity(gestureId: string, reason: string): void {
    if (!this.#cloneIdentities.delete(gestureId)) {
      return;
    }
    try {
      this.#clonePlanProvider?.discard({ gestureId, reason });
    } catch (error) {
      this.#report({
        operation: "teardown",
        error,
        gestureId,
      });
    }
  }

  #discardAllCloneIdentities(reason: string): void {
    for (const gestureId of [...this.#cloneIdentities.keys()]) {
      this.#discardCloneIdentity(gestureId, reason);
    }
  }

  #clearAltCloneState(reason: string): void {
    for (const ownerId of [...this.#altCloneOwners]) {
      this.#releaseAltCloneOwner(ownerId);
    }
    this.#discardAllCloneIdentities(reason);
  }

  #durableCloneNodeIds(
    clone: TCanvasProductCloneIdentity,
    index: NonNullable<ReturnType<TTransformPorts["getProjectionIndex"]>>,
  ): ReadonlyMap<string, string> {
    const nodeIds = new Map<string, string>();
    for (const group of clone.groups) {
      const sourceNodeId = index.groupNodeIds[group.sourceId];
      if (sourceNodeId !== undefined) {
        nodeIds.set(sourceNodeId, fnCanvasEngineGroupId({ id: group.cloneId }));
      }
    }
    for (const element of clone.elements) {
      const sourceElementNodeIds = index.elementNodeIds[element.sourceId] ?? [];
      const sourceRootId = sourceElementNodeIds[0]
        ?? fnCanvasEngineElementId({ id: element.sourceId });
      const cloneRootId = fnCanvasEngineElementId({ id: element.cloneId });
      for (const sourceNodeId of sourceElementNodeIds) {
        nodeIds.set(
          sourceNodeId,
          sourceNodeId === sourceRootId
            ? cloneRootId
            : `${cloneRootId}${sourceNodeId.slice(sourceRootId.length)}`,
        );
      }
    }
    return nodeIds;
  }

  #collectProposalSubtrees(
    proposals: readonly TNodeTransformProposal[],
  ) {
    const nodes: NonNullable<ReturnType<TTransformPorts["scene"]["get"]>>[] = [];
    const visited = new Set<string>();
    const work = proposals.map((proposal) => proposal.nodeId);
    while (work.length > 0) {
      const nodeId = work.shift()!;
      if (visited.has(nodeId)) {
        continue;
      }
      visited.add(nodeId);
      const node = this.#ports.scene.get(nodeId);
      if (node === null) {
        continue;
      }
      nodes.push(node);
      for (const child of this.#ports.scene.childrenOf(nodeId)) {
        work.push(child.id);
      }
    }
    return nodes;
  }

  #engineProposals(
    proposals: readonly TCanvasProductTransformProposal[],
  ): TNodeTransformProposal[] {
    const index = this.#ports.getProjectionIndex();
    if (index === null) {
      return [];
    }
    return proposals.flatMap((proposal) => {
      const nodeId = this.#selectionNodeId(proposal.target, index);
      return nodeId === null ? [] : [{
        nodeId,
        previousTransform: fnCanvasProductTransformToEngine(
          proposal.previousTransform,
        ),
        nextTransform: fnCanvasProductTransformToEngine(
          proposal.nextTransform,
        ),
        ...(proposal.previousSize === undefined
          ? {}
          : { previousSize: { ...proposal.previousSize } }),
        ...(proposal.nextSize === undefined
          ? {}
          : { nextSize: { ...proposal.nextSize } }),
      }];
    });
  }

  #selectionNodeId(
    target: TCanvasProductSelection["targets"][number],
    index: NonNullable<ReturnType<TTransformPorts["getProjectionIndex"]>>,
  ): string | null {
    if (target.kind === "element") {
      const renderNodeId = fnCanvasProductNodeId({
        ref: { target, role: "render" },
        index,
      });
      if (
        renderNodeId !== null
        && this.#ports.scene.get(renderNodeId)?.kind === "widget-frame"
      ) {
        return renderNodeId;
      }
    }
    return fnCanvasProductNodeId({
      ref: { target },
      index,
    });
  }

  #cancelHandoffs(reason: string): void {
    for (const handoff of [...this.#handoffs.values()]) {
      handoff.cancel(reason);
    }
  }

  #emit(event: TCanvasProductTransformEvent): void {
    for (const listener of [...this.#listeners]) {
      if (!this.#listeners.has(listener)) {
        continue;
      }
      try {
        listener(event);
      } catch (error) {
        this.#report({
          operation: "transform-callback",
          error,
          gestureId: event.gestureId,
        });
      }
    }
  }

  #report(
    diagnostic: Parameters<
      NonNullable<TTransformPorts["onDiagnostic"]>
    >[0],
  ): void {
    try {
      this.#ports.onDiagnostic?.(diagnostic);
    } catch {
      // Diagnostics cannot interrupt transform synchronization.
    }
  }

  #assertActive(): void {
    if (this.#destroyed) {
      throw new Error("CanvasProductTransformService has been destroyed.");
    }
  }
}
