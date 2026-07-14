import type { TOrpcSafeClient } from "@vibecanvas/orpc-client"
import type { TVibecanvasJson } from "@vibecanvas/service-actor/core/types"
import { ActorStateMachineView } from "@vibecanvas/actor-ui"
import "@vibecanvas/actor-ui/styles.css"
import { Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"

interface IProps {
  actor: TVibecanvasJson | null
  actorSource: "file" | "actor-candidate" | "connected"
  apiService: TOrpcSafeClient
  sessionId: string
  widgetId: string
  isApproving: boolean
  onApprove: () => Promise<void>
  onManifestChange: (manifest: TVibecanvasJson | null, source?: "file" | "actor-candidate" | "connected") => void
}

type TJsonField = "initialData" | "dataSchema"

type TJsonValidation = {
  value?: unknown
  error?: string
}

function formatJson(value: unknown) {
  if (value === undefined) {
    return ""
  }

  return JSON.stringify(value, null, 2)
}

function parseJsonField(label: string, text: string): TJsonValidation {
  const trimmed = text.trim()

  if (trimmed.length === 0) {
    return { error: `${label} must be valid JSON.` }
  }

  try {
    return { value: JSON.parse(trimmed) }
  } catch (error) {
    return {
      error: error instanceof Error ? `${label}: ${error.message}` : `${label} is not valid JSON.`,
    }
  }
}

export function ActorTab(props: IProps) {
  const [manifest, setManifest] = createSignal<TVibecanvasJson | null>(props.actor)
  const [manifestSource, setManifestSource] = createSignal<"file" | "actor-candidate" | "connected">(props.actorSource)
  const [name, setName] = createSignal(props.actor?.name ?? "")
  const [description, setDescription] = createSignal(props.actor?.description ?? "")
  const [initialDataText, setInitialDataText] = createSignal(formatJson(props.actor?.actor.initialData))
  const [dataSchemaText, setDataSchemaText] = createSignal(formatJson(props.actor?.actor.dataSchema ?? true))
  const [loadError, setLoadError] = createSignal<string>()
  const [saveError, setSaveError] = createSignal<string>()
  const [saveStatus, setSaveStatus] = createSignal<"idle" | "saving" | "saved">("idle")

  const syncForm = (nextManifest: TVibecanvasJson | null) => {
    setManifest(nextManifest)
    setName(nextManifest?.name ?? "")
    setDescription(nextManifest?.description ?? "")
    setInitialDataText(formatJson(nextManifest?.actor.initialData))
    setDataSchemaText(formatJson(nextManifest?.actor.dataSchema ?? true))
    setSaveError(undefined)
    setSaveStatus("idle")
  }

  createEffect(() => {
    const nextManifest = props.actor
    const nextSource = props.actorSource

    if (nextManifest !== untrack(manifest) || nextSource !== untrack(manifestSource)) {
      syncForm(nextManifest)
      setManifestSource(nextSource)
    }
  })

  createEffect(() => {
    const widgetId = props.widgetId
    const sessionId = props.sessionId
    let disposed = false

    setLoadError(undefined)

    void props.apiService.api.agent.chat.draftManifest.read({
      widgetId,
      sessionId,
    }).then(([err, result]) => {
      if (disposed) return

      if (err) {
        setLoadError(err.message)
        return
      }

      if (!result.ready) {
        setLoadError(result.message)
        syncForm(null)
        props.onManifestChange(null)
        return
      }

      setManifestSource(result.source)
      syncForm(result.manifest)
      props.onManifestChange(result.manifest, result.source)
    })

    onCleanup(() => {
      disposed = true
    })
  })

  const initialDataValidation = createMemo(() => parseJsonField("Initial data", initialDataText()))
  const dataSchemaValidation = createMemo(() => parseJsonField("Data schema", dataSchemaText()))
  const isCandidate = createMemo(() => manifestSource() === "actor-candidate")
  const jsonError = createMemo(() => initialDataValidation().error ?? dataSchemaValidation().error)
  const isDirty = createMemo(() => {
    const currentManifest = manifest()

    if (!currentManifest) {
      return false
    }

    return name() !== currentManifest.name
      || description() !== (currentManifest.description ?? "")
      || initialDataText() !== formatJson(currentManifest.actor.initialData)
      || dataSchemaText() !== formatJson(currentManifest.actor.dataSchema ?? true)
  })
  const canSave = createMemo(() => Boolean(manifest()) && !isCandidate() && isDirty() && !jsonError() && saveStatus() !== "saving")

  const setJsonField = (field: TJsonField, value: string) => {
    if (field === "initialData") {
      setInitialDataText(value)
    } else {
      setDataSchemaText(value)
    }

    setSaveError(undefined)
    setSaveStatus("idle")
  }

  const saveManifest = async () => {
    const currentManifest = manifest()

    if (!currentManifest || !canSave()) {
      return
    }

    const initialData = initialDataValidation()
    const dataSchema = dataSchemaValidation()

    if (initialData.error || dataSchema.error) {
      setSaveError(initialData.error ?? dataSchema.error)
      return
    }

    setSaveStatus("saving")
    setSaveError(undefined)

    const [err, result] = await props.apiService.api.agent.chat.draftManifest.patch({
      widgetId: props.widgetId,
      sessionId: props.sessionId,
      patch: {
        name: name(),
        description: description(),
        initialData: initialData.value,
        dataSchema: dataSchema.value,
      },
    })

    if (err) {
      setSaveStatus("idle")
      setSaveError(err.message)
      return
    }

    if (!result.ok) {
      setSaveStatus("idle")
      setSaveError(result.issues?.join("\n") ?? result.message)
      return
    }

    setManifestSource("file")
    syncForm(result.manifest)
    props.onManifestChange(result.manifest, "file")
    setSaveStatus("saved")
  }

  const noActorLoaded = () => (
    <div class="ai-chat-tab">
      <section class="ai-chat-option-card ai-chat-option-card--selected">
        <span class="ai-chat-kicker">Actor</span>
        <strong>No actor loaded</strong>
        <p>{loadError() ?? "Ask the chat to generate an actor/widget first. Once an actor candidate exists, this tab will show the manifest for inspection."}</p>
      </section>
    </div>
  )

  return (
    <Show when={manifest() !== null} fallback={noActorLoaded()}>
      <div class="ai-chat-tab ai-chat-tab--actor">
        <section class="ai-actor-editor">
          <header class="ai-actor-editor__header">
            <div>
              <span class="ai-chat-kicker">{isCandidate() ? "Draft actor candidate" : "Actor manifest"}</span>
              <strong>{manifest()?.name}</strong>
              <p>
                {isCandidate()
                  ? "This is a draft candidate. Approve it to scaffold files, then continue the AI run that implements the actor transitions and widget UI."
                  : "Editing draft manifest fields from the scaffolded vibecanvas.json file."}
              </p>
            </div>
            <Show
              when={!isCandidate()}
              fallback={
                <div class="ai-actor-editor__header-actions">
                  <div class="ai-actor-editor__status ai-actor-editor__status--candidate">Draft</div>
                  <button type="button" class="ai-actor-editor__approve-button" disabled={props.isApproving} onClick={() => void props.onApprove()}>
                    {props.isApproving ? "Generating" : "Approve + implement"}
                  </button>
                </div>
              }
            >
              <div class="ai-actor-editor__header-actions">
                <div class="ai-actor-editor__status" data-state={saveStatus()}>
                  <Show when={jsonError()} fallback={saveStatus() === "saved" ? "Saved" : isDirty() ? "Unsaved" : "Clean"}>
                    Invalid JSON
                  </Show>
                </div>
              </div>
            </Show>
          </header>

          <div class="ai-actor-editor__grid">
            <label class="ai-actor-editor__field">
              <span>Name</span>
              <input
                readOnly={isCandidate()}
                value={name()}
                onInput={(event) => {
                  setName(event.currentTarget.value)
                  setSaveStatus("idle")
                  setSaveError(undefined)
                }}
              />
            </label>

            <label class="ai-actor-editor__field">
              <span>Initial state</span>
              <input value={manifest()?.actor.initialState ?? ""} readOnly />
            </label>
          </div>

          <label class="ai-actor-editor__field">
            <span>Description</span>
            <textarea
              rows={4}
              readOnly={isCandidate()}
              value={description()}
              onInput={(event) => {
                setDescription(event.currentTarget.value)
                setSaveStatus("idle")
                setSaveError(undefined)
              }}
            />
          </label>

          <div class="ai-actor-editor__grid">
            <label class="ai-actor-editor__field ai-actor-editor__field--json">
              <span>Initial data JSON</span>
              <textarea
                rows={12}
                readOnly={isCandidate()}
                spellcheck={false}
                value={initialDataText()}
                onInput={(event) => setJsonField("initialData", event.currentTarget.value)}
              />
              <Show when={initialDataValidation().error}>
                {(error) => <small>{error()}</small>}
              </Show>
            </label>

            <label class="ai-actor-editor__field ai-actor-editor__field--json">
              <span>Data schema JSON</span>
              <textarea
                rows={12}
                readOnly={isCandidate()}
                spellcheck={false}
                value={dataSchemaText()}
                onInput={(event) => setJsonField("dataSchema", event.currentTarget.value)}
              />
              <Show when={dataSchemaValidation().error}>
                {(error) => <small>{error()}</small>}
              </Show>
            </label>
          </div>

          <Show when={saveError()}>
            {(error) => <pre class="ai-actor-editor__error">{error()}</pre>}
          </Show>

          <div class="ai-actor-editor__actions">
            <Show
              when={isCandidate()}
              fallback={
                <button type="button" class="ai-chat-primary-button" disabled={!canSave()} onClick={() => void saveManifest()}>
                  {saveStatus() === "saving" ? "Saving" : "Save manifest"}
                </button>
              }
            >
              <span class="ai-actor-editor__hint">Approve this candidate to scaffold files and start the implementation prompt.</span>
            </Show>
          </div>
        </section>

        <ActorStateMachineView manifest={manifest() ?? undefined} variant="embedded" title="Draft actor state machine" />
      </div>
    </Show>
  )
}
