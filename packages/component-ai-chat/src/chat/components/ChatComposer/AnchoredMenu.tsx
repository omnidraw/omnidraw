import { Portal, type JSX } from "@solidjs/web"
import { onSettled, untrack } from "solid-js"
import type { TAiChatBrowserPort } from "../../../ports"

const CANVAS_OVERLAY_EDGE_GAP = 8
const CANVAS_OVERLAY_Z_INDEX = "2147483647"

type TProps = Readonly<{
  anchor: HTMLElement
  browser: TAiChatBrowserPort
  class: string
  root: HTMLElement
  role: "menu"
  ariaLabel?: string
  children: JSX.Element
  onClick?(event: MouseEvent): void
  onElement?(element: HTMLDivElement | undefined): void
  onKeyDown?(event: KeyboardEvent): void
}>

function canvasOverlayTarget(root: HTMLElement): HTMLElement | null {
  const widgetShell = root.closest<HTMLElement>("[data-vibecanvas-widget-shell]")
  return widgetShell?.closest<HTMLElement>("[data-omnidraw-theme-scope]") ?? null
}

function positionCanvasOverlay(
  menu: HTMLDivElement,
  anchor: HTMLElement,
  target: HTMLElement,
): void {
  const targetRect = target.getBoundingClientRect()
  const anchorRect = anchor.getBoundingClientRect()
  const availableWidth = Math.max(0, targetRect.width - CANVAS_OVERLAY_EDGE_GAP * 2)

  menu.style.maxWidth = `${availableWidth}px`
  const menuRect = menu.getBoundingClientRect()
  const maximumLeft = Math.max(
    CANVAS_OVERLAY_EDGE_GAP,
    targetRect.width - menuRect.width - CANVAS_OVERLAY_EDGE_GAP,
  )
  const left = Math.min(
    Math.max(anchorRect.left - targetRect.left, CANVAS_OVERLAY_EDGE_GAP),
    maximumLeft,
  )
  const above = anchorRect.top - targetRect.top - menuRect.height - CANVAS_OVERLAY_EDGE_GAP
  const below = anchorRect.bottom - targetRect.top + CANVAS_OVERLAY_EDGE_GAP
  const maximumTop = Math.max(
    CANVAS_OVERLAY_EDGE_GAP,
    targetRect.height - menuRect.height - CANVAS_OVERLAY_EDGE_GAP,
  )
  const top = Math.min(
    Math.max(above >= CANVAS_OVERLAY_EDGE_GAP ? above : below, CANVAS_OVERLAY_EDGE_GAP),
    maximumTop,
  )

  Object.assign(menu.style, {
    bottom: "auto",
    left: `${left}px`,
    position: "absolute",
    top: `${top}px`,
    visibility: "visible",
    zIndex: CANVAS_OVERLAY_Z_INDEX,
  })
  menu.dataset.omnidrawAiChatMenuPositioned = "true"
}

export function AnchoredMenu(props: TProps) {
  const browser = untrack(() => props.browser)
  const anchor = untrack(() => props.anchor)
  const root = untrack(() => props.root)
  const onElement = untrack(() => props.onElement)
  const className = untrack(() => props.class)
  const role = untrack(() => props.role)
  const ariaLabel = untrack(() => props.ariaLabel)
  const onClick = untrack(() => props.onClick)
  const onKeyDown = untrack(() => props.onKeyDown)
  const children = untrack(() => props.children)
  const target = canvasOverlayTarget(root)
  const sourcePortalId = root.closest<HTMLElement>("[data-vibecanvas-portal-id]")
    ?.dataset.vibecanvasPortalId
  let menu: HTMLDivElement | undefined
  let positionAnimationFrame: number | undefined

  const position = () => {
    if (!menu || !target) return
    positionCanvasOverlay(menu, anchor, target)
  }

  const schedulePosition = () => {
    if (!target) return
    if (positionAnimationFrame !== undefined) browser.cancelAnimationFrame(positionAnimationFrame)
    positionAnimationFrame = browser.requestAnimationFrame(() => {
      positionAnimationFrame = undefined
      position()
    })
  }

  const attachMenu = (element: HTMLDivElement) => {
    menu = element
    onElement?.(element)
    if (target) {
      position()
      schedulePosition()
    }
  }

  onSettled(() => {
    if (!target) return

    const observer = browser.createResizeObserver(schedulePosition)
    observer.observe(anchor)
    observer.observe(target)
    const browserWindow = browser.document.defaultView
    browserWindow?.addEventListener("resize", schedulePosition)
    browser.document.addEventListener("scroll", schedulePosition, true)
    schedulePosition()

    return () => {
      browserWindow?.removeEventListener("resize", schedulePosition)
      browser.document.removeEventListener("scroll", schedulePosition, true)
      observer.disconnect()
      if (positionAnimationFrame !== undefined) browser.cancelAnimationFrame(positionAnimationFrame)
    }
  })

  const MenuSurface = () => (
    <div
      ref={attachMenu}
      class={className}
      role={role}
      aria-label={ariaLabel}
      data-omnidraw-ai-chat-portaled-menu={target ? "true" : undefined}
      data-vibecanvas-portal-id={target ? sourcePortalId : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  )

  onSettled(() => () => {
    onElement?.(undefined)
    menu = undefined
  })

  return target === null
    ? <MenuSurface />
    : <Portal mount={target}><MenuSurface /></Portal>
}
