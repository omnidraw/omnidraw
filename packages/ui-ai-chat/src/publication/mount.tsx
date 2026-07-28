import { createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { TWidgetTitleBarPortal } from "../widget/interface"
import { WidgetPublicationDialog } from "./WidgetPublicationDialog"
import type {
  TWidgetPublicationApi,
  TWidgetPublicationPreviewSelection,
  TWidgetPublicationState,
  TWidgetPublicationSuccess,
} from "./interface"

export type TMountWidgetPublicationDialogArgs = {
  document: Document
  api: TWidgetPublicationApi
  draftId: string
  draftName: string
  createIdempotencyKey: () => string
  getPinnedRevision: () => string
  getPreviewSelection: () => TWidgetPublicationPreviewSelection | null
  titleBar: TWidgetTitleBarPortal
  onPublished: (success: TWidgetPublicationSuccess) => void | Promise<void>
  onRequestPreviewRefresh: () => void | Promise<void>
}

export function mountWidgetPublicationDialog(args: TMountWidgetPublicationDialogArgs) {
  const host = args.document.createElement("div")
  host.dataset.widgetPublicationDialogFor = args.draftId
  host.style.display = "contents"
  args.document.body.appendChild(host)
  let setOpen = (_open: boolean) => undefined

  const syncTitleAction = (state: TWidgetPublicationState) => {
    const label = state.publishing
      ? `${state.actionLabel}ing…`
      : state.loading
        ? "Checking publication…"
        : state.previewSelected
          ? state.actionLabel
          : "Preview not ready"
    args.titleBar.setActionState("publish", {
      disabled: state.open || state.loading || state.publishing || !state.previewSelected,
      label,
    })
  }
  syncTitleAction({
    open: false,
    loading: true,
    publishing: false,
    previewAvailable: false,
    previewSelected: false,
    actionLabel: "Publish",
  })

  const disposeDialog = render(() => {
    const [open, setDialogOpen] = createSignal(false)
    setOpen = setDialogOpen
    return (
      <WidgetPublicationDialog
        api={args.api}
        draftId={args.draftId}
        draftName={args.draftName}
        createIdempotencyKey={args.createIdempotencyKey}
        getPinnedRevision={args.getPinnedRevision}
        resolvePreviewSelections={() => {
          const selection = args.getPreviewSelection()
          return selection ? [selection] : []
        }}
        open={open()}
        onOpenChange={setDialogOpen}
        onStateChange={syncTitleAction}
        onPublished={args.onPublished}
        onRequestPreviewRefresh={args.onRequestPreviewRefresh}
      />
    )
  }, host)
  const removeAction = args.titleBar.onAction("publish", () => setOpen(true))

  return () => {
    removeAction()
    disposeDialog()
    host.remove()
  }
}
