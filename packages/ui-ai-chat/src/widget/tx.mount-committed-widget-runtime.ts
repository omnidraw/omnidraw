import type { CrdtService } from '@vibecanvas/canvas/services';
import type { WidgetUiRuntime } from '../widget-runtime/WidgetUiRuntime';
import {
  fnWidgetInstanceRuntimeIdentitiesEqual,
  fnWidgetInstanceRuntimeIdentity,
  type TWidgetInstanceRuntimeIdentity,
} from './fn.widget-instance-runtime-identity';

type TPortal = Readonly<{
  canvasId: string;
  crdtService: CrdtService;
  runtime: WidgetUiRuntime;
}>;

type TArgs = Readonly<{
  elementId: string;
  root: HTMLDivElement;
}>;

export function txMountCommittedWidgetRuntime(portal: TPortal, args: TArgs): () => void {
  let disposed = false;
  let mountedIdentity: TWidgetInstanceRuntimeIdentity | null = null;
  let cleanupRuntime: (() => void) | undefined;

  const disposeRuntime = () => {
    const cleanup = cleanupRuntime;
    cleanupRuntime = undefined;
    mountedIdentity = null;
    try {
      cleanup?.();
    } catch {
      // Runtime teardown must not prevent the committed replacement from mounting.
    }
  };

  const syncCommittedElement = () => {
    if (disposed) return;
    const element = portal.crdtService.doc()?.elements[args.elementId];
    if (!element || element.data.type !== 'widget-instance') {
      disposeRuntime();
      return;
    }

    const nextIdentity = fnWidgetInstanceRuntimeIdentity(element.data);
    if (
      mountedIdentity
      && fnWidgetInstanceRuntimeIdentitiesEqual(mountedIdentity, nextIdentity)
    ) {
      return;
    }

    disposeRuntime();
    cleanupRuntime = portal.runtime.render({
      canvasId: portal.canvasId,
      element,
      root: args.root,
    });
    mountedIdentity = nextIdentity;
  };

  const removeCrdtListener = portal.crdtService.hooks.change.tap(syncCommittedElement);
  try {
    syncCommittedElement();
  } catch (error) {
    removeCrdtListener();
    throw error;
  }

  return () => {
    if (disposed) return;
    disposed = true;
    removeCrdtListener();
    disposeRuntime();
  };
}
