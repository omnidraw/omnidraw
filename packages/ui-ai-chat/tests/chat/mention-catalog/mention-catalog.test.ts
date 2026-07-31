import type { TWidgetCatalog } from "@omnidraw/orpc-client"
import { describe, expect, it, vi } from "vitest"
import { refreshMentionCatalog, subscribeMentionCatalog } from "../../../src/chat/mention-catalog"

describe("shared mention catalog", () => {
  it("updates every subscriber from one live catalog refresh", async () => {
    let resourceName = "Notes"
    let catalog: TWidgetCatalog = { generation: "one", groups: [], widgets: [] }
    const listResources = vi.fn(async () => [undefined, [{ id: "db-1", kind: "db", name: resourceName, status: "ready" }]] as const)
    const listWidgets = vi.fn(async () => [undefined, catalog] as const)
    const api = {
      api: {
        resource: { resources: { list: listResources } },
        agent: { widgets: { catalog: listWidgets } },
      },
    } as never
    const first: string[][] = []
    const second: string[][] = []
    const unsubscribeFirst = subscribeMentionCatalog(api, (snapshot) => first.push(snapshot.mentions.map((mention) => mention.label)))
    const unsubscribeSecond = subscribeMentionCatalog(api, (snapshot) => second.push(snapshot.mentions.map((mention) => mention.label)))

    await vi.waitFor(() => expect(first.at(-1)).toEqual(["Notes"]))
    expect(second.at(-1)).toEqual(["Notes"])
    expect(listResources).toHaveBeenCalledTimes(1)
    expect(listWidgets).toHaveBeenCalledTimes(1)

    resourceName = "Renamed notes"
    catalog = { generation: "two", groups: [], widgets: [] }
    await refreshMentionCatalog(api)

    expect(first.at(-1)).toEqual(["Renamed notes"])
    expect(second.at(-1)).toEqual(["Renamed notes"])
    unsubscribeFirst()
    unsubscribeSecond()
  })
})
