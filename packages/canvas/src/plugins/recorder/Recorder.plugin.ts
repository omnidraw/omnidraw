import type { IPlugin } from "@vibecanvas/runtime";
import { createComponent, createSignal, type Accessor, type Setter } from "solid-js";
import Konva from "konva";
import type { CrdtService } from "../../services/crdt/CrdtService";
import type { SceneService } from "../../services/scene/SceneService";
import type { IRuntimeHooks, TMouseEvent, TPointerEvent } from "../../types";
import { render as renderSolid } from "solid-js/web";
import { CanvasRecorder } from "../../components/CanvasRecorder";
import {
  fnCanExportRecording,
  fnCreateDragStep,
  fnCreateEmptyRecording,
  fnCreateKeyStep,
  fnCreateOpsCrdtOp,
  fnCreatePointerMoveStep,
  fnCreatePointerStep,
  fnCreateStartedRecording,
  fnCreateWheelStep,
} from "./fn.recording";
import { txSaveJsonFile } from "./tx.file";
import { txMountRecorderPanel } from "./tx.mount";
import type { TCrdtOp, TRecording, TStep } from "./CONSTANTS";

function fnGetDefaultReducedEvents() {
  return true;
}

type TRecorderState = {
  recording: boolean;
  reducedEvents: boolean;
  pointerPressed: boolean;
  recordingData: TRecording;
  restoreCrdtWrite: (() => void) | null;
  restoreNodeFire: (() => void) | null;
  open: Accessor<boolean>;
  setOpen: Setter<boolean>;
  recordingSignal: Accessor<boolean>;
  setRecordingSignal: Setter<boolean>;
  stepCount: Accessor<number>;
  setStepCount: Setter<number>;
  opCount: Accessor<number>;
  setOpCount: Setter<number>;
  reducedEventsSignal: Accessor<boolean>;
  setReducedEventsSignal: Setter<boolean>;
  canExport: Accessor<boolean>;
  setCanExport: Setter<boolean>;
  panelMount: ReturnType<typeof txMountRecorderPanel> | null;
};

function createRecorderState(): TRecorderState {
  const [open, setOpen] = createSignal(false);
  const [recordingSignal, setRecordingSignal] = createSignal(false);
  const [stepCount, setStepCount] = createSignal(0);
  const [opCount, setOpCount] = createSignal(0);
  const defaultReducedEvents = fnGetDefaultReducedEvents();
  const [reducedEventsSignal, setReducedEventsSignal] = createSignal(defaultReducedEvents);
  const [canExport, setCanExport] = createSignal(false);

  return {
    recording: false,
    reducedEvents: defaultReducedEvents,
    pointerPressed: false,
    recordingData: fnCreateEmptyRecording({ reducedEvents: defaultReducedEvents }),
    restoreCrdtWrite: null,
    restoreNodeFire: null,
    open,
    setOpen,
    recordingSignal,
    setRecordingSignal,
    stepCount,
    setStepCount,
    opCount,
    setOpCount,
    reducedEventsSignal,
    setReducedEventsSignal,
    canExport,
    setCanExport,
    panelMount: null,
  };
}

function txSyncUi(state: TRecorderState) {
  state.setRecordingSignal(state.recording);
  state.setStepCount(state.recordingData.steps.length);
  state.setOpCount(state.recordingData.crdtOps.length);
  state.setReducedEventsSignal(state.reducedEvents);
  state.setCanExport(fnCanExportRecording({ recording: state.recordingData }));
}

function txPushStep(state: TRecorderState, step: TStep) {
  state.recordingData.steps.push(step);
  txSyncUi(state);
}

function txPushCrdtOp(state: TRecorderState, op: TCrdtOp) {
  state.recordingData.crdtOps.push(op);
  txSyncUi(state);
}

function txStartRecording(state: TRecorderState, crdt: CrdtService) {
  state.recordingData = fnCreateStartedRecording({
    crdt,
    reducedEvents: state.reducedEvents,
    now: Date.now(),
  });
  state.recording = true;
  txSyncUi(state);
}

function txStopRecording(state: TRecorderState) {
  state.recording = false;
  txSyncUi(state);
}

function txClearRecording(state: TRecorderState) {
  state.recording = false;
  state.recordingData = fnCreateEmptyRecording({ reducedEvents: state.reducedEvents });
  txSyncUi(state);
}

function getRecordingJson(state: TRecorderState) {
  return JSON.stringify(state.recordingData, null, 2);
}

function txCopyTextToClipboard(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function txCopyRecording(state: TRecorderState) {
  const content = getRecordingJson(state);

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }

  txCopyTextToClipboard(content);
}

async function txExportRecording(state: TRecorderState) {
  const runtimeWindow = window as typeof window & {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: string) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  };

  await txSaveJsonFile(
    {
      document,
      url: URL,
      createBlob: (parts, options) => new Blob(parts, options),
      isAbortError: (error) => error instanceof DOMException && error.name === "AbortError",
      showSaveFilePicker: runtimeWindow.showSaveFilePicker?.bind(runtimeWindow),
    },
    {
      fileName: `${state.recordingData.name}.json`,
      content: getRecordingJson(state),
    },
  );
}

function txRecordPointerEvent(state: TRecorderState, render: SceneService, eventName: "pointerdown" | "pointerup" | "pointerout" | "pointerover" | "pointercancel", event: TPointerEvent) {
  if (!state.recording) {
    return;
  }

  txPushStep(
    state,
    fnCreatePointerStep({ render, eventName, event }),
  );
}

function txRecordKeyEvent(state: TRecorderState, eventName: "keydown" | "keyup", event: KeyboardEvent) {
  if (!state.recording) {
    return;
  }

  txPushStep(state, fnCreateKeyStep({ eventName, event }));
}

function txRecordDragEvent(state: TRecorderState, render: SceneService, eventName: "dragstart" | "dragmove" | "dragend", event: TMouseEvent) {
  if (!state.recording) {
    return;
  }

  txPushStep(
    state,
    fnCreateDragStep({ render, eventName, event }),
  );
}

function setupHookCapture(args: { state: TRecorderState; render: SceneService; hooks: IRuntimeHooks }) {
  const originalFire = Konva.Node.prototype.fire;
  Konva.Node.prototype.fire = (function (this: Konva.Node, eventType: string, evt?: object, bubble?: boolean) {
    if (eventType === "dragstart" || eventType === "dragmove" || eventType === "dragend") {
      txRecordDragEvent(args.state, args.render, eventType, {
        target: this,
        currentTarget: this,
        evt: (evt as { evt?: MouseEvent } | undefined)?.evt ?? new MouseEvent(eventType, { bubbles: true }),
      } as TMouseEvent);
    }

    return originalFire.call(this, eventType, evt, bubble);
  }) as typeof Konva.Node.prototype.fire;

  args.state.restoreNodeFire = () => {
    Konva.Node.prototype.fire = originalFire;
  };

  args.hooks.pointerDown.tap((event) => {
    args.state.pointerPressed = true;
    txRecordPointerEvent(args.state, args.render, "pointerdown", event);
  });

  args.hooks.pointerUp.tap((event) => {
    txRecordPointerEvent(args.state, args.render, "pointerup", event);
    args.state.pointerPressed = false;
  });

  args.hooks.pointerOut.tap((event) => {
    txRecordPointerEvent(args.state, args.render, "pointerout", event);
  });

  args.hooks.pointerOver.tap((event) => {
    txRecordPointerEvent(args.state, args.render, "pointerover", event);
  });

  args.hooks.pointerCancel.tap((event) => {
    txRecordPointerEvent(args.state, args.render, "pointercancel", event);
    args.state.pointerPressed = false;
  });

  args.hooks.pointerMove.tap((event) => {
    if (!args.state.recording) {
      return;
    }

    if (args.state.reducedEvents && !args.state.pointerPressed) {
      return;
    }

    txPushStep(args.state, fnCreatePointerMoveStep({ render: args.render, event }));
  });

  args.hooks.pointerWheel.tap((event) => {
    if (!args.state.recording) {
      return;
    }

    txPushStep(args.state, fnCreateWheelStep({ render: args.render, event }));
  });

  args.hooks.keydown.tap((event) => {
    txRecordKeyEvent(args.state, "keydown", event);
    return false;
  });

  args.hooks.keyup.tap((event) => {
    txRecordKeyEvent(args.state, "keyup", event);
    return false;
  });
}

function setupCrdtCapture(args: { state: TRecorderState; crdt: CrdtService }) {
  args.state.restoreCrdtWrite = args.crdt.hooks.write.tap((ops) => {
    if (!args.state.recording) {
      return;
    }

    txPushCrdtOp(
      args.state,
      fnCreateOpsCrdtOp({
        ops: ops as Array<Record<string, unknown>>,
      }),
    );
  });
}

/**
 * Dev-only recorder panel.
 * Captures input hooks and CRDT writes for replay/debug export.
 */
export function createRecorderPlugin(): IPlugin<{
  crdt: CrdtService;
  scene: SceneService;
}, IRuntimeHooks> {
  const state = createRecorderState();

  return {
    name: "recorder",
    apply(ctx) {
      const crdt = ctx.services.require("crdt");
      const render = ctx.services.require("scene");

      ctx.hooks.init.tap(() => {
        state.panelMount = txMountRecorderPanel({
          document,
          SceneService: render,
          renderUi: renderSolid,
          createComponentUi: createComponent,
          CanvasRecorder,
        }, {
          open: state.open,
          setOpen: state.setOpen,
          recording: state.recordingSignal,
          stepCount: state.stepCount,
          opCount: state.opCount,
          reducedEvents: state.reducedEventsSignal,
          setReducedEvents: (value) => {
            state.reducedEvents = value;
            state.recordingData.reducedEvents = value;
            state.setReducedEventsSignal(value);
          },
          canExport: state.canExport,
          actions: {
            start: () => {
              txStartRecording(state, crdt);
            },
            stop: () => {
              txStopRecording(state);
            },
            clear: () => {
              txClearRecording(state);
            },
            copy: () => void txCopyRecording(state),
            export: () => void txExportRecording(state),
          },
        });
        txSyncUi(state);
      });

      setupHookCapture({ state, render, hooks: ctx.hooks });
      setupCrdtCapture({ state, crdt });

      ctx.hooks.destroy.tap(() => {
        state.restoreCrdtWrite?.();
        state.restoreNodeFire?.();
        state.restoreCrdtWrite = null;
        state.restoreNodeFire = null;
        state.panelMount?.dispose();
        state.panelMount = null;
      });
    },
  };
}
