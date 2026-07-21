import type { TWidgetCatalog } from "@vibecanvas/orpc-client"
import type { TAiChatApiPort } from "../../ports"
import type { TChatComposerMention } from "../components/ChatComposer/interface"
import { fnProjectMentionCatalog, type TMentionCatalogResource } from "./fn.mention-catalog"

export type TMentionCatalogSnapshot = {
  mentions: TChatComposerMention[]
  resources: TMentionCatalogResource[]
  widgets: TWidgetCatalog | null
}

type TMentionCatalogEntry = {
  api: TAiChatApiPort
  listeners: Set<(snapshot: TMentionCatalogSnapshot) => void>
  snapshot: TMentionCatalogSnapshot
  refreshPromise?: Promise<TMentionCatalogSnapshot>
  closed: boolean
}

const entries = new WeakMap<object, TMentionCatalogEntry>()

function createEntry(api: TAiChatApiPort): TMentionCatalogEntry {
  return {
    api,
    listeners: new Set(),
    snapshot: { mentions: [], resources: [], widgets: null },
    closed: false,
  }
}

function getEntry(api: TAiChatApiPort) {
  const key = api as object
  let entry = entries.get(key)
  if (!entry) {
    entry = createEntry(api)
    entries.set(key, entry)
  }
  return entry
}

function notify(entry: TMentionCatalogEntry) {
  entry.listeners.forEach((listener) => listener(entry.snapshot))
}

async function loadEntry(entry: TMentionCatalogEntry): Promise<TMentionCatalogSnapshot> {
  const widgetCatalog = entry.api.api.agent.widgets?.catalog
  const [resourceRequest, widgetRequest] = await Promise.allSettled([
    entry.api.api.actors.resources.list({}),
    widgetCatalog ? widgetCatalog({}) : Promise.resolve(undefined),
  ])
  if (entry.closed) return entry.snapshot

  const resourceResult = resourceRequest.status === "fulfilled" ? resourceRequest.value : undefined
  const widgetResult = widgetRequest.status === "fulfilled" ? widgetRequest.value : undefined
  const nextResources = resourceResult && !resourceResult[0]
    ? resourceResult[1] as TMentionCatalogResource[]
    : entry.snapshot.resources
  const nextWidgets = widgetResult && !widgetResult[0]
    ? widgetResult[1]
    : entry.snapshot.widgets
  entry.snapshot = {
    resources: nextResources,
    widgets: nextWidgets,
    mentions: fnProjectMentionCatalog(nextResources, nextWidgets),
  }
  notify(entry)
  return entry.snapshot
}

export function refreshMentionCatalog(api: TAiChatApiPort): Promise<TMentionCatalogSnapshot> {
  const entry = getEntry(api)
  if (entry.refreshPromise) return entry.refreshPromise
  entry.refreshPromise = loadEntry(entry).finally(() => {
    entry.refreshPromise = undefined
  })
  return entry.refreshPromise
}

export function subscribeMentionCatalog(
  api: TAiChatApiPort,
  listener: (snapshot: TMentionCatalogSnapshot) => void,
): () => void {
  const entry = getEntry(api)
  const firstListener = entry.listeners.size === 0
  entry.listeners.add(listener)
  listener(entry.snapshot)
  if (firstListener) {
    void refreshMentionCatalog(api)
  }

  return () => {
    entry.listeners.delete(listener)
    if (entry.listeners.size > 0) return
    entry.closed = true
    entries.delete(api as object)
  }
}
