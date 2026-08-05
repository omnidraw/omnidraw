import type {
  ICamera2DController,
  ITransientScene,
  ITransientSceneOwner,
  TTransientSceneProjection,
} from '@omnidraw/cangine';
import type { TWidgetFrameBounds, TWidgetPlacementRef } from '@omnidraw/widget-contract';
import type {
  TWidgetPlacementPort,
  TWidgetPlacementStartArgs,
} from './WidgetPlacementCoordinator';
import {
  fnClampWidgetPlacementPosition,
  fnHasWidgetPlacementDragThreshold,
  type TWidgetPlacementPoint,
} from './fn.pointer-placement';

type TPlacementCommit = Readonly<{
  reference: TWidgetPlacementRef;
  bounds: TWidgetFrameBounds;
  label: string;
  position: TWidgetPlacementPoint;
}>;

type TPointerSession = Readonly<{
  request: TWidgetPlacementStartArgs;
  pointerId: number;
  origin: TWidgetPlacementPoint;
  previousUserSelect: string;
}> & {
  dragging: boolean;
};

export type TPortal = Readonly<{
  camera: ICamera2DController;
  container: HTMLElement;
  document: Document;
  transients: ITransientScene;
  commit(placement: TPlacementCommit): void | Promise<void>;
  onError(error: unknown): void;
}>;

export type TArgs = Readonly<{
  dragThreshold: number;
  ownerId: string;
}>;

export type TWidgetPointerPlacement = TWidgetPlacementPort & Readonly<{
  destroy(): void;
}>;

export function txCreateWidgetPointerPlacement(
  portal: TPortal,
  args: TArgs,
): TWidgetPointerPlacement {
  let session: TPointerSession | null = null;
  let ghost: ITransientSceneOwner | null = null;

  const containsClientPoint = (point: TWidgetPlacementPoint): boolean => {
    const rect = portal.container.getBoundingClientRect();
    return (
      point.x >= rect.left
      && point.x <= rect.right
      && point.y >= rect.top
      && point.y <= rect.bottom
    );
  };

  const resolvePosition = (
    point: TWidgetPlacementPoint,
    bounds: TWidgetFrameBounds,
  ): TWidgetPlacementPoint => fnClampWidgetPlacementPosition({
    point: portal.camera.viewportToWorld(portal.camera.clientToViewport(point)),
    bounds,
    viewport: portal.camera.visibleWorldBounds(),
  });

  const ghostProjection = (
    request: Pick<TWidgetPlacementStartArgs, 'bounds' | 'label'>,
    position: TWidgetPlacementPoint,
  ): TTransientSceneProjection => ({
    band: 'world-overlay',
    hitTest: 'none',
    nodes: [{
      id: `${args.ownerId}:frame`,
      parentId: null,
      orderKey: 'A',
      kind: 'widget-frame',
      transform: {
        position,
        rotation: 0,
        scale: { x: 1, y: 1 },
        skew: { x: 0, y: 0 },
        origin: { x: 0, y: 0 },
      },
      size: request.bounds,
      title: request.label,
      opacity: 0.8,
      pointerEvents: 'none',
      resizable: false,
    }],
  });

  const syncGhost = (
    request: Pick<TWidgetPlacementStartArgs, 'bounds' | 'label'>,
    point: TWidgetPlacementPoint,
  ): void => {
    ghost ??= portal.transients.createOwner(args.ownerId);
    ghost.replace(ghostProjection(request, resolvePosition(point, request.bounds)));
  };

  const clearGhost = (): void => {
    ghost?.clear();
  };

  const removeListeners = (): void => {
    portal.document.removeEventListener('pointermove', onPointerMove);
    portal.document.removeEventListener('pointerup', onPointerUp);
    portal.document.removeEventListener('pointercancel', onPointerCancel);
    portal.document.removeEventListener('keydown', onKeyDown);
  };

  const finishSession = (): TPointerSession | null => {
    const current = session;
    if (!current) return null;
    removeListeners();
    portal.document.body.style.userSelect = current.previousUserSelect;
    session = null;
    clearGhost();
    return current;
  };

  const cancelSession = (): void => {
    const current = finishSession();
    if (current?.dragging) current.request.onDragEnd?.();
  };

  const commit = async (
    request: Pick<TWidgetPlacementStartArgs, 'reference' | 'bounds' | 'label'>,
    position: TWidgetPlacementPoint,
  ): Promise<void> => {
    try {
      await portal.commit({
        reference: request.reference,
        bounds: request.bounds,
        label: request.label,
        position,
      });
    } catch (error) {
      portal.onError(error);
    }
  };

  function onPointerMove(event: PointerEvent): void {
    const current = session;
    if (!current || event.pointerId !== current.pointerId) return;
    const point = { x: event.clientX, y: event.clientY };
    if (
      !current.dragging
      && fnHasWidgetPlacementDragThreshold({
        origin: current.origin,
        point,
        threshold: args.dragThreshold,
      })
    ) {
      current.dragging = true;
      portal.document.body.style.userSelect = 'none';
      current.request.onDragStart?.();
    }
    if (!current.dragging) return;
    event.preventDefault();
    if (!containsClientPoint(point)) {
      clearGhost();
      return;
    }
    syncGhost(current.request, point);
  }

  function onPointerUp(event: PointerEvent): void {
    const current = session;
    if (!current || event.pointerId !== current.pointerId) return;
    if (!current.dragging) {
      finishSession();
      return;
    }
    event.preventDefault();
    const point = { x: event.clientX, y: event.clientY };
    const insideCanvas = containsClientPoint(point);
    finishSession();
    current.request.onDragEnd?.();
    if (insideCanvas) {
      void commit(current.request, resolvePosition(point, current.request.bounds));
    }
  }

  function onPointerCancel(event: PointerEvent): void {
    if (event.pointerId === session?.pointerId) cancelSession();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !session?.dragging) return;
    event.preventDefault();
    cancelSession();
  }

  return {
    beginPointerSession(request) {
      if (request.event.button !== 0 || request.event.isPrimary === false) {
        return false;
      }
      cancelSession();
      session = {
        request,
        pointerId: request.event.pointerId,
        origin: {
          x: request.event.clientX,
          y: request.event.clientY,
        },
        dragging: false,
        previousUserSelect: portal.document.body.style.userSelect,
      };
      portal.document.addEventListener('pointermove', onPointerMove, {
        passive: false,
      });
      portal.document.addEventListener('pointerup', onPointerUp, {
        passive: false,
      });
      portal.document.addEventListener('pointercancel', onPointerCancel, {
        passive: false,
      });
      portal.document.addEventListener('keydown', onKeyDown);
      return true;
    },
    async addToCanvas(request) {
      cancelSession();
      const viewport = portal.camera.visibleWorldBounds();
      const position = fnClampWidgetPlacementPosition({
        point: request.position ?? {
          x: (viewport.minX + viewport.maxX - request.bounds.width) / 2,
          y: (viewport.minY + viewport.maxY - request.bounds.height) / 2,
        },
        bounds: request.bounds,
        viewport,
      });
      await commit(request, position);
    },
    destroy() {
      cancelSession();
      ghost?.destroy();
      ghost = null;
    },
  };
}
