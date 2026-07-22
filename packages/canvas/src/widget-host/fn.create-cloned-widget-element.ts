import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types"

type TPortal = {
  clone: <T>(value: T) => T
  createId: () => string
  cloneUiWidgetPayload?: (sourcePayload: Record<string, any>) => Record<string, any>
  now: () => number
}

type TArgs = {
  sourceElement: TElement
}

export function fnCreateClonedWidgetElement(portal: TPortal, args: TArgs) {
  const timestamp = portal.now()
  const clone = portal.clone(args.sourceElement)
  const elementId = portal.createId()
  if (clone.data.type === "widget") {
    const { actorInstanceId, ...dataWithoutInstance } = clone.data
    void actorInstanceId
    clone.data = dataWithoutInstance
  } else if (clone.data.type === "ui-widget" && portal.cloneUiWidgetPayload) {
    clone.data = {
      ...clone.data,
      payload: portal.cloneUiWidgetPayload(clone.data.payload ?? {}),
    }
  } else if (clone.data.type === "widget-instance") {
    const { stateDocumentId, ...dataWithoutStateDocument } = clone.data
    void stateDocumentId
    clone.data = {
      ...dataWithoutStateDocument,
      instanceId: portal.createId(),
    }
  }

  return {
    ...clone,
    id: elementId,
    createdAt: timestamp,
    updatedAt: timestamp,
    parentGroupId: null,
    zIndex: "",
  } satisfies TElement
}
