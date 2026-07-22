import * as AlertDialog from "@kobalte/core/alert-dialog"
import { Button } from "@kobalte/core/button"
import type { TWidgetDetail } from "@vibecanvas/orpc-client"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, untrack, type Component } from "solid-js"
import {
  fnIsExactPublicationDraftDetail,
  fnPublicationContract,
  fnPublicationFailureTitle,
} from "./fn.publication-contract"
import type {
  TWidgetPublicationApi,
  TWidgetPublicationState,
  TWidgetPublicationSuccess,
} from "./interface"
import styles from "./WidgetPublicationDialog.module.css"

type TDialogIssue = {
  title: string
  message: string
  diagnostics?: string[]
  tone: "error" | "success"
}

export type TWidgetPublicationDialogProps = {
  api: TWidgetPublicationApi
  draftId: string
  draftName: string
  open: boolean
  getPinnedRevision?: () => string
  onOpenChange: (open: boolean) => void
  onStateChange?: (state: TWidgetPublicationState) => void
  onPublished?: (success: TWidgetPublicationSuccess) => void | Promise<void>
  onRequestPreviewRefresh?: () => void | Promise<void>
}

export const WidgetPublicationDialog: Component<TWidgetPublicationDialogProps> = (props) => {
  const [detail, setDetail] = createSignal<TWidgetDetail | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [publishing, setPublishing] = createSignal(false)
  const [issue, setIssue] = createSignal<TDialogIssue | null>(null)
  let detailRequest = 0

  const contract = createMemo(() => {
    const current = detail()
    return current ? fnPublicationContract(current) : null
  })
  const previewIsStale = createMemo(() => {
    const current = detail()
    const pinnedRevision = props.getPinnedRevision?.()
    return Boolean(current && pinnedRevision && pinnedRevision !== current.variant.revision)
  })

  const emitState = () => props.onStateChange?.({
    open: props.open,
    loading: loading(),
    publishing: publishing(),
    actionLabel: contract()?.actionLabel ?? "Publish",
  })

  const loadCurrentDetail = async () => {
    const request = ++detailRequest
    setLoading(true)
    setIssue(null)
    emitState()
    const [loadError, value] = await props.api.widgets.detail({ name: props.draftName, source: "draft" })
    if (request !== detailRequest) return null
    setLoading(false)
    if (loadError || !value || value.source !== "draft") {
      setDetail(null)
      setIssue({
        title: value ? "Widget draft is unavailable" : "Widget draft not found",
        message: loadError?.message ?? `The widget draft “${props.draftName}” could not be loaded.`,
        tone: "error",
      })
      emitState()
      return null
    }
    if (!fnIsExactPublicationDraftDetail(value, {
      draftId: props.draftId,
      draftName: props.draftName,
    })) {
      setDetail(null)
      setIssue({
        title: "Widget draft identity changed",
        message: `The draft returned for “${props.draftName}” does not belong to this Preview. Refresh or reopen the Preview before publishing.`,
        tone: "error",
      })
      emitState()
      return null
    }
    setDetail(value)
    emitState()
    return value
  }

  createEffect(() => {
    void props.draftId
    void props.draftName
    untrack(() => { void loadCurrentDetail() })
  })

  createEffect(() => {
    if (!props.open) return
    untrack(() => { void loadCurrentDetail() })
  })

  createEffect(emitState)

  const close = () => {
    if (publishing()) return
    props.onOpenChange(false)
  }

  const refreshPreview = async () => {
    if (!props.onRequestPreviewRefresh || publishing()) return
    setPublishing(true)
    emitState()
    try {
      await props.onRequestPreviewRefresh()
      props.onOpenChange(false)
    } catch (error) {
      setIssue({
        title: "Preview refresh failed",
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      })
    } finally {
      setPublishing(false)
      emitState()
    }
  }

  const publish = async () => {
    const confirmed = detail()
    if (!confirmed || publishing() || previewIsStale()) return
    setPublishing(true)
    setIssue(null)
    emitState()

    const [refreshError, current] = await props.api.widgets.detail({ name: props.draftName, source: "draft" })
    if (refreshError || !current || current.source !== "draft") {
      setPublishing(false)
      setIssue({
        title: "Could not verify the draft",
        message: refreshError?.message ?? `The widget draft “${props.draftName}” is no longer available.`,
        tone: "error",
      })
      emitState()
      return
    }
    if (!fnIsExactPublicationDraftDetail(current, {
      draftId: props.draftId,
      draftName: props.draftName,
    })) {
      setDetail(null)
      setPublishing(false)
      setIssue({
        title: "Draft identity changed before publication",
        message: "The current draft no longer belongs to this Preview. Refresh or reopen the Preview before publishing.",
        tone: "error",
      })
      emitState()
      return
    }
    if (current.variant.revision !== confirmed.variant.revision) {
      setDetail(current)
      setPublishing(false)
      setIssue({
        title: "Draft changed before publication",
        message: "Review the current revision below, then click Publish again to confirm this newer draft.",
        tone: "error",
      })
      emitState()
      return
    }

    const [publishError, result] = await props.api.widgetPublish.publish({
      draftId: props.draftId,
      expectedRevision: current.variant.revision,
    })
    if (publishError) {
      setPublishing(false)
      setIssue({ title: "Publication request failed", message: publishError.message, tone: "error" })
      emitState()
      return
    }
    if (!result.published) {
      setPublishing(false)
      const failureIssue: TDialogIssue = {
        title: fnPublicationFailureTitle(result.reason),
        message: result.message,
        diagnostics: [...result.errors, ...result.warnings],
        tone: "error",
      }
      if (result.reason === "stale-revision") await loadCurrentDetail()
      setIssue(failureIssue)
      emitState()
      return
    }

    setDetail({
      ...current,
      relation: "same",
      sibling: { ...current.variant, source: "published" },
    })
    setIssue({
      title: "Widget published",
      message: "The latest draft is now the published widget definition.",
      tone: "success",
    })
    try {
      await props.onPublished?.({ detail: current, result })
    } catch (error) {
      setIssue({
        title: "Widget published; refresh failed",
        message: error instanceof Error ? error.message : String(error),
        tone: "success",
      })
    }
    setPublishing(false)
    emitState()
  }

  return (
    <AlertDialog.Root open={props.open} onOpenChange={(open) => { if (open) props.onOpenChange(true); else close() }}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay class={styles.overlay} />
        <AlertDialog.Content class={styles.content}>
          <Switch>
            <Match when={loading()}>
              <AlertDialog.Title class={styles.title}>Checking current draft…</AlertDialog.Title>
              <AlertDialog.Description class={styles.description}>Loading the latest draft revision and publication relationship.</AlertDialog.Description>
            </Match>
            <Match when={contract()}>
              {(currentContract) => <>
                <AlertDialog.Title class={styles.title}>{currentContract().title}</AlertDialog.Title>
                <AlertDialog.Description class={styles.description}>{currentContract().description}</AlertDialog.Description>
                <Show when={previewIsStale()}>
                  <div class={styles.status} data-tone="error" role="alert">
                    <strong>Preview revision is stale</strong>
                    <p>This Preview is out of date. Refresh it, review the latest result, then confirm publication again.</p>
                  </div>
                </Show>
              </>}
            </Match>
            <Match when={!loading()}>
              <AlertDialog.Title class={styles.title}>Publication unavailable</AlertDialog.Title>
              <AlertDialog.Description class={styles.description}>The latest draft state could not be loaded.</AlertDialog.Description>
            </Match>
          </Switch>

          <Show when={issue()}>
            {(currentIssue) => <div class={styles.status} data-tone={currentIssue().tone} role={currentIssue().tone === "error" ? "alert" : "status"}>
              <strong>{currentIssue().title}</strong><p>{currentIssue().message}</p>
              <Show when={currentIssue().diagnostics?.length}>
                <ul class={styles.diagnostics}><For each={currentIssue().diagnostics}>{(diagnostic) => <li>{diagnostic}</li>}</For></ul>
              </Show>
            </div>}
          </Show>

          <div class={styles.actions}>
            <AlertDialog.CloseButton class={styles.button} disabled={publishing()}>{issue()?.tone === "success" ? "Done" : "Cancel"}</AlertDialog.CloseButton>
            <Show when={issue()?.tone !== "success" && previewIsStale() && props.onRequestPreviewRefresh}>
              <Button class={`${styles.button} ${styles.primary}`} disabled={publishing()} onClick={refreshPreview}>{publishing() ? "Refreshing…" : "Refresh Preview"}</Button>
            </Show>
            <Show when={issue()?.tone !== "success" && !previewIsStale()}>
              <Button class={`${styles.button} ${styles.primary}`} disabled={loading() || publishing() || !detail()} onClick={publish}>{publishing() ? `${contract()?.actionLabel ?? "Publish"}ing…` : contract()?.actionLabel ?? "Publish"}</Button>
            </Show>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
