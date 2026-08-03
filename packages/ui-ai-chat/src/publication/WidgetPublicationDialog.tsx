import * as AlertDialog from "@kobalte/core/alert-dialog"
import { Button } from "@kobalte/core/button"
import type { TWidgetDetail } from "@omnidraw/orpc-client"
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, untrack, type Component } from "solid-js"
import {
  fnIsExactPublicationDraftDetail,
  fnPublicationContract,
  fnPublicationFailureTitle,
  fnPublicationPhaseLabel,
} from "./fn.publication-contract"
import type {
  TResolveWidgetPublicationTargets,
  TWidgetPublicationApi,
  TWidgetPublicationPhase,
  TWidgetPublicationTarget,
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
  resolvePreviewSelections: TResolveWidgetPublicationTargets
  onOpenChange: (open: boolean) => void
  onStateChange?: (state: TWidgetPublicationState) => void
  onPublished?: (success: TWidgetPublicationSuccess) => void | Promise<void>
}

export const WidgetPublicationDialog: Component<TWidgetPublicationDialogProps> = (props) => {
  const [detail, setDetail] = createSignal<TWidgetDetail | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [publishing, setPublishing] = createSignal(false)
  const [publicationPhase, setPublicationPhase] =
    createSignal<TWidgetPublicationPhase>("idle")
  const [issue, setIssue] = createSignal<TDialogIssue | null>(null)
  const [previewSelections, setPreviewSelections] = createSignal<
    readonly TWidgetPublicationTarget[]
  >([])
  const [selectedPreviewKey, setSelectedPreviewKey] = createSignal("")
  let detailRequest = 0
  let progressSession = 0
  let progressIterator: AsyncIterator<unknown> | null = null
  let publicationAttempt: Readonly<{
    idempotencyKey: string
    identity: string | null
  }> | null = null

  const previewKey = (selection: TWidgetPublicationTarget) =>
    `${selection.draftId}:${selection.previewId}:${selection.canvasId}:${selection.frameNodeId}`
  const contract = createMemo(() => {
    const current = detail()
    return current ? fnPublicationContract(current) : null
  })
  const selectedPreview = createMemo(() => {
    const key = selectedPreviewKey()
    return previewSelections().find((selection) => previewKey(selection) === key) ?? null
  })

  const emitState = () => props.onStateChange?.({
    open: props.open,
    loading: loading(),
    publishing: publishing(),
    previewAvailable: previewSelections().length > 0,
    previewSelected: selectedPreview() !== null,
    phase: publicationPhase(),
    actionLabel: contract()?.actionLabel ?? "Publish",
  })

  const stopPublicationProgress = () => {
    progressSession += 1
    const iterator = progressIterator
    progressIterator = null
    if (iterator?.return) void iterator.return().catch(() => undefined)
  }

  const startPublicationProgress = (target: TWidgetPublicationTarget) => {
    const events = props.api.events
    if (!events) return
    const session = ++progressSession
    void events({}).then(async ([eventError, stream]) => {
      if (eventError || !stream) return
      const iterator = stream[Symbol.asyncIterator]()
      if (session !== progressSession || !publishing()) {
        await iterator.return?.()
        return
      }
      progressIterator = iterator
      try {
        while (session === progressSession && publishing()) {
          const next = await iterator.next()
          if (next.done) return
          const event = next.value
          if (
            event === null
            || typeof event !== "object"
            || !("kind" in event)
            || event.kind !== "widget-preview"
            || !("type" in event)
            || event.type !== "progress"
            || !("previewId" in event)
            || event.previewId !== target.previewId
            || !("phase" in event)
            || typeof event.phase !== "string"
          ) continue
          if (
            event.phase === "queued"
            || event.phase === "installing"
            || event.phase === "building"
            || event.phase === "validating"
          ) setPublicationPhase(event.phase)
          if (event.phase === "ready") setPublicationPhase("publishing")
        }
      } catch {
        // Progress is best-effort; the publication response remains authoritative.
      } finally {
        if (progressIterator === iterator) progressIterator = null
        await iterator.return?.().catch(() => undefined)
      }
    }).catch(() => undefined)
  }

  const setResolvedPreviewSelections = (
    selections: readonly TWidgetPublicationTarget[],
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
    if (!publishing()) setPublicationPhase("idle")
    setIssue(null)
    emitState()
    let loadError: Error | null | undefined
    let value: TWidgetDetail | null | undefined
    let selections: readonly TWidgetPublicationTarget[]
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
        title: "Preview frame lookup failed",
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
        title: "Preview frame required",
        message: "Open or place this draft on a canvas, then publish through that Preview frame.",
        tone: "error",
      })
    }
    emitState()
    return value
  }

  createEffect(() => {
    if (!props.open) {
      stopPublicationProgress()
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

  const publish = async () => {
    const confirmed = detail()
    const confirmedTarget = selectedPreview()
    if (!confirmed || !confirmedTarget || publishing()) return
    setPublishing(true)
    setPublicationPhase("publishing")
    setIssue(null)
    emitState()
    startPublicationProgress(confirmedTarget)

    const publicationIdentity = [
      props.draftId,
      previewKey(confirmedTarget),
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
        previewId: confirmedTarget.previewId,
        canvasId: confirmedTarget.canvasId,
        frameNodeId: confirmedTarget.frameNodeId,
      })
    } catch (error) {
      stopPublicationProgress()
      setPublishing(false)
      setPublicationPhase("failed")
      setIssue({
        title: "Publication request failed",
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
      })
      emitState()
      return
    }
    stopPublicationProgress()
    const [publishError, result] = publishResponse
    if (publishError) {
      setPublishing(false)
      setPublicationPhase("failed")
      setIssue({ title: "Publication request failed", message: publishError.message, tone: "error" })
      emitState()
      return
    }
    if (!result.published) {
      setPublishing(false)
      setPublicationPhase("failed")
      const failureIssue: TDialogIssue = {
        title: fnPublicationFailureTitle(result.reason),
        message: result.message,
        diagnostics: [...result.errors, ...result.warnings],
        tone: "error",
      }
      setIssue(failureIssue)
      emitState()
      return
    }
    if (
      result.draftId !== props.draftId
    ) {
      setPublishing(false)
      setPublicationPhase("failed")
      setIssue({
        title: "Publication response did not match the draft",
        message: "The server returned a different draft identity. Nothing in this dialog will be treated as published.",
        tone: "error",
      })
      emitState()
      return
    }

    let publishedDetail: TWidgetDetail | null = null
    try {
      const [publishedDetailError, refreshedPublishedDetail] =
        await props.api.widgets.detail({
          name: result.manifest.name,
          source: "draft",
        })
      if (
        !publishedDetailError
        && refreshedPublishedDetail?.name === result.manifest.name
        && refreshedPublishedDetail.source === "draft"
        && refreshedPublishedDetail.variant.source === "draft"
        && refreshedPublishedDetail.variant.draftId === props.draftId
        && refreshedPublishedDetail.sibling?.source === "published"
        && refreshedPublishedDetail.sibling.revision === result.revision
      ) publishedDetail = refreshedPublishedDetail
    } catch {
      // Publication is already committed; the caller still receives its
      // authoritative result even if the detail refresh is unavailable.
    }
    setDetail(publishedDetail)
    setIssue({
      title: publishedDetail === null
        ? "Widget published; refresh failed"
        : "Widget published",
      message: publishedDetail === null
        ? "Publication committed, but the authoritative published detail could not be refreshed."
        : `Published ${result.revision.slice(0, 12)} as the current widget definition.`,
      tone: "success",
    })
    setPublicationPhase("success")
    try {
      await props.onPublished?.({ detail: publishedDetail, result })
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

          <Show when={publishing()}>
            <div class={styles.status} role="status" aria-live="polite">
              <strong>{fnPublicationPhaseLabel(publicationPhase())}</strong>
            </div>
          </Show>

          <Show when={previewSelections().length > 0 && issue()?.tone !== "success"}>
            <label class={styles.previewSelection}>
              <span>Publication frame</span>
              <select
                value={selectedPreviewKey()}
                disabled={publishing()}
                onChange={(event) => {
                  setSelectedPreviewKey(event.currentTarget.value)
                  emitState()
                }}
              >
                <Show when={!selectedPreview()}>
                  <option value="" disabled>Select a Preview frame…</option>
                </Show>
                <For each={previewSelections()}>
                  {(selection) => <option value={previewKey(selection)}>
                    {selection.label}
                  </option>}
                </For>
              </select>
              <Show
                when={selectedPreview()}
                fallback={<small>Choose the frame that will build and publish the current draft.</small>}
              >
                {(selection) => <small>
                  Current source at Publish time · frame {selection().frameNodeId}
                </small>}
              </Show>
            </label>
          </Show>

          <div class={styles.actions}>
            <AlertDialog.CloseButton class={styles.button} disabled={publishing()}>{issue()?.tone === "success" ? "Done" : "Cancel"}</AlertDialog.CloseButton>
            <Show when={issue()?.tone !== "success"}>
              <Button
                class={`${styles.button} ${styles.primary}`}
                disabled={loading() || publishing() || !detail() || !selectedPreview()}
                onClick={publish}
              >
                {publishing()
                  ? fnPublicationPhaseLabel(publicationPhase())
                  : selectedPreview()
                    ? `${contract()?.actionLabel ?? "Publish"} current draft`
                    : previewSelections().length > 0
                      ? "Choose frame"
                      : "Needs Preview frame"}
              </Button>
            </Show>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
