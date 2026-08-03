import * as AlertDialog from "@kobalte/core/alert-dialog"
import { Button } from "@kobalte/core/button"
import type { Component } from "solid-js"
import { createSignal } from "solid-js"
import { fnPublicationPhaseLabel } from "./fn.publication-contract"
import type {
  TWidgetPublicationPhase,
  TWidgetPublicationTarget,
} from "./interface"
import styles from "./WidgetPublicationDialog.module.css"

export type TPreviewPublicationConfirmationDialogProps = Readonly<{
  widgetName: string
  target: TWidgetPublicationTarget
  confirm(): Promise<boolean>
  onOpenChange(open: boolean): void
}>

export const PreviewPublicationConfirmationDialog:
Component<TPreviewPublicationConfirmationDialogProps> = (props) => {
  const [publishing, setPublishing] = createSignal(false)
  const [publicationPhase, setPublicationPhase] =
    createSignal<TWidgetPublicationPhase>("idle")
  const [issue, setIssue] = createSignal("")

  const close = () => {
    if (!publishing()) props.onOpenChange(false)
  }

  const confirm = async () => {
    if (publishing()) return
    setPublishing(true)
    setPublicationPhase("building")
    setIssue("")
    try {
      const published = await props.confirm()
      if (!published) {
        setPublicationPhase("failed")
        setIssue(
          "The current draft could not be published. Review the Preview status and diagnostics, then try again.",
        )
        return
      }
      setPublicationPhase("success")
      props.onOpenChange(false)
    } catch (error) {
      setPublicationPhase("failed")
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
            Publish the current draft through this Preview frame. Omnidraw will
            reuse its ready build or build the latest source before publishing.
          </AlertDialog.Description>

          <dl class={styles.previewDetails}>
            <dt>Source</dt>
            <dd>Current source at Publish time</dd>
            <dt>Canvas</dt>
            <dd><code>{props.target.canvasId}</code></dd>
            <dt>Frame</dt>
            <dd><code>{props.target.frameNodeId}</code></dd>
          </dl>

          {issue() && (
            <div class={styles.status} data-tone="error" role="alert">
              <strong>Could not publish current draft</strong>
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
              {publishing()
                ? fnPublicationPhaseLabel(publicationPhase())
                : fnPublicationPhaseLabel("idle")}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
