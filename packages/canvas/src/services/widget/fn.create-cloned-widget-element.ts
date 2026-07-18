import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types"

type TPortal = {
  clone: <T>(value: T) => T
  createId: () => string
  createUiWidgetPayload?: () => Record<string, any>
  now: () => number
}

type TArgs = {
  sourceElement: TElement
}

export function fnCreateClonedWidgetElement(portal: TPortal, args: TArgs) {
  const timestamp = portal.now()
  const clone = portal.clone(args.sourceElement)
  if (clone.data.type === "widget") {
    const { actorInstanceId, ...dataWithoutInstance } = clone.data
    void actorInstanceId
    clone.data = dataWithoutInstance
  } else if (clone.data.type === "ui-widget" && portal.createUiWidgetPayload) {
    clone.data = {
      ...clone.data,
      payload: portal.createUiWidgetPayload(),
    }
  }

  return {
    ...clone,
    id: portal.createId(),
    createdAt: timestamp,
    updatedAt: timestamp,
    parentGroupId: null,
    zIndex: "",
  } satisfies TElement
}
