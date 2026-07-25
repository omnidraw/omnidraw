import type { CrdtService } from '@vibecanvas/canvas/services';
import type { TWidgetCapsuleProps } from '@vibecanvas/widget-contract';
import type { WidgetUiRuntime } from '../widget-runtime/WidgetUiRuntime';
import type { TWidgetUiRuntimeRenderOwner } from '../widget-runtime/interface';
import {
  fnWidgetInstanceRuntimeIdentitiesEqual,
  fnWidgetInstanceRuntimeIdentity,
  type TWidgetInstanceRuntimeIdentity,
} from './fn.widget-instance-runtime-identity';
import type {
  TWidgetCapsuleCanvasLifecycleSource,
  TWidgetCapsuleCanvasLifecycleState,
} from './interface';

type TPortal = Readonly<{
  canvasId: string;
  crdtService: CrdtService;
  runtime: WidgetUiRuntime;
}>;

type TArgs = Readonly<{
  elementId: string;
  root: HTMLDivElement;
  capsuleLifecycle?: TWidgetCapsuleCanvasLifecycleSource;
}>;

export function txMountCommittedWidgetRuntime(portal: TPortal, args: TArgs): () => void {
  let disposed = false;
  let desiredElement: ReturnType<CrdtService['doc']>['elements'][string] | null = null;
  let desiredIdentity: TWidgetInstanceRuntimeIdentity | null = null;
  let desiredGeneration = 0;
  let synchronizedGeneration = -1;
  let failedGeneration = -1;
  let mountedIdentity: TWidgetInstanceRuntimeIdentity | null = null;
  let runtimeOwner: TWidgetUiRuntimeRenderOwner | undefined;
  let drainOperation: Promise<void> | undefined;
  let lifecycleState = args.capsuleLifecycle?.current();
  let appliedPropsSignature: string | null = null;
  let appliedViewportSignature: string | null = null;
  let appliedFocused = false;
  let appliedHardFrozen: boolean | null = null;

  const resetAppliedLifecycle = () => {
    appliedPropsSignature = null;
    appliedViewportSignature = null;
    appliedFocused = false;
    appliedHardFrozen = null;
  };

  const applyProps = (
    owner: TWidgetUiRuntimeRenderOwner,
    element: NonNullable<typeof desiredElement>,
  ) => {
    if (element.data.type !== 'widget-instance') return;
    const props = (element.data.uiProps ?? {}) as TWidgetCapsuleProps;
    const signature = JSON.stringify(props);
    if (signature === appliedPropsSignature) return;
    appliedPropsSignature = signature;
    try {
      owner.setProps(props);
    } catch {
      // A terminal handle cannot interrupt canvas document synchronization.
    }
  };

  const applyLifecycle = (
    owner: TWidgetUiRuntimeRenderOwner,
    state: TWidgetCapsuleCanvasLifecycleState,
  ) => {
    const viewportSignature = JSON.stringify(state.viewport);
    if (viewportSignature !== appliedViewportSignature) {
      appliedViewportSignature = viewportSignature;
      try {
        owner.setViewport(state.viewport);
      } catch {
        // A failed stale-handle update cannot interrupt canvas lifecycle.
      }
    }
    if (state.focused !== appliedFocused) {
      try {
        owner.setFocused(
          state.focused,
          state.focused ? { preventScroll: true } : undefined,
        );
      } catch {
        // Focus is best-effort when a Capsule is concurrently terminating.
      }
    }
    appliedFocused = state.focused;
    if (appliedHardFrozen === state.collapsed) {
      return;
    }
    appliedHardFrozen = state.collapsed;
    try {
      const transition = state.collapsed
        ? owner.freeze('canvas-widget-collapsed')
        : owner.resume(
            state.canvasMaximized
              ? 'canvas-widget-maximized'
              : 'canvas-widget-visible',
          );
      void transition.catch(() => undefined);
    } catch {
      // A terminal handle may reject a final concurrent lifecycle hint.
    }
  };

  const destroyOwner = async (reason: string) => {
    const owner = runtimeOwner;
    runtimeOwner = undefined;
    mountedIdentity = null;
    resetAppliedLifecycle();
    if (owner !== undefined) {
      try {
        await owner.destroy(reason);
      } catch {
        // Destruction is terminal even if a stale handle reports an error.
      }
    }
  };

  const drain = async () => {
    while (true) {
      const generation = desiredGeneration;
      const nextElement = desiredElement;
      const nextIdentity = desiredIdentity;
      if (
        runtimeOwner !== undefined
        && (
          nextIdentity === null
          || mountedIdentity === null
          || !fnWidgetInstanceRuntimeIdentitiesEqual(
            mountedIdentity,
            nextIdentity,
          )
        )
      ) {
        await destroyOwner(
          nextIdentity === null
            ? 'canvas-widget-removed'
            : 'canvas-widget-revision-replaced',
        );
        continue;
      }
      if (disposed || nextElement === null || nextIdentity === null) {
        synchronizedGeneration = desiredGeneration;
        return;
      }
      if (runtimeOwner === undefined) {
        try {
          runtimeOwner = portal.runtime.renderOwned({
            canvasId: portal.canvasId,
            element: nextElement,
            root: args.root,
            ...(lifecycleState === undefined
              ? {}
              : {
                  initialViewport: lifecycleState.viewport,
                  initiallyFrozen: lifecycleState.collapsed,
                }),
          });
          mountedIdentity = nextIdentity;
          failedGeneration = -1;
          resetAppliedLifecycle();
          applyProps(runtimeOwner, nextElement);
          if (lifecycleState !== undefined) {
            applyLifecycle(runtimeOwner, lifecycleState);
          }
        } catch {
          runtimeOwner = undefined;
          mountedIdentity = null;
          failedGeneration = generation;
          return;
        }
      }
      applyProps(runtimeOwner, nextElement);
      if (generation === desiredGeneration) {
        synchronizedGeneration = generation;
        return;
      }
    }
  };

  const requestDrain = () => {
    if (drainOperation !== undefined) {
      return;
    }
    const operation = drain();
    drainOperation = operation;
    void operation.finally(() => {
      if (drainOperation !== operation) {
        return;
      }
      drainOperation = undefined;
      const identityMismatch = desiredIdentity === null
        ? runtimeOwner !== undefined
        : mountedIdentity === null
          || !fnWidgetInstanceRuntimeIdentitiesEqual(
            mountedIdentity,
            desiredIdentity,
          );
      if (
        (identityMismatch || synchronizedGeneration !== desiredGeneration)
        && failedGeneration !== desiredGeneration
      ) {
        requestDrain();
      }
    });
  };

  const syncCommittedElement = () => {
    if (disposed) {
      return;
    }
    const element = portal.crdtService.doc()?.elements[args.elementId];
    desiredGeneration += 1;
    if (!element || element.data.type !== 'widget-instance') {
      desiredElement = null;
      desiredIdentity = null;
    } else {
      desiredElement = element;
      desiredIdentity = fnWidgetInstanceRuntimeIdentity(element.data);
    }
    requestDrain();
  };

  const removeCrdtListener = portal.crdtService.hooks.change.tap(syncCommittedElement);
  const removeLifecycleListener = args.capsuleLifecycle?.subscribe((state) => {
    lifecycleState = state;
    if (runtimeOwner !== undefined) {
      applyLifecycle(runtimeOwner, state);
    }
  });
  try {
    syncCommittedElement();
  } catch (error) {
    removeCrdtListener();
    removeLifecycleListener?.();
    throw error;
  }

  return () => {
    if (disposed) {
      return;
    }
    disposed = true;
    removeCrdtListener();
    removeLifecycleListener?.();
    desiredElement = null;
    desiredIdentity = null;
    desiredGeneration += 1;
    requestDrain();
  };
}
