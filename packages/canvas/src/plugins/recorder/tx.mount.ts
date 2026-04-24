import type { Accessor } from "solid-js";
import type { SceneService } from "../../services/scene/SceneService";

export type TPortalTxMountRecorderPanel = {
  document: Document;
  SceneService: SceneService;
  renderUi: (...args: any[]) => () => void;
  createComponentUi: (...args: any[]) => unknown;
  CanvasRecorder: (props: {
    open: Accessor<boolean>;
    onOpenChange: (open: boolean) => void;
    recording: Accessor<boolean>;
    stepCount: Accessor<number>;
    opCount: Accessor<number>;
    reducedEvents: Accessor<boolean>;
    onReducedEventsChange: (value: boolean) => void;
    canExport: Accessor<boolean>;
    onStart: () => void;
    onStop: () => void;
    onClear: () => void;
    onCopy: () => void;
    onExport: () => void;
  }) => unknown;
};

export type TArgsTxMountRecorderPanel = {
  open: Accessor<boolean>;
  setOpen: (open: boolean) => void;
  recording: Accessor<boolean>;
  stepCount: Accessor<number>;
  opCount: Accessor<number>;
  reducedEvents: Accessor<boolean>;
  setReducedEvents: (value: boolean) => void;
  canExport: Accessor<boolean>;
  actions: {
    start: () => void;
    stop: () => void;
    clear: () => void;
    copy: () => void;
    export: () => void;
  };
};

export function txMountRecorderPanel(portal: TPortalTxMountRecorderPanel, args: TArgsTxMountRecorderPanel) {
  const mountElement = portal.document.createElement("div");
  mountElement.id = "recorder-panel";
  portal.SceneService.stage.container().appendChild(mountElement);

  const disposeRender = portal.renderUi(
    () =>
      portal.createComponentUi(portal.CanvasRecorder, {
        open: args.open,
        onOpenChange: args.setOpen,
        recording: args.recording,
        stepCount: args.stepCount,
        opCount: args.opCount,
        reducedEvents: args.reducedEvents,
        onReducedEventsChange: args.setReducedEvents,
        canExport: args.canExport,
        onStart: args.actions.start,
        onStop: args.actions.stop,
        onClear: args.actions.clear,
        onCopy: args.actions.copy,
        onExport: args.actions.export,
      }),
    mountElement,
  );

  return {
    mountElement,
    dispose() {
      disposeRender();
      mountElement.remove();
    },
  };
}
