import * as AlertDialog from "@kobalte/core/alert-dialog";
import { Button } from "@kobalte/core/button";
import { Show, createEffect, createSignal, type Component } from "solid-js";
import type {
  TCanvasDeletionPlan,
  TCanvasDeletionResult,
} from "@/core/app/private-operation-contract";
import type { TApiError, TSafeResult, TSidebarCanvas } from "../ports";
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

function consequence(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export const DeleteCanvasDialog: Component<DeleteCanvasDialogProps> = (props) => {
  const [phase, setPhase] = createSignal<TPhase>("idle");
  const [plan, setPlan] = createSignal<TCanvasDeletionPlan | null>(null);
  const [error, setError] = createSignal<TApiError | null>(null);
  let requestGeneration = 0;
  let deletionId = "";

  const secondaryButtonClass = `${styles.button} ${styles.secondaryButton}`;
  const destructiveButtonClass = `${styles.button} ${styles.destructiveButton}`;
  const busy = () => phase() === "deleting";

  const loadPlan = async (reviewError: TApiError | null = null) => {
    const canvas = props.canvas;
    if (!props.open || canvas === null) return;
    const generation = ++requestGeneration;
    setPhase("planning");
    setPlan(null);
    setError(reviewError);
    const [planError, nextPlan] = await props.onPlan(canvas.id);
    if (generation !== requestGeneration || !props.open || props.canvas?.id !== canvas.id) return;
    if (planError || !nextPlan) {
      setError(planError ?? ({ message: "The deletion summary is unavailable." } as TApiError));
      setPhase("failed");
      return;
    }
    setPlan(nextPlan);
    setPhase("ready");
  };

  createEffect(() => {
    const canvasId = props.open ? props.canvas?.id : undefined;
    if (canvasId === undefined) {
      requestGeneration += 1;
      setPhase("idle");
      setPlan(null);
      setError(null);
      deletionId = "";
      return;
    }
    deletionId = props.createDeletionId();
    void loadPlan();
  });

  const handleOpenChange = (open: boolean) => {
    if (!open && busy()) return;
    props.onOpenChange(open);
  };

  const handleDelete = async () => {
    const exactPlan = plan();
    if (exactPlan === null || phase() === "deleting") return;
    setError(null);
    setPhase("deleting");
    const [deleteError, result] = await props.onDelete({ deletionId, plan: exactPlan });
    if (deleteError || !result) {
      if (deleteError?.code === "CANVAS_DELETE_STALE") {
        await loadPlan(deleteError);
      } else {
        setError(deleteError ?? ({ message: "Canvas deletion did not complete." } as TApiError));
        setPhase("failed");
      }
      return;
    }
    await props.onDeleted(result);
    props.onOpenChange(false);
  };

  return (
    <AlertDialog.Root open={props.open} onOpenChange={handleOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay class={styles.overlay} />
        <AlertDialog.Content
          class={styles.content}
          onCloseAutoFocus={(event) => {
            const target = props.returnFocus?.();
            if (!target?.isConnected) return;
            event.preventDefault();
            target.focus();
          }}
        >
          <AlertDialog.Title class={styles.title}>Delete Canvas</AlertDialog.Title>
          <AlertDialog.Description class={styles.description}>
            <Show when={plan()} fallback={<>Preparing the exact deletion summary for “{props.canvas?.name}”…</>}>
              {(exact) => <>
                Permanently delete “{exact().canvas.name}” at revision {exact().canvas.revision}? This removes {consequence(exact().itemCount, "Canvas item")} and {consequence(exact().mediaCount, "media file")}. {consequence(exact().retainedChatCount, "AI Chat history", "AI Chat histories")} and their workspaces will be retained, detached, and archived.
              </>}
            </Show>
          </AlertDialog.Description>

          <Show when={error()}>
            {(failure) => <p class={styles.formError} role="alert">{failure().message}</p>}
          </Show>

          <div class={styles.actions}>
            <AlertDialog.CloseButton
              class={secondaryButtonClass}
              disabled={busy()}
            >
              Cancel
            </AlertDialog.CloseButton>
            <Button
              class={destructiveButtonClass}
              disabled={(phase() !== "ready" && phase() !== "failed") || plan() === null}
              onClick={() => void handleDelete()}
            >
              {busy() ? "Deleting…" : phase() === "failed" ? "Retry deletion" : "Delete Canvas"}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
};

export default DeleteCanvasDialog;
