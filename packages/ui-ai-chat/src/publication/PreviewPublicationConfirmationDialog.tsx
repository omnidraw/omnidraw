import * as AlertDialog from "@kobalte/core/alert-dialog"
import { Button } from "@kobalte/core/button"
import type { Component } from "solid-js"
import { createSignal } from "solid-js"
import type {
  TPreviewPublicationSelection,
} from "../canvas-extension/PreviewPortalRuntime"
import styles from "./WidgetPublicationDialog.module.css"

export type TPreviewPublicationConfirmationDialogProps = Readonly<{
  widgetName: string
  selection: TPreviewPublicationSelection
  currentSelection(): TPreviewPublicationSelection | null
  confirm(
    selection: TPreviewPublicationSelection,
  ): Promise<boolean>
  onOpenChange(open: boolean): void
}>

function isSameSelection(
  left: TPreviewPublicationSelection,
  right: TPreviewPublicationSelection,
): boolean {
  return left.draftId === right.draftId
    && left.expectedRevision === right.expectedRevision
    && left.previewId === right.previewId
    && left.previewRevisionId === right.previewRevisionId
    && left.expectedBindingRevision === right.expectedBindingRevision
    && left.expectedBindingPlanDigestSha256
      === right.expectedBindingPlanDigestSha256
    && left.canvasId === right.canvasId
    && left.frameNodeId === right.frameNodeId
    && left.buildSequence === right.buildSequence
}

export const PreviewPublicationConfirmationDialog:
Component<TPreviewPublicationConfirmationDialogProps> = (props) => {
  const [publishing, setPublishing] = createSignal(false)
  const [issue, setIssue] = createSignal("")

  const close = () => {
    if (!publishing()) props.onOpenChange(false)
  }

  const confirm = async () => {
    if (publishing()) return
    const current = props.currentSelection()
    if (current === null || !isSameSelection(props.selection, current)) {
      setIssue(
        "The Preview changed or is no longer ready. Close this confirmation, review the ready frame, and try again.",
      )
      return
    }
    setPublishing(true)
    setIssue("")
    try {
      const published = await props.confirm(props.selection)
      if (!published) {
        setIssue(
          "Publication was rejected because this exact Preview is no longer ready or the server could not publish it.",
        )
        return
      }
      props.onOpenChange(false)
    } catch (error) {
      setIssue(error instanceof Error ? error.message : String(error))
    } finally {
      setPublishing(false)
    }
  }

  return (
    <AlertDialog.Root open onOpenChange={(open) => { if (!open) close() }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay class={styles.overlay} />
        <AlertDialog.Content class={styles.content}>
          <AlertDialog.Title class={styles.title}>
            Publish {props.widgetName}?
          </AlertDialog.Title>
          <AlertDialog.Description class={styles.description}>
            Confirm the exact completed build currently shown in this Preview
            frame. Publication will retain this artifact and binding revision.
          </AlertDialog.Description>

          <dl class={styles.previewDetails}>
            <dt>Draft digest</dt>
            <dd><code>{props.selection.expectedRevision.slice(0, 12)}</code></dd>
            <dt>Build</dt>
            <dd>#{props.selection.buildSequence} complete</dd>
            <dt>Preview revision</dt>
            <dd><code>{props.selection.previewRevisionId.slice(0, 12)}</code></dd>
            <dt>Binding revision</dt>
            <dd>{props.selection.expectedBindingRevision}</dd>
            <dt>Binding plan</dt>
            <dd>
              <code>
                {props.selection.expectedBindingPlanDigestSha256.slice(0, 12)}
              </code>
            </dd>
            <dt>Canvas</dt>
            <dd><code>{props.selection.canvasId}</code></dd>
            <dt>Frame</dt>
            <dd><code>{props.selection.frameNodeId}</code></dd>
          </dl>

          {issue() && (
            <div class={styles.status} data-tone="error" role="alert">
              <strong>Preview changed before publication</strong>
              <p>{issue()}</p>
            </div>
          )}

          <div class={styles.actions}>
            <AlertDialog.CloseButton
              class={styles.button}
              disabled={publishing()}
            >
              Cancel
            </AlertDialog.CloseButton>
            <Button
              class={`${styles.button} ${styles.primary}`}
              disabled={publishing()}
              aria-busy={publishing()}
              onClick={confirm}
            >
              {publishing() ? "Publishing…" : "Publish"}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
