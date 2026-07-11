import { NumberField } from "@kobalte/core/number-field"
import { TextField } from "@kobalte/core/text-field"
import type { TOrpcSafeClient } from "@vibecanvas/orpc-client"
import { isLucideStaticIconKey, type TVibecanvasToolIcon } from "@vibecanvas/service-actor/core/tool-icon"
import type { TVibecanvasJson } from "@vibecanvas/service-actor/core/types"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { resolveToolIconMarkup, ToolIconGlyph, ToolIconPicker } from "../../ToolIconPicker/ToolIconPicker"

interface IProps {
  manifest: TVibecanvasJson | null
  apiService: TOrpcSafeClient
  sessionId: string
  existingGroups: string[]
  widgetId: string
  onManifestChange: (manifest: TVibecanvasJson | null, source: "file" | "actor-candidate") => void
}

const GROUP_NONE_ID = "__none__"
const ICON_NONE_ID = "__none__"
const ICON_SVG_ID = "__svg__"
const MAX_PRIORITY = 9999
const sameIcon = (left: TVibecanvasToolIcon | null, right: TVibecanvasToolIcon | null) => JSON.stringify(left) === JSON.stringify(right)
const normalizeIcon = (icon: TVibecanvasToolIcon | string | undefined): TVibecanvasToolIcon | null => {
  if (typeof icon === "string") {
    const value = icon.trim()
    if (value.length === 0) {
      return null
    }

    return isLucideStaticIconKey(value) ? { lucidIcon: value } : { svgIcon: value }
  }

  const svgIcon = icon?.svgIcon?.trim()
  if (svgIcon) {
    return { svgIcon }
  }

  if (isLucideStaticIconKey(icon?.lucidIcon)) {
    return { lucidIcon: icon.lucidIcon }
  }

  return null
}

export function ToolTab(props: IProps) {
  const [label, setLabel] = createSignal("")
  const [groupId, setGroupId] = createSignal<string>(GROUP_NONE_ID)
  const [priorityText, setPriorityText] = createSignal("")
  const [iconId, setIconId] = createSignal<string>(ICON_NONE_ID)
  const [customIconSvg, setCustomIconSvg] = createSignal("")
  const [saveStatus, setSaveStatus] = createSignal<"idle" | "saving" | "saved" | "error">("idle")
  const [saveError, setSaveError] = createSignal<string>()

  const tool = createMemo(() => props.manifest?.widget.tool)
  const groupOptions = createMemo(() => {
    const values = new Set<string>()
    props.existingGroups.forEach((group) => {
      const trimmed = group.trim()
      if (trimmed.length > 0) {
        values.add(trimmed)
      }
    })

    return [GROUP_NONE_ID, ...[...values].sort((left, right) => left.localeCompare(right))]
  })

  const groupValue = createMemo(() => groupId() === GROUP_NONE_ID ? null : groupId())
  const iconValue = createMemo<TVibecanvasToolIcon | null>(() => {
    if (iconId() === ICON_NONE_ID) {
      return null
    }

    if (iconId() === ICON_SVG_ID) {
      const value = customIconSvg().trim()
      return value.length > 0 ? { svgIcon: value } : null
    }

    return isLucideStaticIconKey(iconId()) ? { lucidIcon: iconId() } : null
  })
  const previewIcon = createMemo(() => {
    return resolveToolIconMarkup(iconValue())
  })

  const parsedPriority = createMemo(() => {
    const value = priorityText().trim()
    if (value.length === 0) {
      return undefined
    }

    const next = Number(value)
    return Number.isNaN(next) ? undefined : next
  })
  const isPriorityInvalid = createMemo(() => {
    const priority = parsedPriority()
    if (priority === undefined) {
      return priorityText().trim().length > 0
    }

    return priority < 0 || priority > MAX_PRIORITY
  })

  const isDirty = createMemo(() => {
    const currentTool = tool()
    if (!currentTool) {
      return false
    }

    return currentTool.label !== label()
      || !sameIcon(normalizeIcon(currentTool.icon), iconValue())
      || (currentTool.group ?? null) !== groupValue()
      || currentTool.priority !== parsedPriority()
  })

  const canSave = createMemo(() => Boolean(tool()) && !isPriorityInvalid() && isDirty() && saveStatus() !== "saving")

  const syncFromManifest = (nextManifest: TVibecanvasJson | null) => {
    const nextTool = nextManifest?.widget.tool
    if (!nextTool) {
      return
    }

    setLabel(nextTool.label)
    const currentGroup = nextTool.group?.trim()
    setGroupId(currentGroup && props.existingGroups.includes(currentGroup) ? currentGroup : GROUP_NONE_ID)
    setPriorityText(nextTool.priority === undefined ? "" : String(nextTool.priority))

    const currentIcon = normalizeIcon(nextTool.icon)
    if (!currentIcon) {
      setIconId(ICON_NONE_ID)
      setCustomIconSvg("")
      return
    }

    if (currentIcon.svgIcon) {
      setIconId(ICON_SVG_ID)
      setCustomIconSvg(currentIcon.svgIcon)
      return
    }

    if (currentIcon.lucidIcon) {
      setIconId(currentIcon.lucidIcon)
      setCustomIconSvg("")
      return
    }

    setIconId(ICON_NONE_ID)
    setCustomIconSvg("")
  }

  createEffect(() => {
    syncFromManifest(props.manifest)
    setSaveError(undefined)
  })

  const markDirty = () => {
    setSaveStatus("idle")
    setSaveError(undefined)
  }

  const save = async () => {
    const currentTool = tool()
    if (!currentTool || !props.manifest || !canSave()) {
      return
    }

    const patchPayload: { label: string; icon?: TVibecanvasToolIcon | null; group?: string | null; priority?: number | null } = {
      label: label(),
      icon: iconValue(),
      group: groupValue(),
      priority: parsedPriority() ?? null,
    }

    setSaveStatus("saving")
    setSaveError(undefined)

    const [err, result] = await props.apiService.api.agent.wizzard.draftManifest.patch({
      widgetId: props.widgetId,
      sessionId: props.sessionId,
      patch: {
        tool: patchPayload,
      },
    })

    if (err) {
      setSaveStatus("error")
      setSaveError(err.message)
      return
    }

    if (!result.ok) {
      setSaveStatus("error")
      setSaveError(result.message)
      return
    }

    props.onManifestChange(result.manifest, result.source)
    syncFromManifest(result.manifest)
    setSaveStatus("saved")
  }

  if (!props.manifest) {
    return (
      <div class="ai-wizzard-tab">
        <section class="ai-wizzard-option-card ai-wizzard-option-card--selected">
          <span class="ai-wizzard-kicker">Tool</span>
          <strong>No widget loaded</strong>
          <p>Ask the chat to generate an actor/widget first, then open this tab to edit widget tool metadata.</p>
        </section>
      </div>
    )
  }

  return (
    <div class="ai-wizzard-tab">
      <section class="ai-wizzard-option-card ai-wizzard-tool-card">
        <div class="ai-wizzard-tool-card__header">
          <div>
            <span class="ai-wizzard-kicker">Widget tool</span>
            <strong>Configure toolbar metadata</strong>
          </div>
          <div class="ai-wizzard-icon-preview ai-wizzard-icon-preview--header" aria-hidden="true">
            <Show when={previewIcon()}>
              {(icon) => (
                <div class="ai-wizzard-icon-preview__svg">
                  <ToolIconGlyph icon={icon()} />
                </div>
              )}
            </Show>
          </div>
        </div>

        <div class="ai-wizzard-tool-form">
          <TextField
            class="ai-wizzard-kobalte-field"
            value={label()}
            onChange={(next) => {
              setLabel(next)
              markDirty()
            }}
          >
            <TextField.Label class="ai-wizzard-label">Label</TextField.Label>
            <TextField.Input class="ai-wizzard-kobalte-input" />
          </TextField>

          <label class="ai-wizzard-kobalte-field">
            <span class="ai-wizzard-label">Group</span>
            <select
              class="ai-wizzard-native-select"
              value={groupId()}
              onChange={(event) => {
                setGroupId(event.currentTarget.value)
                markDirty()
              }}
            >
              <For each={groupOptions()}>
                {(group) => <option value={group}>{group === GROUP_NONE_ID ? "No group" : group}</option>}
              </For>
            </select>
          </label>

          <NumberField
            class="ai-wizzard-kobalte-field"
            value={priorityText()}
            minValue={0}
            maxValue={MAX_PRIORITY}
            format={false}
            validationState={isPriorityInvalid() ? "invalid" : "valid"}
            onChange={(next) => {
              setPriorityText(next)
              markDirty()
            }}
          >
            <NumberField.Label class="ai-wizzard-label">Priority</NumberField.Label>
            <div class="ai-wizzard-number-control">
              <NumberField.Input class="ai-wizzard-kobalte-input ai-wizzard-number-input" />
              <NumberField.DecrementTrigger class="ai-wizzard-number-stepper">-</NumberField.DecrementTrigger>
              <NumberField.IncrementTrigger class="ai-wizzard-number-stepper">+</NumberField.IncrementTrigger>
            </div>
            <NumberField.ErrorMessage class="ai-wizzard-field-error">
              Priority must be between 0 and {MAX_PRIORITY}.
            </NumberField.ErrorMessage>
          </NumberField>

          <div class="ai-wizzard-kobalte-field ai-wizzard-tool-form__wide">
            <ToolIconPicker value={iconValue()} onChange={(next) => {
              if (!next) { setIconId(ICON_NONE_ID); setCustomIconSvg("") }
              else if (next.svgIcon) { setIconId(ICON_SVG_ID); setCustomIconSvg(next.svgIcon) }
              else if (next.lucidIcon) { setIconId(next.lucidIcon); setCustomIconSvg("") }
              markDirty()
            }} />
          </div>
        </div>

        <Show when={saveError()}>
          <p class="ai-actor-editor__error">{saveError()}</p>
        </Show>

        <div class="ai-wizzard-actions">
          <button
            type="button"
            class="ai-wizzard-primary-button ai-wizzard-primary-button--compact"
            disabled={!canSave()}
            onClick={() => void save()}
          >
            {saveStatus() === "saving" ? "Saving" : "Save tool metadata"}
          </button>
        </div>
      </section>
    </div>
  )
}
