import type { TWidgetCatalog, TWidgetSource, TWidgetVariantSummary } from "@vibecanvas/orpc-client"
import type { TChatComposerMention, TChatComposerMentionTarget } from "../components/ChatComposer/interface"

export type TMentionCatalogResource = {
  id: string
  kind: "kv" | "secretStore" | "db"
  name: string
  status: "created" | "provisioning" | "ready" | "migrating" | "error" | "deleting"
}

export function fnMentionId(target: TChatComposerMentionTarget): string {
  return target.type === "resource"
    ? `resource:${target.resourceId}`
    : `widget:${target.source}:${target.name}`
}

export function fnMentionResourceKind(kind: TMentionCatalogResource["kind"]): string {
  if (kind === "db") return "Database resource"
  if (kind === "kv") return "Key-value resource"
  return "Secret store resource"
}

export function fnWidgetMention(
  name: string,
  source: TWidgetSource,
  variant: TWidgetVariantSummary,
): TChatComposerMention {
  const target = { type: "widget" as const, name, source }
  const identity = variant.displayName === name ? "" : ` · ${name}`
  return {
    id: fnMentionId(target),
    label: variant.displayName,
    kind: `${source === "draft" ? "Draft" : "Published"} widget${identity}`,
    target,
    icon: { type: "widget", icon: variant.tool.icon },
  }
}

export function fnProjectMentionCatalog(
  resources: readonly TMentionCatalogResource[],
  catalog: TWidgetCatalog | null,
): TChatComposerMention[] {
  const mentions = resources.map((resource): TChatComposerMention => {
    const target = { type: "resource" as const, resourceId: resource.id }
    return {
      id: fnMentionId(target),
      label: resource.name,
      kind: fnMentionResourceKind(resource.kind),
      target,
      icon: { type: "resource", kind: resource.kind },
    }
  })

  for (const widget of catalog?.widgets ?? []) {
    if (widget.published) mentions.push(fnWidgetMention(widget.name, "published", widget.published))
    if (widget.draft && (!widget.published || widget.relation !== "same")) {
      mentions.push(fnWidgetMention(widget.name, "draft", widget.draft))
    }
  }

  return mentions.sort((left, right) => (
    left.label.localeCompare(right.label)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id)
  ))
}

export function fnIsWidgetCatalogEventKind(kind: string | undefined): boolean {
  return kind === "widget-draft"
    || kind === "widget-published"
    || kind === "widgetupdate"
    || kind === "widget-catalog"
}
