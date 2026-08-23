import { Portal } from "@solidjs/web";
import { Show, createEffect, createSignal, createUniqueId, type Component } from "solid-js";
import type {
  TCanvasDeletionPlan,
  TCanvasDeletionResult,
} from "@/core/app/private-operation-contract";
import type { TApiError, TSafeResult, TSidebarCanvas } from "../ports";
import { activateModalFocusScope } from "../../../components/ui/modal-focus-scope";
import styles from "./SidebarDialog.module.css";

export type DeleteCanvasDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canvas: TSidebarCanvas | null;
  createDeletionId: () => string;
  onPlan: (canvasId: string) => Promise<TSafeResult<TCanvasDeletionPlan>>;
  onDelete: (args: Readonly<{
    deletionId: string;
    plan: TCanvasDeletionPlan;
  }>) => Promise<TSafeResult<TCanvasDeletionResult>>;
  onDeleted: (result: TCanvasDeletionResult) => Promise<void>;
  returnFocus?: () => HTMLElement | null;
};

type TPhase = "idle" | "planning" | "ready" | "deleting" | "failed";
type TPlanRequest = Readonly<{
  canvas: TSidebarCanvas;
  onPlan: DeleteCanvasDialogProps["onPlan"];
}>;

function consequence(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export const DeleteCanvasDialog: Component<DeleteCanvasDialogProps> = (props) => {
  const [phase, setPhase] = createSignal<TPhase>("idle");
  const [plan, setPlan] = createSignal<TCanvasDeletionPlan | null>(null);
  const [error, setError] = createSignal<TApiError | null>(null);
  let requestGeneration = 0;
  let deletionId = "";
  let deleteInFlight = false;
  let content: HTMLDivElement | undefined;
  let cancelButton: HTMLButtonElement | undefined;
  const titleId = createUniqueId();
  const descriptionId = createUniqueId();

  const secondaryButtonClass = `${styles.button} ${styles.secondaryButton}`;
  const destructiveButtonClass = `${styles.button} ${styles.destructiveButton}`;
  const busy = () => phase() === "deleting";

  const loadPlan = async (request: TPlanRequest, reviewError: TApiError | null = null) => {
    const { canvas, onPlan } = request;
    const generation = ++requestGeneration;
    setPhase("planning");
    setPlan(null);
    setError(reviewError);
    const [planError, nextPlan] = await onPlan(canvas.id);
    if (generation !== requestGeneration) return;
    if (planError || !nextPlan) {
      setError(planError ?? ({ message: "The deletion summary is unavailable." } as TApiError));
      setPhase("failed");
      return;
    }
    setPlan(nextPlan);
    setPhase("ready");
  };

  createEffect(
    () => props.open && props.canvas !== null
      ? {
          canvas: props.canvas,
          createDeletionId: props.createDeletionId,
          onPlan: props.onPlan,
        }
      : null,
    (request) => {
      if (request === null) {
        requestGeneration += 1;
        deleteInFlight = false;
        setPhase("idle");
        setPlan(null);
        setError(null);
        deletionId = "";
        return;
      }
      deletionId = request.createDeletionId();
      void loadPlan(request);
    },
  );

  const handleOpenChange = (open: boolean) => {
    if (!open && busy()) return;
    props.onOpenChange(open);
  };

  createEffect(
    () => props.open,
    (open) => {
      if (!open) return;
      return activateModalFocusScope({
        content: () => content,
        escapeDisabled: () => deleteInFlight,
        initialFocus: () => cancelButton,
        onEscape: () => handleOpenChange(false),
        ownerDocument: content?.ownerDocument ?? document,
        returnFocus: props.returnFocus,
      });
    },
  );

  const handleDelete = async () => {
    const exactPlan = plan();
    if (exactPlan === null || deleteInFlight) return;
    deleteInFlight = true;
    setError(null);
    setPhase("deleting");
    try {
      const [deleteError, result] = await props.onDelete({ deletionId, plan: exactPlan });
      if (deleteError || !result) {
        if (deleteError?.code === "CANVAS_DELETE_STALE") {
          const canvas = props.canvas;
          if (canvas !== null) {
            await loadPlan({ canvas, onPlan: props.onPlan }, deleteError);
          }
        } else {
          setError(deleteError ?? ({ message: "Canvas deletion did not complete." } as TApiError));
          setPhase("failed");
        }
        return;
      }
      await props.onDeleted(result);
      props.onOpenChange(false);
    } finally {
      deleteInFlight = false;
    }
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class={styles.overlay}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) handleOpenChange(false);
          }}
        />
        <div
          ref={(element) => { content = element; }}
          class={styles.content}
          role="alertdialog"
          aria-modal="true"
          tabindex="-1"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        >
          <h2 id={titleId} class={styles.title}>Delete Canvas</h2>
          <div id={descriptionId} class={styles.description}>
            <Show when={plan()} fallback={<>Preparing the exact deletion summary for “{props.canvas?.name}”…</>}>
              {(exact) => <>
                Permanently delete “{exact().canvas.name}” at revision {exact().canvas.revision}? This removes {consequence(exact().itemCount, "Canvas item")} and {consequence(exact().mediaCount, "media file")}. {consequence(exact().retainedChatCount, "AI Chat history", "AI Chat histories")} and their workspaces will be retained, detached, and archived.
              </>}
            </Show>
          </div>

          <Show when={error()}>
            {(failure) => <p class={styles.formError} role="alert">{failure().message}</p>}
          </Show>

          <div class={styles.actions}>
            <button
              type="button"
              ref={(element) => { cancelButton = element; }}
              class={secondaryButtonClass}
              disabled={busy()}
              onClick={() => handleOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              class={destructiveButtonClass}
              disabled={(phase() !== "ready" && phase() !== "failed") || plan() === null}
              onClick={() => void handleDelete()}
            >
              {busy() ? "Deleting…" : phase() === "failed" ? "Retry deletion" : "Delete Canvas"}
            </button>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

export default DeleteCanvasDialog;
