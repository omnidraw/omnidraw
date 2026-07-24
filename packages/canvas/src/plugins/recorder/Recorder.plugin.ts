import type { IPlugin } from "@vibecanvas/runtime";
import {
  createComponent,
  createSignal,
  type Accessor,
  type Setter,
} from "solid-js";
import { render } from "solid-js/web";
import { CanvasRecorder } from "../../components/CanvasRecorder";
import type { TCanvasInputEvent } from "../../engine/input/typed";
import type { CrdtService } from "../../services/crdt/CrdtService";
import type {
  IRuntimeConfig,
  IRuntimeHooks,
  IRuntimeServices,
} from "../../types";
import type { TCrdtOp, TRecording, TStep } from "./CONSTANTS";
import {
  fnCanExportRecording,
  fnCreateEmptyRecording,
  fnCreateInputStep,
  fnCreateOpsCrdtOp,
  fnCreateStartedRecording,
} from "./fn.recording";
import { txSaveJsonFile } from "./tx.file";
import { txMountRecorderPanel } from "./tx.mount";

type TRecorderState = {
  recording: boolean;
  reducedEvents: boolean;
  pointerPressed: boolean;
  recordingData: TRecording;
  inputUnsubscribe: (() => void) | null;
  crdtUnsubscribe: (() => void) | null;
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
  const [reducedEventsSignal, setReducedEventsSignal] = createSignal(true);
  const [canExport, setCanExport] = createSignal(false);
  return {
    recording: false,
    reducedEvents: true,
    pointerPressed: false,
    recordingData: fnCreateEmptyRecording({ reducedEvents: true }),
    inputUnsubscribe: null,
    crdtUnsubscribe: null,
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

function syncUi(state: TRecorderState): void {
  state.setRecordingSignal(state.recording);
  state.setStepCount(state.recordingData.steps.length);
  state.setOpCount(state.recordingData.crdtOps.length);
  state.setReducedEventsSignal(state.reducedEvents);
  state.setCanExport(fnCanExportRecording({
    recording: state.recordingData,
  }));
}

function pushStep(state: TRecorderState, step: TStep): void {
  state.recordingData.steps.push(step);
  syncUi(state);
}

function pushCrdtOp(state: TRecorderState, op: TCrdtOp): void {
  state.recordingData.crdtOps.push(op);
  syncUi(state);
}

function recordInput(state: TRecorderState, event: TCanvasInputEvent): void {
  if (!state.recording) {
    return;
  }
  if (event.type === "pointer-down") {
    state.pointerPressed = true;
  }
  if (
    event.type === "pointer-move"
    && state.reducedEvents
    && !state.pointerPressed
  ) {
    return;
  }
  pushStep(state, fnCreateInputStep({ event }));
  if (event.type === "pointer-up" || event.type === "pointer-cancel") {
    state.pointerPressed = false;
  }
}

function recordingJson(state: TRecorderState): string {
  return JSON.stringify(state.recordingData, null, 2);
}

async function copyRecording(
  state: TRecorderState,
  document: Document,
): Promise<void> {
  const content = recordingJson(state);
  const clipboard = document.defaultView?.navigator.clipboard;
  if (clipboard?.writeText !== undefined) {
    await clipboard.writeText(content);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.setAttribute("readonly", "true");
  Object.assign(textarea.style, {
    position: "fixed",
    opacity: "0",
  });
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function exportRecording(
  state: TRecorderState,
  document: Document,
): Promise<void> {
  const view = document.defaultView;
  const pickerView = view as (Window & typeof globalThis & {
    showSaveFilePicker?: Parameters<
      typeof txSaveJsonFile
    >[0]["showSaveFilePicker"];
  }) | null;
  await txSaveJsonFile(
    {
      document,
      url: view?.URL ?? URL,
      createBlob: (parts, options) => new Blob(parts, options),
      isAbortError: (error) => {
        return error instanceof DOMException && error.name === "AbortError";
      },
      ...(pickerView?.showSaveFilePicker === undefined
        ? {}
        : {
            showSaveFilePicker:
              pickerView.showSaveFilePicker.bind(pickerView),
          }),
    },
    {
      fileName: `${state.recordingData.name}.json`,
      content: recordingJson(state),
    },
  );
}

function startRecording(
  state: TRecorderState,
  crdt: CrdtService,
  now: number,
): void {
  state.recordingData = fnCreateStartedRecording({
    initialDoc: crdt.doc(),
    reducedEvents: state.reducedEvents,
    now,
  });
  state.recording = true;
  state.pointerPressed = false;
  syncUi(state);
}

/**
 * Dev-only recorder of normalized engine input and product CRDT writes.
 */
export function createRecorderPlugin(): IPlugin<
  IRuntimeServices,
  IRuntimeHooks,
  IRuntimeConfig
> {
  const state = createRecorderState();
  return {
    name: "recorder",
    apply(ctx) {
      const crdt = ctx.services.require("crdt");
      const scene = ctx.services.require("scene");
      const document = scene.container.ownerDocument;

      ctx.hooks.init.tap(() => {
        state.panelMount = txMountRecorderPanel(
          {
            document,
            scene,
            renderUi: render,
            createComponentUi: createComponent,
            CanvasRecorder,
          },
          {
            open: state.open,
            setOpen: state.setOpen,
            recording: state.recordingSignal,
            stepCount: state.stepCount,
            opCount: state.opCount,
            reducedEvents: state.reducedEventsSignal,
            setReducedEvents: (value) => {
              state.reducedEvents = value;
              state.recordingData.reducedEvents = value;
              syncUi(state);
            },
            canExport: state.canExport,
            actions: {
              start: () => startRecording(state, crdt, Date.now()),
              stop: () => {
                state.recording = false;
                state.pointerPressed = false;
                syncUi(state);
              },
              clear: () => {
                state.recording = false;
                state.pointerPressed = false;
                state.recordingData = fnCreateEmptyRecording({
                  reducedEvents: state.reducedEvents,
                });
                syncUi(state);
              },
              copy: () => void copyRecording(state, document),
              export: () => void exportRecording(state, document),
            },
          },
        );
        state.inputUnsubscribe = scene.input.subscribe((event) => {
          recordInput(state, event);
        });
        state.crdtUnsubscribe = crdt.hooks.write.tap((ops) => {
          if (!state.recording) {
            return;
          }
          pushCrdtOp(state, fnCreateOpsCrdtOp({
            ops: ops as unknown as Array<Record<string, unknown>>,
          }));
        });
        syncUi(state);
      });

      ctx.hooks.destroy.tap(() => {
        state.inputUnsubscribe?.();
        state.crdtUnsubscribe?.();
        state.inputUnsubscribe = null;
        state.crdtUnsubscribe = null;
        state.recording = false;
        state.pointerPressed = false;
        state.panelMount?.dispose();
        state.panelMount = null;
      });
    },
  };
}
