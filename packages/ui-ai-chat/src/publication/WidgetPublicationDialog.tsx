import * as AlertDialog from "@kobalte/core/alert-dialog"
import { Button } from "@kobalte/core/button"
import type { TWidgetDetail } from "@omnidraw/orpc-client"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, untrack, type Component } from "solid-js"
import {
  fnIsExactPublicationDraftDetail,
  fnPublicationContract,
  fnPublicationFailureTitle,
} from "./fn.publication-contract"
import type {
  TResolveWidgetPublicationPreviewSelections,
  TWidgetPublicationApi,
  TWidgetPublicationPreviewSelection,
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
  createIdempotencyKey: () => string
  getPinnedRevision?: () => string
  resolvePreviewSelections: TResolveWidgetPublicationPreviewSelections
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
  const [previewSelections, setPreviewSelections] = createSignal<
    readonly TWidgetPublicationPreviewSelection[]
  >([])
  const [selectedPreviewKey, setSelectedPreviewKey] = createSignal("")
  let detailRequest = 0
  let publicationAttempt: Readonly<{
    idempotencyKey: string
    identity: string | null
  }> | null = null

  const previewKey = (selection: TWidgetPublicationPreviewSelection) =>
    `${selection.previewId}:${selection.previewRevisionId}:${selection.expectedBindingRevision}:${selection.expectedBindingPlanDigestSha256}`
  const contract = createMemo(() => {
    const current = detail()
    return current ? fnPublicationContract(current) : null
  })
  const selectedPreview = createMemo(() => {
    const key = selectedPreviewKey()
    return previewSelections().find((selection) => previewKey(selection) === key) ?? null
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
    previewAvailable: previewSelections().length > 0,
    previewSelected: selectedPreview() !== null,
    actionLabel: contract()?.actionLabel ?? "Publish",
  })

  const setResolvedPreviewSelections = (
    selections: readonly TWidgetPublicationPreviewSelection[],
  ) => {
    const ordered = [...selections].sort((left, right) =>
      left.label.localeCompare(right.label)
      || previewKey(left).localeCompare(previewKey(right)))
    const previousKey = selectedPreviewKey()
    setPreviewSelections(ordered)
    setSelectedPreviewKey(
      ordered.some((selection) => previewKey(selection) === previousKey)
        ? previousKey
        : ordered.length === 1 && ordered[0]
          ? previewKey(ordered[0])
          : "",
    )
  }

  const loadCurrentDetail = async () => {
    const request = ++detailRequest
    setLoading(true)
    setIssue(null)
    emitState()
    let loadError: Error | null | undefined
    let value: TWidgetDetail | null | undefined
    let selections: readonly TWidgetPublicationPreviewSelection[]
    try {
      [[loadError, value], selections] = await Promise.all([
        props.api.widgets.detail({ name: props.draftName, source: "draft" }),
        props.resolvePreviewSelections(),
      ])
    } catch (error) {
      if (request !== detailRequest) return null
      setDetail(null)
      setResolvedPreviewSelections([])
      setLoading(false)
      setIssue({
        title: "Ready Preview lookup failed",
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      })
      emitState()
      return null
    }
    if (request !== detailRequest) return null
    setLoading(false)
    if (loadError || !value || value.source !== "draft") {
      setDetail(null)
      setResolvedPreviewSelections([])
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
      setResolvedPreviewSelections([])
      setIssue({
        title: "Widget draft identity changed",
        message: `The draft returned for “${props.draftName}” does not belong to this Preview. Refresh or reopen the Preview before publishing.`,
        tone: "error",
      })
      emitState()
      return null
    }
    setDetail(value)
    setResolvedPreviewSelections(selections)
    if (selections.length === 0) {
      setIssue({
        title: "Ready Preview required",
        message: "Open or place this draft on a canvas, wait for its Preview to become ready, then publish from that Preview title bar or return here.",
        tone: "error",
      })
    }
    emitState()
    return value
  }

  createEffect(() => {
    if (!props.open) {
      publicationAttempt = null
      return
    }
    if (publicationAttempt === null) {
      publicationAttempt = {
        idempotencyKey: props.createIdempotencyKey(),
        identity: null,
      }
    }
  })

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
    const confirmedSelection = selectedPreview()
    if (!confirmed || !confirmedSelection || publishing() || previewIsStale()) return
    setPublishing(true)
    setIssue(null)
    emitState()

    let refreshError: Error | null | undefined
    let current: TWidgetDetail | null | undefined
    let refreshedSelections: readonly TWidgetPublicationPreviewSelection[]
    try {
      [[refreshError, current], refreshedSelections] = await Promise.all([
        props.api.widgets.detail({ name: props.draftName, source: "draft" }),
        props.resolvePreviewSelections(),
      ])
    } catch (error) {
      setPublishing(false)
      setIssue({
        title: "Could not verify the ready Preview",
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      })
      emitState()
      return
    }
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
    const confirmedPreviewKey = previewKey(confirmedSelection)
    if (!refreshedSelections.some(
      (selection) => previewKey(selection) === confirmedPreviewKey,
    )) {
      setResolvedPreviewSelections(refreshedSelections)
      setPublishing(false)
      setIssue({
        title: "Preview changed before publication",
        message: refreshedSelections.length === 0
          ? "That ready Preview is no longer retained. Open or place the draft on a canvas and publish from a newly ready Preview."
          : "The selected Preview frame advanced while this dialog was open. Review the exact ready Preview below, then confirm publication again.",
        tone: "error",
      })
      emitState()
      return
    }

    const publicationIdentity = [
      props.draftId,
      current.variant.revision,
      confirmedPreviewKey,
    ].join(":")
    if (
      publicationAttempt === null
      || (
        publicationAttempt.identity !== null
        && publicationAttempt.identity !== publicationIdentity
      )
    ) {
      publicationAttempt = {
        idempotencyKey: props.createIdempotencyKey(),
        identity: publicationIdentity,
      }
    } else if (publicationAttempt.identity === null) {
      publicationAttempt = {
        ...publicationAttempt,
        identity: publicationIdentity,
      }
    }
    let publishResponse: Awaited<
      ReturnType<TWidgetPublicationApi["widgetPublish"]["publish"]>
    >
    try {
      publishResponse = await props.api.widgetPublish.publish({
        idempotencyKey: publicationAttempt.idempotencyKey,
        draftId: props.draftId,
        expectedRevision: current.variant.revision,
        previewId: confirmedSelection.previewId,
        previewRevisionId: confirmedSelection.previewRevisionId,
        expectedBindingRevision: confirmedSelection.expectedBindingRevision,
        expectedBindingPlanDigestSha256:
          confirmedSelection.expectedBindingPlanDigestSha256,
        canvasId: confirmedSelection.canvasId,
        frameNodeId: confirmedSelection.frameNodeId,
      })
    } catch (error) {
      setPublishing(false)
      setIssue({
        title: "Publication request failed",
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      })
      emitState()
      return
    }
    const [publishError, result] = publishResponse
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
    if (
      result.draftId !== props.draftId
      || result.revision !== current.variant.revision
    ) {
      setPublishing(false)
      setIssue({
        title: "Publication response did not match the selected Preview",
        message: "The server returned a different draft identity or revision. Nothing in this dialog will be treated as published.",
        tone: "error",
      })
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

          <Show when={previewSelections().length > 0 && issue()?.tone !== "success"}>
            <label class={styles.previewSelection}>
              <span>Exact ready Preview</span>
              <select
                value={selectedPreviewKey()}
                disabled={publishing()}
                onChange={(event) => {
                  setSelectedPreviewKey(event.currentTarget.value)
                  emitState()
                }}
              >
                <Show when={!selectedPreview()}>
                  <option value="" disabled>Select a ready Preview frame…</option>
                </Show>
                <For each={previewSelections()}>
                  {(selection) => <option value={previewKey(selection)}>
                    {selection.label} · revision {selection.previewRevisionId.slice(0, 12)}
                  </option>}
                </For>
              </select>
              <Show
                when={selectedPreview()}
                fallback={<small>Choose the exact frame whose retained Preview you reviewed.</small>}
              >
                {(selection) => <small>
                  Draft digest {(detail()?.variant.contentFingerprint ?? detail()?.variant.revision ?? "unknown").slice(0, 12)}
                  {" · "}Preview {selection().previewRevisionId.slice(0, 12)}
                  {" · "}binding revision {selection().expectedBindingRevision}
                  {" · "}binding plan {
                    selection().expectedBindingPlanDigestSha256.slice(0, 12)
                  }
                  {" · "}frame {selection().frameNodeId}
                </small>}
              </Show>
            </label>
          </Show>

          <div class={styles.actions}>
            <AlertDialog.CloseButton class={styles.button} disabled={publishing()}>{issue()?.tone === "success" ? "Done" : "Cancel"}</AlertDialog.CloseButton>
            <Show when={issue()?.tone !== "success" && previewIsStale() && props.onRequestPreviewRefresh}>
              <Button class={`${styles.button} ${styles.primary}`} disabled={publishing()} onClick={refreshPreview}>{publishing() ? "Refreshing…" : "Refresh Preview"}</Button>
            </Show>
            <Show when={issue()?.tone !== "success" && !previewIsStale()}>
              <Button
                class={`${styles.button} ${styles.primary}`}
                disabled={loading() || publishing() || !detail() || !selectedPreview()}
                onClick={publish}
              >
                {publishing()
                  ? `${contract()?.actionLabel ?? "Publish"}ing…`
                  : selectedPreview()
                    ? contract()?.actionLabel ?? "Publish"
                    : previewSelections().length > 0
                      ? "Choose Preview"
                      : "Needs Preview"}
              </Button>
            </Show>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
