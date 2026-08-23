export type TAnchoredPopupAlignment = "start" | "end";

export type TAnchoredPopupConnection = Readonly<{
  disconnect(): void;
  update(): void;
}>;

const DEFAULT_EDGE_PADDING = 8;
const DEFAULT_GAP = 4;
const THEME_SCOPE_SELECTOR = "[data-omnidraw-theme-scope]";

/**
 * Keeps theme variables from the nearest explicit scope while moving the
 * popup outside any clipping descendants. The application scope lives on the
 * document element, where body is the stable HTML portal host.
 */
export function anchoredPopupPortalTarget(anchor: HTMLElement): HTMLElement {
  const ownerDocument = anchor.ownerDocument;
  const themeScope = anchor.closest<HTMLElement>(THEME_SCOPE_SELECTOR);
  if (themeScope === null || themeScope === ownerDocument.documentElement) {
    return ownerDocument.body;
  }
  const ownerWindow = ownerDocument.defaultView;
  for (let ancestor: HTMLElement | null = themeScope; ancestor !== null; ancestor = ancestor.parentElement) {
    if (ancestor === ownerDocument.body || ancestor === ownerDocument.documentElement) break;
    const style = ownerWindow?.getComputedStyle(ancestor);
    const clips = style !== undefined && [style.overflow, style.overflowX, style.overflowY]
      .some((overflow) => ["auto", "clip", "hidden", "scroll"].includes(overflow));
    if (clips) return ownerDocument.body;
  }
  return themeScope;
}

function viewportSize(ownerDocument: Document): Readonly<{ height: number; width: number }> {
  const ownerWindow = ownerDocument.defaultView;
  return {
    height: ownerWindow?.innerHeight ?? ownerDocument.documentElement.clientHeight,
    width: ownerWindow?.innerWidth ?? ownerDocument.documentElement.clientWidth,
  };
}

/**
 * Positions one portaled popup against its owning DOM anchor. The connection
 * deliberately derives every browser handle from the anchor's owner document
 * so embedded/secondary documents do not leak listeners into the application
 * document.
 */
export function connectAnchoredPopup(args: Readonly<{
  alignment?: TAnchoredPopupAlignment;
  anchor: HTMLElement;
  edgePadding?: number;
  gap?: number;
  matchAnchorWidth?: boolean;
  popup: HTMLElement;
}>): TAnchoredPopupConnection {
  const ownerDocument = args.anchor.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  const alignment = args.alignment ?? "start";
  const edgePadding = args.edgePadding ?? DEFAULT_EDGE_PADDING;
  const gap = args.gap ?? DEFAULT_GAP;
  let connected = true;

  const update = (): void => {
    if (!connected) return;
    const viewport = viewportSize(ownerDocument);
    const maximumWidth = Math.max(0, viewport.width - edgePadding * 2);
    const maximumHeight = Math.max(0, viewport.height - edgePadding * 2);
    const anchorRect = args.anchor.getBoundingClientRect();

    Object.assign(args.popup.style, {
      maxHeight: `${maximumHeight}px`,
      maxWidth: `${maximumWidth}px`,
      position: "fixed",
      visibility: "hidden",
      width: args.matchAnchorWidth
        ? `${Math.min(anchorRect.width, maximumWidth)}px`
        : "",
    });

    const popupRect = args.popup.getBoundingClientRect();
    const maximumLeft = Math.max(edgePadding, viewport.width - popupRect.width - edgePadding);
    const proposedLeft = alignment === "end"
      ? anchorRect.right - popupRect.width
      : anchorRect.left;
    const left = Math.min(Math.max(proposedLeft, edgePadding), maximumLeft);
    const belowTop = anchorRect.bottom + gap;
    const belowSpace = viewport.height - edgePadding - belowTop;
    const aboveSpace = anchorRect.top - edgePadding - gap;
    const placeAbove = popupRect.height > belowSpace && aboveSpace > belowSpace;
    const proposedTop = placeAbove
      ? anchorRect.top - gap - popupRect.height
      : belowTop;
    const maximumTop = Math.max(edgePadding, viewport.height - popupRect.height - edgePadding);
    const top = Math.min(Math.max(proposedTop, edgePadding), maximumTop);

    Object.assign(args.popup.style, {
      left: `${left}px`,
      top: `${top}px`,
      visibility: "visible",
    });
    args.popup.dataset.anchoredSide = placeAbove ? "top" : "bottom";
  };

  const resizeObserver = ownerWindow?.ResizeObserver === undefined
    ? undefined
    : new ownerWindow.ResizeObserver(update);
  resizeObserver?.observe(args.anchor);
  resizeObserver?.observe(args.popup);
  ownerWindow?.addEventListener("resize", update);
  ownerDocument.addEventListener("scroll", update, true);
  update();

  return Object.freeze({
    disconnect(): void {
      if (!connected) return;
      connected = false;
      resizeObserver?.disconnect();
      ownerWindow?.removeEventListener("resize", update);
      ownerDocument.removeEventListener("scroll", update, true);
    },
    update,
  });
}
