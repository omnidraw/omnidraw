import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import type { TVibecanvasJson } from "@vibecanvas/service-actor/core/types"
import type { TOrpcSafeClient } from "@vibecanvas/orpc-client"
import { NumberField } from "@kobalte/core/number-field"
import { TextField } from "@kobalte/core/text-field"
import ArrowRight from "lucide-static/icons/arrow-right.svg?raw"
import Bot from "lucide-static/icons/bot.svg?raw"
import Box from "lucide-static/icons/box.svg?raw"
import Brush from "lucide-static/icons/brush.svg?raw"
import Calendar from "lucide-static/icons/calendar.svg?raw"
import ChartBar from "lucide-static/icons/chart-bar.svg?raw"
import CheckSquare from "lucide-static/icons/check-square.svg?raw"
import Circle from "lucide-static/icons/circle.svg?raw"
import Code from "lucide-static/icons/code.svg?raw"
import Component from "lucide-static/icons/component.svg?raw"
import FileText from "lucide-static/icons/file-text.svg?raw"
import Gauge from "lucide-static/icons/gauge.svg?raw"
import Grid2x2 from "lucide-static/icons/grid-2x2.svg?raw"
import Image from "lucide-static/icons/image.svg?raw"
import Layers from "lucide-static/icons/layers.svg?raw"
import List from "lucide-static/icons/list.svg?raw"
import MousePointer2 from "lucide-static/icons/mouse-pointer-2.svg?raw"
import Pencil from "lucide-static/icons/pencil.svg?raw"
import Plus from "lucide-static/icons/plus.svg?raw"
import Settings from "lucide-static/icons/settings.svg?raw"
import Shapes from "lucide-static/icons/shapes.svg?raw"
import Sparkles from "lucide-static/icons/sparkles.svg?raw"
import Square from "lucide-static/icons/square.svg?raw"
import Table from "lucide-static/icons/table.svg?raw"
import Terminal from "lucide-static/icons/square-terminal.svg?raw"
import Type from "lucide-static/icons/type.svg?raw"
import WandSparkles from "lucide-static/icons/wand-sparkles.svg?raw"

interface IProps {
  manifest: TVibecanvasJson | null
  apiService: TOrpcSafeClient
  sessionId: string
  existingGroups: string[]
  widgetId: string
  onManifestChange: (manifest: TVibecanvasJson | null) => void
}

type TIconPreset = {
  id: string
  label: string
  icon: string
}
type TIconOption = TIconPreset | { id: typeof ICON_NONE_ID | typeof ICON_SVG_ID; label: string; icon: string }

const GROUP_NONE_ID = "__none__"
const ICON_NONE_ID = "__none__"
const ICON_SVG_ID = "__svg__"
const MAX_PRIORITY = 9999

const ICON_PRESETS: readonly TIconPreset[] = [
  { id: "mouse-pointer-2", label: "Pointer", icon: MousePointer2 },
  { id: "square", label: "Square", icon: Square },
  { id: "circle", label: "Circle", icon: Circle },
  { id: "arrow-right", label: "Arrow", icon: ArrowRight },
  { id: "pencil", label: "Pencil", icon: Pencil },
  { id: "type", label: "Text", icon: Type },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "shapes", label: "Shapes", icon: Shapes },
  { id: "brush", label: "Brush", icon: Brush },
  { id: "image", label: "Image", icon: Image },
  { id: "layers", label: "Layers", icon: Layers },
  { id: "grid-2x2", label: "Grid", icon: Grid2x2 },
  { id: "table", label: "Table", icon: Table },
  { id: "list", label: "List", icon: List },
  { id: "file-text", label: "File Text", icon: FileText },
  { id: "check-square", label: "Check", icon: CheckSquare },
  { id: "calendar", label: "Calendar", icon: Calendar },
  { id: "chart-bar", label: "Chart", icon: ChartBar },
  { id: "gauge", label: "Gauge", icon: Gauge },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "plus", label: "Plus", icon: Plus },
  { id: "sparkles", label: "Sparkles", icon: Sparkles },
  { id: "wand-sparkles", label: "Wand", icon: WandSparkles },
  { id: "bot", label: "Bot", icon: Bot },
  { id: "box", label: "Box", icon: Box },
  { id: "component", label: "Component", icon: Component },
  { id: "code", label: "Code", icon: Code },
] as const

const ICON_OPTIONS: readonly TIconOption[] = [
  { id: ICON_NONE_ID, label: "No icon", icon: "" },
  ...ICON_PRESETS,
  { id: ICON_SVG_ID, label: "Custom SVG", icon: Code },
]

const getIconOption = (optionId: string) => ICON_OPTIONS.find((entry) => entry.id === optionId) ?? ICON_OPTIONS[0]
const getPresetByIcon = (icon: string) => ICON_PRESETS.find((entry) => entry.icon === icon)

export function ToolTab(props: IProps) {
  const [label, setLabel] = createSignal("")
  const [groupId, setGroupId] = createSignal<string>(GROUP_NONE_ID)
  const [priorityText, setPriorityText] = createSignal("")
  const [iconId, setIconId] = createSignal<string>(ICON_NONE_ID)
  const [isIconMenuOpen, setIsIconMenuOpen] = createSignal(false)
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

    const currentGroup = tool()?.group?.trim()
    if (currentGroup) {
      values.add(currentGroup)
    }

    return [GROUP_NONE_ID, ...[...values].sort((left, right) => left.localeCompare(right))]
  })

  const groupValue = createMemo(() => groupId() === GROUP_NONE_ID ? null : groupId())
  const iconValue = createMemo(() => {
    if (iconId() === ICON_NONE_ID) {
      return null
    }

    if (iconId() === ICON_SVG_ID) {
      const value = customIconSvg().trim()
      return value.length > 0 ? value : null
    }

    return getIconOption(iconId()).icon || null
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
      || (currentTool.icon ?? null) !== iconValue()
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
    setGroupId(nextTool.group?.trim() ? nextTool.group : GROUP_NONE_ID)
    setPriorityText(nextTool.priority === undefined ? "" : String(nextTool.priority))

    const currentIcon = nextTool.icon ?? ""
    const preset = getPresetByIcon(currentIcon)
    if (!currentIcon) {
      setIconId(ICON_NONE_ID)
      setCustomIconSvg("")
      return
    }

    if (preset) {
      setIconId(preset.id)
      setCustomIconSvg("")
      return
    }

    setIconId(ICON_SVG_ID)
    setCustomIconSvg(currentIcon)
  }

  createEffect(() => {
    syncFromManifest(props.manifest)
    setSaveError(undefined)
  })

  const markDirty = () => {
    setSaveStatus("idle")
    setSaveError(undefined)
  }

  const selectIcon = (optionId: string) => {
    setIconId(optionId)
    setIsIconMenuOpen(false)
    markDirty()
  }

  const save = async () => {
    const currentTool = tool()
    if (!currentTool || !props.manifest || !canSave()) {
      return
    }

    const patchPayload: { label: string; icon?: string | null; group?: string | null; priority?: number | null } = {
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

    props.onManifestChange(result.manifest)
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

  const selectedIconOption = createMemo(() => getIconOption(iconId()))

  return (
    <div class="ai-wizzard-tab">
      <section class="ai-wizzard-option-card ai-wizzard-tool-card">
        <div class="ai-wizzard-tool-card__header">
          <div>
            <span class="ai-wizzard-kicker">Widget tool</span>
            <strong>Configure toolbar metadata</strong>
          </div>
          <div class="ai-wizzard-icon-preview ai-wizzard-icon-preview--header" aria-hidden="true">
            <Show when={iconValue()}>
              {(svg) => <div class="ai-wizzard-icon-preview__svg" innerHTML={svg()} />}
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

          <div class="ai-wizzard-kobalte-field ai-wizzard-icon-menu">
            <span class="ai-wizzard-label">Icon</span>
            <button
              type="button"
              class="ai-wizzard-icon-menu__trigger"
              aria-expanded={isIconMenuOpen()}
              onClick={() => setIsIconMenuOpen((value) => !value)}
            >
              <span class="ai-wizzard-icon-select-value">
                <Show when={selectedIconOption().icon}>
                  {(svg) => <span class="ai-wizzard-icon-select-glyph" innerHTML={svg()} aria-hidden="true" />}
                </Show>
                <span>{selectedIconOption().label}</span>
              </span>
              <span class="ai-wizzard-kobalte-select-icon">v</span>
            </button>
            <Show when={isIconMenuOpen()}>
              <div class="ai-wizzard-icon-menu__content" role="listbox">
                <For each={ICON_OPTIONS}>
                  {(option) => (
                    <button
                      type="button"
                      class="ai-wizzard-icon-menu__item"
                      classList={{ "ai-wizzard-icon-menu__item--selected": iconId() === option.id }}
                      role="option"
                      aria-selected={iconId() === option.id}
                      onClick={() => selectIcon(option.id)}
                    >
                      <Show when={option.icon}>
                        {(svg) => <span class="ai-wizzard-icon-select-glyph" innerHTML={svg()} aria-hidden="true" />}
                      </Show>
                      <span>{option.label}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <Show when={iconId() === ICON_SVG_ID}>
            <TextField
              class="ai-wizzard-kobalte-field ai-wizzard-tool-form__wide"
              value={customIconSvg()}
              onChange={(next) => {
                setCustomIconSvg(next)
                markDirty()
              }}
            >
              <TextField.Label class="ai-wizzard-label">SVG</TextField.Label>
              <TextField.TextArea class="ai-wizzard-kobalte-textarea" rows={5} spellCheck={false} />
            </TextField>
          </Show>
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
