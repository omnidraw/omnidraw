const FOCUSABLE_SELECTOR = [
  "select:not(:disabled)",
  "input:not(:disabled)",
  "textarea:not(:disabled)",
  "a[href]",
  "button:not(:disabled)",
  "[contenteditable=\"true\"]",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

type TModalFocusScopeOptions = Readonly<{
  content(): HTMLElement | undefined;
  initialFocus?(): HTMLElement | null | undefined;
  returnFocus?(): HTMLElement | null | undefined;
  onEscape(): void;
  escapeDisabled?(): boolean;
  ownerDocument?: Document;
}>;

type TModalFocusScope = Readonly<{
  content(): HTMLElement | undefined;
  initialFocus?(): HTMLElement | null | undefined;
  returnFocus: HTMLElement | null;
  onEscape(): void;
  escapeDisabled?(): boolean;
}>;

type TIsolatedRoot = Readonly<{
  element: HTMLElement;
  inert: boolean;
  ariaHidden: string | null;
}>;

type TModalFocusManager = {
  document: Document;
  scopes: TModalFocusScope[];
  isolatedRoots: TIsolatedRoot[];
  observer: MutationObserver | null;
  redirectingFocus: boolean;
  handleFocusIn(event: FocusEvent): void;
  handleKeyDown(event: KeyboardEvent): void;
};

const managers = new WeakMap<Document, TModalFocusManager>();

function focusableElements(content: HTMLElement): HTMLElement[] {
  return [...content.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => (
    element.getAttribute("aria-hidden") !== "true"
    && !element.closest("[inert]")
    && element.tabIndex >= 0
  ));
}

function topScope(manager: TModalFocusManager): TModalFocusScope | undefined {
  return manager.scopes.at(-1);
}

function focusInside(manager: TModalFocusManager): void {
  const scope = topScope(manager);
  const content = scope?.content();
  if (scope === undefined || content?.isConnected !== true) return;
  const requested = scope.initialFocus?.();
  const focusable = focusableElements(content);
  const target = requested?.isConnected === true
      && requested.tabIndex >= 0
      && !requested.closest("[inert]")
      && content.contains(requested)
    ? requested
    : focusable[0] ?? content;
  manager.redirectingFocus = true;
  target.focus({ preventScroll: true });
  manager.redirectingFocus = false;
}

function restoreIsolation(manager: TModalFocusManager): void {
  for (const root of manager.isolatedRoots) {
    root.element.inert = root.inert;
    if (root.ariaHidden === null) root.element.removeAttribute("aria-hidden");
    else root.element.setAttribute("aria-hidden", root.ariaHidden);
  }
  manager.isolatedRoots = [];
}

function syncIsolation(manager: TModalFocusManager): void {
  restoreIsolation(manager);
  const content = topScope(manager)?.content();
  const body = manager.document.body;
  if (content?.isConnected !== true || body === null) return;
  const HTMLElementConstructor = manager.document.defaultView?.HTMLElement;
  if (HTMLElementConstructor === undefined) return;
  for (const child of body.children) {
    if (!(child instanceof HTMLElementConstructor) || child.contains(content)) continue;
    manager.isolatedRoots.push({
      element: child,
      inert: child.inert,
      ariaHidden: child.getAttribute("aria-hidden"),
    });
    child.inert = true;
    child.setAttribute("aria-hidden", "true");
  }
}

function createManager(ownerDocument: Document): TModalFocusManager {
  const manager: TModalFocusManager = {
    document: ownerDocument,
    scopes: [],
    isolatedRoots: [],
    observer: null,
    redirectingFocus: false,
    handleFocusIn: () => undefined,
    handleKeyDown: () => undefined,
  };
  manager.handleFocusIn = (event) => {
    if (manager.redirectingFocus) return;
    const content = topScope(manager)?.content();
    const target = event.target;
    const NodeConstructor = manager.document.defaultView?.Node;
    if (
      content?.isConnected !== true
      || (NodeConstructor !== undefined && target instanceof NodeConstructor && content.contains(target))
    ) return;
    event.stopImmediatePropagation();
    focusInside(manager);
  };
  manager.handleKeyDown = (event) => {
    const scope = topScope(manager);
    const content = scope?.content();
    if (scope === undefined || content?.isConnected !== true) return;
    if (event.key === "Escape" && !event.defaultPrevented && scope.escapeDisabled?.() !== true) {
      event.preventDefault();
      event.stopImmediatePropagation();
      scope.onEscape();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = focusableElements(content);
    const active = manager.document.activeElement;
    if (focusable.length === 0) {
      event.preventDefault();
      content.focus({ preventScroll: true });
      return;
    }
    const current = focusable.findIndex((element) => element === active);
    const next = current < 0
      ? event.shiftKey ? focusable.length - 1 : 0
      : event.shiftKey
        ? (current - 1 + focusable.length) % focusable.length
        : (current + 1) % focusable.length;
    event.preventDefault();
    focusable[next]?.focus({ preventScroll: true });
  };
  ownerDocument.addEventListener("focusin", manager.handleFocusIn, true);
  ownerDocument.addEventListener("keydown", manager.handleKeyDown, true);
  const MutationObserverConstructor = ownerDocument.defaultView?.MutationObserver;
  if (MutationObserverConstructor !== undefined && ownerDocument.body !== null) {
    manager.observer = new MutationObserverConstructor(() => syncIsolation(manager));
    manager.observer.observe(ownerDocument.body, { childList: true });
  }
  managers.set(ownerDocument, manager);
  return manager;
}

function destroyManager(manager: TModalFocusManager): void {
  restoreIsolation(manager);
  manager.observer?.disconnect();
  manager.document.removeEventListener("focusin", manager.handleFocusIn, true);
  manager.document.removeEventListener("keydown", manager.handleKeyDown, true);
  managers.delete(manager.document);
}

/**
 * Installs one document-capture focus scope. All owned modal replacements use
 * this stack so only the topmost dialog can receive focus or keyboard input.
 */
export function activateModalFocusScope(options: TModalFocusScopeOptions): () => void {
  const ownerDocument = options.content()?.ownerDocument ?? options.ownerDocument ?? document;
  const manager = managers.get(ownerDocument) ?? createManager(ownerDocument);
  const requestedReturnFocus = options.returnFocus?.();
  const HTMLElementConstructor = ownerDocument.defaultView?.HTMLElement;
  const scope: TModalFocusScope = {
    content: options.content,
    initialFocus: options.initialFocus,
    returnFocus: requestedReturnFocus ?? (
      HTMLElementConstructor !== undefined && ownerDocument.activeElement instanceof HTMLElementConstructor
        ? ownerDocument.activeElement
        : null
    ),
    onEscape: options.onEscape,
    escapeDisabled: options.escapeDisabled,
  };
  manager.scopes.push(scope);
  syncIsolation(manager);
  queueMicrotask(() => {
    if (topScope(manager) !== scope) return;
    syncIsolation(manager);
    focusInside(manager);
  });

  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const index = manager.scopes.indexOf(scope);
    if (index >= 0) manager.scopes.splice(index, 1);
    if (manager.scopes.length === 0) destroyManager(manager);
    else syncIsolation(manager);
    queueMicrotask(() => {
      const currentManager = managers.get(ownerDocument);
      const currentScope = currentManager === undefined ? undefined : topScope(currentManager);
      if (currentManager !== undefined && currentScope !== undefined) {
        const returnFocus = scope.returnFocus;
        const currentContent = currentScope.content();
        if (
          returnFocus?.isConnected === true
          && currentContent?.contains(returnFocus) === true
        ) returnFocus.focus({ preventScroll: true });
        else focusInside(currentManager);
        return;
      }
      if (scope.returnFocus?.isConnected === true && !scope.returnFocus.inert) {
        scope.returnFocus.focus({ preventScroll: true });
      }
    });
  };
}
