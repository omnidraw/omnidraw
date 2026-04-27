import { html, reactive } from "@arrow-js/core";
import { init as initGhostty, Terminal as GhosttyTerminal } from "ghostty-web";
import type {
  TPtyImageFormat,
  TPtyLike,
  TTerminalConnectionStatus,
  TTerminalFolderNode,
  TTerminalTabPayload,
  TTerminalWidgetMountArgs,
  TTerminalWidgetPayload,
} from "./typed";
import "./widget.css";

type TGhosttyTheme = {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
};

type TGhosttyTerminalOptions = {
  cursorBlink: boolean;
  cursorStyle: string;
  fontFamily: string;
  fontSize: number;
  scrollback: number;
  theme: TGhosttyTheme;
};

type TGhosttyDisposable = {
  dispose: () => void;
};

type TGhosttyRendererLike = {
  getMetrics?: () => { width: number; height: number };
};

type TGhosttyWasmTerminalLike = {
  getDimensions?: () => { cols: number; rows: number };
  getMode?: (mode: number, isAnsi?: boolean) => boolean;
  hasMouseTracking?: () => boolean;
};

type TGhosttyTerminalInstance = {
  cols: number;
  rows: number;
  element?: HTMLDivElement | null;
  textarea?: HTMLTextAreaElement | null;
  canvas?: HTMLCanvasElement | null;
  renderer?: TGhosttyRendererLike;
  wasmTerm?: TGhosttyWasmTerminalLike;
  attachCustomWheelEventHandler?: (handler?: (event: WheelEvent) => boolean) => void;
  open: (root: HTMLDivElement) => void;
  onData: (handler: (data: string) => void) => TGhosttyDisposable | void;
  onResize: (handler: (next: { cols: number; rows: number }) => void) => TGhosttyDisposable | void;
  resize: (cols: number, rows: number) => void;
  write: (data: string) => void;
  clear: () => void;
  dispose: () => void;
  paste?: (next: string) => void;
  input?: (next: string, fromPaste?: boolean) => void;
};

type TClipboardLike = {
  getData?: (type: string) => string;
  types?: Iterable<string> | ArrayLike<string>;
  items?: Iterable<{ kind?: string; type?: string; getAsFile?: () => File | null }> | ArrayLike<{ kind?: string; type?: string; getAsFile?: () => File | null }>;
  files?: Iterable<File> | ArrayLike<File>;
};

type TClipboardEventLike = Event & {
  clipboardData?: TClipboardLike | null;
};

type TTerminalBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type TTerminalCellCoordinates = {
  col: number;
  row: number;
};

type TTerminalTabState = TTerminalTabPayload & {
  status: TTerminalConnectionStatus;
  error: string | null;
  ptyID: string | null;
  rows: number;
  cols: number;
};

type TTerminalContextMenuState = {
  tabId: string;
  x: number;
  y: number;
} | null;

type TTerminalSession = {
  tabId: string;
  term: TGhosttyTerminalInstance | null;
  host: HTMLDivElement | null;
  root: HTMLDivElement | null;
  socket: WebSocket | null;
  resizeObserver: ResizeObserver | null;
  resizeTimer: ReturnType<typeof setTimeout> | null;
  sizePushTimer: ReturnType<typeof setTimeout> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempt: number;
  cursor: number;
  pendingInputBuffer: string;
  closingSocketIntentionally: boolean;
  disposed: boolean;
  pty: TPtyLike | null;
  cleanupPasteListeners: (() => void) | null;
};

const DEFAULT_ROWS = 24;
const DEFAULT_COLS = 80;
const MIN_ROWS = 8;
const MIN_COLS = 20;
const FALLBACK_CELL_WIDTH = 8;
const FALLBACK_CELL_HEIGHT = 18;
const RECONNECT_BASE_DELAY_MS = 400;
const RECONNECT_MAX_DELAY_MS = 10_000;
const RECONNECT_JITTER_RATIO = 0.2;
const TERMINAL_WHEEL_PIXEL_STEP = 33;
const TERMINAL_WHEEL_MAX_STEPS = 5;
const TERMINAL_MOUSE_WHEEL_UP_BUTTON = 64;
const TERMINAL_MOUSE_WHEEL_DOWN_BUTTON = 65;
const TERMINAL_MOUSE_SGR_MODE = 1006;

let ghosttyInitPromise: Promise<void> | null = null;

function ensureGhosttyInit(): Promise<void> {
  if (!ghosttyInitPromise) {
    ghosttyInitPromise = initGhostty();
  }

  return ghosttyInitPromise;
}

function getThemeValue(element: HTMLElement, cssVariable: string, fallback: string) {
  const view = element.ownerDocument.defaultView;
  const localValue = view?.getComputedStyle(element).getPropertyValue(cssVariable).trim();
  if (localValue && localValue.length > 0) {
    return localValue;
  }

  const rootValue = view?.getComputedStyle(element.ownerDocument.documentElement).getPropertyValue(cssVariable).trim();
  return rootValue && rootValue.length > 0 ? rootValue : fallback;
}

function getGhosttyTheme(element: HTMLElement): TGhosttyTheme {
  return {
    background: getThemeValue(element, "--vc-terminal-background", "#111214"),
    foreground: getThemeValue(element, "--vc-terminal-foreground", "#e5e7eb"),
    cursor: getThemeValue(element, "--vc-terminal-cursor", "#f59e0b"),
    selectionBackground: getThemeValue(element, "--vc-terminal-selection-background", "#374151"),
  };
}

function basename(path: string) {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

function joinPath(basePath: string, childName: string) {
  const normalizedBase = basePath.replaceAll("\\", "/").replace(/\/+$/, "");
  if (!normalizedBase || normalizedBase === "/") return `/${childName}`;
  return `${normalizedBase}/${childName}`;
}

function toPathLabel(path: string) {
  return path.replace(/^\/Users\/([^/]+)/, "~");
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }

  return fallback;
}

function isApiError(value: unknown): value is { type: string; message: string } {
  return value !== null
    && typeof value === "object"
    && "type" in value
    && "message" in value
    && typeof (value as { message?: unknown }).message === "string";
}

function getFilesystemPickerErrorMessage(error: unknown, result: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }

  if (isApiError(result)) {
    return result.message;
  }

  return fallback;
}

function getPtyWebsocketUrl(args: { ptyID: string; workingDirectory: string }) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({ workingDirectory: args.workingDirectory });
  return `${protocol}//${window.location.host}/api/pty/${encodeURIComponent(args.ptyID)}/connect?${params.toString()}`;
}

function getCellSize(term: TGhosttyTerminalInstance | null): { width: number; height: number } {
  const metrics = term?.renderer?.getMetrics?.();
  const width = Number(metrics?.width);
  const height = Number(metrics?.height);

  return {
    width: Number.isFinite(width) && width > 0 ? width : FALLBACK_CELL_WIDTH,
    height: Number.isFinite(height) && height > 0 ? height : FALLBACK_CELL_HEIGHT,
  };
}

function hasUsableHostSize(host: HTMLElement | null | undefined): host is HTMLElement {
  return Boolean(host && host.clientWidth > 0 && host.clientHeight > 0);
}

function calculateTerminalSize(host: HTMLElement, term: TGhosttyTerminalInstance | null): { rows: number; cols: number } {
  const { width: cellWidth, height: cellHeight } = getCellSize(term);
  const cols = Math.max(MIN_COLS, Math.floor(host.clientWidth / cellWidth));
  const rows = Math.max(MIN_ROWS, Math.floor(host.clientHeight / cellHeight));
  return { rows, cols };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getTerminalBounds(term: TGhosttyTerminalInstance): TTerminalBounds | null {
  const rectSource = term.canvas ?? term.element;
  if (!rectSource) return null;

  const rect = rectSource.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  const metrics = term.renderer?.getMetrics?.();
  const fallbackCols = term.wasmTerm?.getDimensions?.().cols ?? term.cols;
  const fallbackRows = term.wasmTerm?.getDimensions?.().rows ?? term.rows;
  if (metrics?.width && metrics?.height && fallbackCols > 0 && fallbackRows > 0) {
    return {
      left: rect.left,
      top: rect.top,
      width: metrics.width * fallbackCols,
      height: metrics.height * fallbackRows,
    };
  }

  return null;
}

function getTerminalCellCoordinates(term: TGhosttyTerminalInstance, event: WheelEvent): TTerminalCellCoordinates | null {
  const bounds = getTerminalBounds(term);
  const cols = term.wasmTerm?.getDimensions?.().cols ?? term.cols;
  const rows = term.wasmTerm?.getDimensions?.().rows ?? term.rows;

  if (!bounds || cols <= 0 || rows <= 0 || bounds.width <= 0 || bounds.height <= 0) {
    return null;
  }

  const localX = clamp(event.clientX - bounds.left, 0, bounds.width);
  const localY = clamp(event.clientY - bounds.top, 0, bounds.height);

  return {
    col: clamp(Math.floor(localX / (bounds.width / cols)) + 1, 1, cols),
    row: clamp(Math.floor(localY / (bounds.height / rows)) + 1, 1, rows),
  };
}

function getWheelStepCount(event: WheelEvent) {
  const delta = Math.abs(event.deltaY);
  if (delta === 0) return 0;

  let normalized = 0;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    normalized = delta;
  } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    normalized = delta * 3;
  } else {
    normalized = delta / TERMINAL_WHEEL_PIXEL_STEP;
  }

  return clamp(Math.max(1, Math.round(normalized)), 1, TERMINAL_WHEEL_MAX_STEPS);
}

function getWheelMouseButton(event: WheelEvent) {
  if (event.deltaY === 0) return null;

  const modifierMask = (event.shiftKey ? 4 : 0)
    + (event.altKey ? 8 : 0)
    + (event.ctrlKey ? 16 : 0);

  return (event.deltaY > 0 ? TERMINAL_MOUSE_WHEEL_DOWN_BUTTON : TERMINAL_MOUSE_WHEEL_UP_BUTTON)
    + modifierMask;
}

function buildWheelMouseSequence(term: TGhosttyTerminalInstance, event: WheelEvent) {
  const coords = getTerminalCellCoordinates(term, event);
  const button = getWheelMouseButton(event);
  const steps = getWheelStepCount(event);
  if (!coords || button === null || steps <= 0) return null;

  return Array.from(
    { length: steps },
    () => `\x1b[<${button};${coords.col};${coords.row}M`,
  ).join("");
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Failed to read clipboard image"));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read clipboard image"));
    };
    reader.readAsDataURL(file);
  });
}

function toPtyImageFormat(type: string): TPtyImageFormat | null {
  if (type === "image/jpeg") return type;
  if (type === "image/png") return type;
  if (type === "image/gif") return type;
  if (type === "image/webp") return type;
  return null;
}

function getClipboardText(clipboardData: TClipboardLike | null | undefined) {
  if (!clipboardData?.getData) return "";
  return clipboardData.getData("text/plain") || clipboardData.getData("text") || "";
}

function isSupportedClipboardImageType(type: string) {
  return type === "image/jpeg" || type === "image/png" || type === "image/gif" || type === "image/webp";
}

function getFirstClipboardImageFile(clipboardData: TClipboardLike | null | undefined) {
  const directFile = clipboardData?.files
    ? Array.from(clipboardData.files).find((file): file is File => file !== null && isSupportedClipboardImageType(file.type))
    : null;
  if (directFile) return directFile;

  const itemFile = clipboardData?.items
    ? Array.from(clipboardData.items)
      .map((item) => item?.getAsFile?.() ?? null)
      .find((file): file is File => file !== null && isSupportedClipboardImageType(file.type))
    : null;

  return itemFile ?? null;
}

function toShellEscapedPathText(path: string) {
  return `'${path.replaceAll("'", `'\\''`)}' `;
}

function asClipboardEventLike(event: Event): TClipboardEventLike {
  return event as TClipboardEventLike;
}

function asArrayBufferFromBlob(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

function normalizePayloadTabs(payload: TTerminalWidgetPayload): TTerminalTabPayload[] {
  const seen = new Set<string>();
  const validTabs = (payload.tabs ?? [])
    .filter((tab): tab is TTerminalTabPayload => {
      return Boolean(tab)
        && typeof tab.id === "string"
        && tab.id.length > 0
        && typeof tab.workingDirectory === "string"
        && tab.workingDirectory.length > 0
        && !seen.has(tab.id);
    })
    .map((tab) => {
      seen.add(tab.id);
      return {
        id: tab.id,
        title: typeof tab.title === "string" && tab.title.length > 0 ? tab.title : tab.workingDirectory,
        workingDirectory: tab.workingDirectory,
      };
    });

  if (validTabs.length > 0) {
    return validTabs;
  }

  if (payload.workingDirectory) {
    return [{
      id: crypto.randomUUID(),
      title: typeof payload.title === "string" && payload.title.length > 0 ? payload.title : payload.workingDirectory,
      workingDirectory: payload.workingDirectory,
    }];
  }

  return [];
}

function toTabState(tab: TTerminalTabPayload): TTerminalTabState {
  return {
    ...tab,
    status: "idle",
    error: null,
    ptyID: null,
    rows: DEFAULT_ROWS,
    cols: DEFAULT_COLS,
  };
}

export function mountTerminalWidget(args: TTerminalWidgetMountArgs) {
  const payload = args.element.data.type === "widget"
    ? args.element.data.payload as TTerminalWidgetPayload
    : {};
  const initialTabs = normalizePayloadTabs(payload).map(toTabState);
  const initialActiveTabId = initialTabs.some((tab) => tab.id === payload.activeTabId)
    ? payload.activeTabId ?? initialTabs[0]?.id ?? null
    : initialTabs[0]?.id ?? null;

  const state = reactive({
    tabs: initialTabs,
    activeTabId: initialActiveTabId,
    contextMenu: null as TTerminalContextMenuState,
  });

  const cwdInputId = `vc-terminal-cwd-input-${args.element.id}`;

  const cwdPicker = reactive({
    path: payload.workingDirectory ?? "",
    parentPath: null as string | null,
    homePath: "",
    selectedPath: null as string | null,
    children: [] as TTerminalFolderNode[],
    history: [] as string[],
    historyIndex: -1,
    loading: false,
    error: null as string | null,
  });

  const sessions = new Map<string, TTerminalSession>();
  let disposed = false;

  const getActiveTab = () => state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;

  const focusCwdPickerInput = () => {
    queueMicrotask(() => {
      args.root.querySelector<HTMLInputElement>("[data-terminal-cwd-input='true']")?.focus({ preventScroll: true });
    });
  };

  const rememberCwdPath = (path: string) => {
    if (cwdPicker.history[cwdPicker.historyIndex] === path) return;

    const retainedHistory = cwdPicker.historyIndex >= 0
      ? cwdPicker.history.slice(0, cwdPicker.historyIndex + 1)
      : [];
    const nextHistory = [...retainedHistory, path].slice(-30);
    cwdPicker.history = nextHistory;
    cwdPicker.historyIndex = nextHistory.length - 1;
  };

  const loadCwdPath = async (path: string, options: { remember?: boolean } = {}) => {
    const nextPath = path.trim();
    if (!nextPath) {
      cwdPicker.error = "Working directory is required.";
      return;
    }

    cwdPicker.loading = true;
    cwdPicker.error = null;

    const [error, result] = await args.apiService.api.filesystem.list({
      query: { path: nextPath, omitFiles: true },
    });

    if (disposed) return;
    if (error || !result || isApiError(result)) {
      cwdPicker.loading = false;
      cwdPicker.error = getFilesystemPickerErrorMessage(error, result, "Failed to list folders");
      return;
    }

    cwdPicker.path = result.current;
    cwdPicker.parentPath = result.parent;
    cwdPicker.selectedPath = null;
    cwdPicker.children = result.children.map((child) => ({
      name: child.name,
      path: child.path,
      is_dir: child.isDir,
      children: [],
    })).filter((child) => child.is_dir);
    cwdPicker.loading = false;

    if (options.remember !== false) {
      rememberCwdPath(result.current);
    }
  };

  const loadCwdHistory = (nextIndex: number) => {
    const nextPath = cwdPicker.history[nextIndex];
    if (!nextPath) return;

    cwdPicker.historyIndex = nextIndex;
    void loadCwdPath(nextPath, { remember: false });
  };

  const selectCwdPath = (path: string) => {
    cwdPicker.selectedPath = path;
    cwdPicker.error = null;
  };

  const loadHomeCwd = async () => {
    cwdPicker.loading = true;
    cwdPicker.error = null;

    const [error, result] = await args.apiService.api.filesystem.home();
    if (disposed) return;
    if (error || !result || isApiError(result)) {
      cwdPicker.loading = false;
      cwdPicker.error = getFilesystemPickerErrorMessage(error, result, "Failed to resolve home directory");
      return;
    }

    cwdPicker.homePath = result.path;
    await loadCwdPath(result.path);
  };

  const quickCwdPaths = () => {
    if (!cwdPicker.homePath) return [];

    return [
      { label: basename(cwdPicker.homePath), path: cwdPicker.homePath, icon: "⌂" },
      { label: "Desktop", path: joinPath(cwdPicker.homePath, "Desktop"), icon: "□" },
      { label: "Documents", path: joinPath(cwdPicker.homePath, "Documents"), icon: "▤" },
      { label: "Downloads", path: joinPath(cwdPicker.homePath, "Downloads"), icon: "⇩" },
    ];
  };

  const recentCwdPaths = () => {
    return [...cwdPicker.history]
      .reverse()
      .filter((path, index, allPaths) => allPaths.indexOf(path) === index)
      .slice(0, 6);
  };

  const onCwdInput = (event: InputEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    cwdPicker.path = target.value;
    cwdPicker.selectedPath = null;
    cwdPicker.error = null;
  };

  const persistTabs = () => {
    const firstTab = state.tabs[0] ?? null;
    args.onPersist?.({
      workingDirectory: firstTab?.workingDirectory ?? "",
      title: firstTab?.title ?? "",
      activeTabId: state.activeTabId,
      tabs: state.tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        workingDirectory: tab.workingDirectory,
      })),
    });
  };

  const updateTab = (tabId: string, patch: Partial<TTerminalTabState>) => {
    state.tabs = state.tabs.map((tab) => tab.id === tabId ? { ...tab, ...patch } : tab);
  };

  const closeContextMenu = () => {
    state.contextMenu = null;
  };

  const setActiveTab = (tabId: string) => {
    if (!state.tabs.some((tab) => tab.id === tabId)) return;
    state.activeTabId = tabId;
    closeContextMenu();
    persistTabs();
    queueMicrotask(() => {
      const session = sessions.get(tabId);
      if (!session) return;
      scheduleResizeSync(session);
      focusTerminalInputSurface(tabId);
    });
  };

  const createSession = (tabId: string): TTerminalSession => ({
    tabId,
    term: null,
    host: null,
    root: null,
    socket: null,
    resizeObserver: null,
    resizeTimer: null,
    sizePushTimer: null,
    reconnectTimer: null,
    reconnectAttempt: 0,
    cursor: 0,
    pendingInputBuffer: "",
    closingSocketIntentionally: false,
    disposed: false,
    pty: null,
    cleanupPasteListeners: null,
  });

  const clearSessionTimers = (session: TTerminalSession) => {
    if (session.resizeTimer) clearTimeout(session.resizeTimer);
    if (session.sizePushTimer) clearTimeout(session.sizePushTimer);
    if (session.reconnectTimer) clearTimeout(session.reconnectTimer);
    session.resizeTimer = null;
    session.sizePushTimer = null;
    session.reconnectTimer = null;
  };

  const closeSocket = (session: TTerminalSession) => {
    if (!session.socket) return;
    session.closingSocketIntentionally = true;
    session.socket.close(1000, "Terminal tab closed");
    session.socket = null;
  };

  const removePty = async (session: TTerminalSession, workingDirectory: string) => {
    const pty = session.pty;
    session.pty = null;
    updateTab(session.tabId, { ptyID: null });
    if (!pty) return;

    const [error] = await args.apiService.api.pty.remove({
      workingDirectory,
      path: { ptyID: pty.id },
    });

    if (error && !disposed && !session.disposed) {
      updateTab(session.tabId, { error: getErrorMessage(error, "Failed to remove terminal session") });
    }
  };

  const cleanupSession = (tabId: string, options: { removePty: boolean } = { removePty: true }) => {
    const session = sessions.get(tabId);
    if (!session) return;

    const tab = state.tabs.find((candidate) => candidate.id === tabId);
    session.disposed = true;
    closeSocket(session);
    clearSessionTimers(session);
    session.resizeObserver?.disconnect();
    session.resizeObserver = null;
    session.cleanupPasteListeners?.();
    session.cleanupPasteListeners = null;
    session.term?.attachCustomWheelEventHandler?.(undefined);
    session.term?.dispose();
    session.term = null;
    session.root?.replaceChildren();
    sessions.delete(tabId);

    if (options.removePty && tab) {
      void removePty(session, tab.workingDirectory);
    }
  };

  const focusTerminalInputSurface = (tabId: string | null = state.activeTabId) => {
    if (!tabId) return;
    const pane = args.root.querySelector<HTMLElement>(`[data-terminal-pane-id="${CSS.escape(tabId)}"]`);
    const textarea = pane?.querySelector<HTMLElement>("[data-ghostty-terminal-textarea='true'], textarea");
    if (textarea) {
      textarea.focus({ preventScroll: true });
      return;
    }

    pane?.querySelector<HTMLElement>("[data-ghostty-terminal-root='true']")?.focus({ preventScroll: true });
  };

  const flushPendingInput = (session: TTerminalSession) => {
    if (!session.pendingInputBuffer) return;
    if (!session.socket || session.socket.readyState !== WebSocket.OPEN) return;
    session.socket.send(session.pendingInputBuffer);
    session.pendingInputBuffer = "";
  };

  const sendTerminalInput = (session: TTerminalSession, data: string) => {
    if (!session.socket || session.socket.readyState !== WebSocket.OPEN) {
      session.pendingInputBuffer += data;
      return;
    }

    session.socket.send(data);
  };

  const writeTerminalOutput = (session: TTerminalSession, data: string, byteLength: number) => {
    session.term?.write(data);
    session.cursor += byteLength;
  };

  const handleSocketMessage = (session: TTerminalSession, event: MessageEvent) => {
    if (disposed || session.disposed || !session.term) return;

    if (event.data instanceof ArrayBuffer) {
      writeTerminalOutput(session, new TextDecoder().decode(event.data), event.data.byteLength);
      return;
    }

    if (event.data instanceof Blob) {
      void asArrayBufferFromBlob(event.data).then((arrayBuffer) => {
        if (disposed || session.disposed || !session.term) return;
        writeTerminalOutput(session, new TextDecoder().decode(arrayBuffer), arrayBuffer.byteLength);
      });
      return;
    }

    if (typeof event.data === "string") {
      writeTerminalOutput(session, event.data, new TextEncoder().encode(event.data).byteLength);
    }
  };

  const getReconnectDelay = (session: TTerminalSession) => {
    const unclampedDelay = RECONNECT_BASE_DELAY_MS * (2 ** Math.max(0, session.reconnectAttempt));
    const baseDelay = Math.min(RECONNECT_MAX_DELAY_MS, unclampedDelay);
    const jitterWindow = Math.floor(baseDelay * RECONNECT_JITTER_RATIO);
    const jitter = jitterWindow > 0 ? Math.floor(Math.random() * (jitterWindow + 1)) : 0;
    session.reconnectAttempt += 1;
    return Math.max(0, baseDelay + jitter);
  };

  const connectPtySocket = (session: TTerminalSession, tab: TTerminalTabState, ptyID: string) => {
    if (disposed || session.disposed) return;
    closeSocket(session);
    session.closingSocketIntentionally = false;
    updateTab(tab.id, { status: "connecting", error: null });

    const nextSocket = new WebSocket(getPtyWebsocketUrl({ ptyID, workingDirectory: tab.workingDirectory }));
    nextSocket.binaryType = "arraybuffer";
    session.socket = nextSocket;

    nextSocket.onopen = () => {
      if (disposed || session.disposed || session.socket !== nextSocket) return;
      session.reconnectAttempt = 0;
      updateTab(tab.id, { status: "connected", error: null });
      flushPendingInput(session);
      if (state.activeTabId === tab.id) {
        focusTerminalInputSurface(tab.id);
      }
    };

    nextSocket.onmessage = (event) => {
      if (session.socket !== nextSocket) return;
      handleSocketMessage(session, event);
    };

    nextSocket.onerror = () => {
      if (disposed || session.disposed || session.socket !== nextSocket) return;
      updateTab(tab.id, { status: "error", error: "Terminal stream failed." });
    };

    nextSocket.onclose = (event) => {
      if (session.socket && session.socket !== nextSocket) return;
      if (session.socket === nextSocket) {
        session.socket = null;
      }
      if (disposed || session.disposed || session.closingSocketIntentionally) return;

      if (event.code === 1000) {
        updateTab(tab.id, { status: "closed", error: event.reason || "Terminal session closed." });
        return;
      }

      const delayMs = getReconnectDelay(session);
      updateTab(tab.id, {
        status: "connecting",
        error: `Terminal disconnected. Reconnecting in ${Math.ceil(delayMs / 1000)}s…`,
      });
      session.reconnectTimer = setTimeout(() => {
        session.reconnectTimer = null;
        if (disposed || session.disposed || !session.pty) return;
        connectPtySocket(session, tab, session.pty.id);
      }, delayMs);
    };
  };

  const pushSizeToBackend = (session: TTerminalSession, tab: TTerminalTabState, rows: number, cols: number) => {
    if (!session.pty || disposed || session.disposed) return;
    if (session.sizePushTimer) clearTimeout(session.sizePushTimer);

    const ptyID = session.pty.id;
    session.sizePushTimer = setTimeout(async () => {
      if (disposed || session.disposed || !session.pty || session.pty.id !== ptyID) return;
      await args.apiService.api.pty.update({
        workingDirectory: tab.workingDirectory,
        path: { ptyID },
        body: { size: { rows, cols } },
      });
    }, 120);
  };

  const syncFrontendSize = (session: TTerminalSession) => {
    if (!session.host || !session.term || !hasUsableHostSize(session.host)) return;

    const next = calculateTerminalSize(session.host, session.term);
    if (next.cols === session.term.cols && next.rows === session.term.rows) return;
    session.term.resize(next.cols, next.rows);
  };

  function scheduleResizeSync(session: TTerminalSession) {
    if (session.resizeTimer) clearTimeout(session.resizeTimer);
    session.resizeTimer = setTimeout(() => {
      session.resizeTimer = null;
      syncFrontendSize(session);
    }, 120);
  }

  const createPty = async (session: TTerminalSession, tab: TTerminalTabState) => {
    if (disposed || session.disposed) return;
    updateTab(tab.id, { status: "creating", error: null });

    const measuredSize = session.host && hasUsableHostSize(session.host)
      ? calculateTerminalSize(session.host, session.term)
      : { rows: DEFAULT_ROWS, cols: DEFAULT_COLS };
    updateTab(tab.id, { rows: measuredSize.rows, cols: measuredSize.cols });

    const [error, created] = await args.apiService.api.pty.create({
      workingDirectory: tab.workingDirectory,
      body: {
        title: tab.title || basename(tab.workingDirectory),
        size: measuredSize,
      },
    });

    if (disposed || session.disposed) {
      if (created) {
        void args.apiService.api.pty.remove({
          workingDirectory: tab.workingDirectory,
          path: { ptyID: created.id },
        });
      }
      return;
    }
    if (error || !created) {
      updateTab(tab.id, { status: "error", error: getErrorMessage(error, "Failed to create terminal session") });
      return;
    }

    session.pty = created as TPtyLike;
    session.cursor = 0;
    updateTab(tab.id, {
      ptyID: session.pty.id,
      title: tab.title || session.pty.title || basename(tab.workingDirectory),
      status: "connecting",
      rows: measuredSize.rows,
      cols: measuredSize.cols,
    });

    if (session.term) {
      session.term.resize(measuredSize.cols, measuredSize.rows);
    }

    connectPtySocket(session, tab, session.pty.id);
  };

  const uploadClipboardImage = async (workingDirectory: string, file: File | Blob) => {
    const format = toPtyImageFormat(file.type);
    if (!format) {
      throw new Error(`Unsupported clipboard image type: ${file.type || "unknown"}`);
    }

    const base64 = await fileToDataUrl(file);
    const [error, result] = await args.apiService.api.pty.uploadImage({
      workingDirectory,
      body: {
        base64,
        format,
      },
    });

    if (error || !result?.path) {
      throw new Error(getErrorMessage(error, "Failed to upload clipboard image"));
    }

    return result.path;
  };

  const pasteText = (session: TTerminalSession, text: string) => {
    if (typeof session.term?.paste === "function") {
      session.term.paste(text);
      return;
    }

    sendTerminalInput(session, text);
  };

  const setupPasteListeners = (session: TTerminalSession, tab: TTerminalTabState) => {
    if (!session.host || !session.root) return;

    const handlePaste = (event: Event) => {
      const clipboardEvent = asClipboardEventLike(event);
      if (!session.term || clipboardEvent.defaultPrevented) return;

      const text = getClipboardText(clipboardEvent.clipboardData);
      if (text) {
        clipboardEvent.preventDefault();
        clipboardEvent.stopPropagation();
        pasteText(session, text);
        return;
      }

      const imageFile = getFirstClipboardImageFile(clipboardEvent.clipboardData);
      if (imageFile) {
        clipboardEvent.preventDefault();
        clipboardEvent.stopPropagation();
        void uploadClipboardImage(tab.workingDirectory, imageFile)
          .then((path) => {
            if (disposed || session.disposed || !session.term) return;
            pasteText(session, toShellEscapedPathText(path));
          })
          .catch(() => {
            sendTerminalInput(session, "\x16");
          });
      }
    };

    const pasteTargets = [session.host, session.root, session.term?.element, session.term?.textarea].filter((value): value is HTMLDivElement | HTMLTextAreaElement => Boolean(value));
    pasteTargets.forEach((target) => target.addEventListener("paste", handlePaste, true));
    session.cleanupPasteListeners = () => {
      pasteTargets.forEach((target) => target.removeEventListener("paste", handlePaste, true));
    };
  };

  const setupWheelForwarding = (session: TTerminalSession) => {
    session.term?.attachCustomWheelEventHandler?.((event) => {
      if (!session.term) return false;
      const wasmTerm = session.term.wasmTerm;
      const mouseTracking = wasmTerm?.hasMouseTracking?.() ?? false;
      const sgrMouseMode = wasmTerm?.getMode?.(TERMINAL_MOUSE_SGR_MODE, false) ?? false;
      if (!mouseTracking || !sgrMouseMode) return false;

      const sequence = buildWheelMouseSequence(session.term, event);
      if (!sequence) return false;

      if (typeof session.term.input === "function") {
        session.term.input(sequence, true);
      } else {
        sendTerminalInput(session, sequence);
      }
      return true;
    });
  };

  const mountSession = async (tabId: string) => {
    const tab = state.tabs.find((candidate) => candidate.id === tabId);
    if (!tab || sessions.has(tabId) || disposed) return;

    const host = args.root.querySelector<HTMLDivElement>(`[data-terminal-pane-id="${CSS.escape(tabId)}"] [data-ghostty-terminal-host="true"]`);
    const terminalRoot = args.root.querySelector<HTMLDivElement>(`[data-terminal-pane-id="${CSS.escape(tabId)}"] [data-ghostty-terminal-root="true"]`);
    if (!host || !terminalRoot) return;

    const session = createSession(tabId);
    session.host = host;
    session.root = terminalRoot;
    sessions.set(tabId, session);

    await ensureGhosttyInit();
    if (disposed || session.disposed) return;

    const GhosttyTerminalCtor = GhosttyTerminal as unknown as new (options: TGhosttyTerminalOptions) => TGhosttyTerminalInstance;
    session.term = new GhosttyTerminalCtor({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "JetBrains Mono Variable, ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      scrollback: 10000,
      theme: getGhosttyTheme(host),
    });

    terminalRoot.style.caretColor = "transparent";
    terminalRoot.style.outline = "none";
    session.term.open(terminalRoot);

    if (session.term.element) {
      session.term.element.style.caretColor = "transparent";
      session.term.element.style.outline = "none";
    }

    if (session.term.textarea) {
      session.term.textarea.style.caretColor = "transparent";
      session.term.textarea.dataset.ghosttyTerminalTextarea = "true";
    }

    session.term.onData((data) => {
      sendTerminalInput(session, data);
    });

    session.term.onResize((next) => {
      updateTab(tabId, { cols: next.cols, rows: next.rows });
      pushSizeToBackend(session, tab, next.rows, next.cols);
    });

    setupPasteListeners(session, tab);
    setupWheelForwarding(session);

    session.resizeObserver = new ResizeObserver(() => {
      if (state.activeTabId !== tabId) return;
      scheduleResizeSync(session);
    });
    session.resizeObserver.observe(host);
    scheduleResizeSync(session);
    await createPty(session, tab);
  };

  const addTab = (options?: { workingDirectory?: string; title?: string }) => {
    const referenceTab = getActiveTab() ?? state.tabs[0] ?? null;
    const workingDirectory = (options?.workingDirectory ?? referenceTab?.workingDirectory ?? payload.workingDirectory ?? "").trim();
    if (!workingDirectory) return;

    const tab: TTerminalTabState = toTabState({
      id: crypto.randomUUID(),
      title: options?.title ?? workingDirectory,
      workingDirectory,
    });
    state.tabs = [...state.tabs, tab];
    state.activeTabId = tab.id;
    closeContextMenu();
    persistTabs();
    queueMicrotask(() => {
      void mountSession(tab.id);
    });
  };

  const createTerminalFromPicker = () => {
    const workingDirectory = (cwdPicker.selectedPath ?? cwdPicker.path).trim();
    if (!workingDirectory) {
      cwdPicker.error = "Working directory is required.";
      focusCwdPickerInput();
      return;
    }

    cwdPicker.error = null;
    addTab({ workingDirectory, title: workingDirectory });
  };

  const closeTabs = (tabIds: string[]) => {
    const uniqueIds = [...new Set(tabIds)].filter((tabId) => state.tabs.some((tab) => tab.id === tabId));
    if (uniqueIds.length === 0) return;

    const activeBefore = state.activeTabId;
    const activeIndexBefore = state.tabs.findIndex((tab) => tab.id === activeBefore);
    uniqueIds.forEach((tabId) => cleanupSession(tabId));
    const uniqueIdSet = new Set(uniqueIds);
    const nextTabs = state.tabs.filter((tab) => !uniqueIdSet.has(tab.id));
    state.tabs = nextTabs;

    if (!nextTabs.some((tab) => tab.id === activeBefore)) {
      state.activeTabId = nextTabs[Math.min(Math.max(activeIndexBefore, 0), Math.max(nextTabs.length - 1, 0))]?.id ?? null;
    }

    closeContextMenu();
    persistTabs();
    queueMicrotask(() => {
      if (!state.activeTabId) {
        if (!cwdPicker.path.trim()) {
          void loadHomeCwd();
        }
        focusCwdPickerInput();
        return;
      }
      const session = sessions.get(state.activeTabId);
      if (session) scheduleResizeSync(session);
    });
  };

  const closeTab = (tabId: string) => {
    closeTabs([tabId]);
  };

  const restartActiveTab = async () => {
    const tab = getActiveTab();
    if (!tab || tab.status === "creating") return;
    cleanupSession(tab.id);
    updateTab(tab.id, { status: "idle", error: null, ptyID: null, rows: DEFAULT_ROWS, cols: DEFAULT_COLS });
    await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
    await mountSession(tab.id);
  };

  const renameTab = (tabId: string) => {
    const tab = state.tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;

    const nextTitle = args.root.ownerDocument.defaultView?.prompt("Rename terminal tab", tab.title)?.trim();
    if (!nextTitle) {
      closeContextMenu();
      return;
    }

    updateTab(tabId, { title: nextTitle });
    closeContextMenu();
    persistTabs();
  };

  const closeOthers = (tabId: string) => {
    closeTabs(state.tabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id));
  };

  const closeRight = (tabId: string) => {
    const index = state.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return;
    closeTabs(state.tabs.slice(index + 1).map((tab) => tab.id));
  };

  const closeLeft = (tabId: string) => {
    const index = state.tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0) return;
    closeTabs(state.tabs.slice(0, index).map((tab) => tab.id));
  };

  const openTabContextMenu = (event: MouseEvent, tabId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = args.root.getBoundingClientRect();
    state.contextMenu = {
      tabId,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const contextMenuTab = () => state.contextMenu
    ? state.tabs.find((tab) => tab.id === state.contextMenu?.tabId) ?? null
    : null;

  const view = html`
    <div class="${() => `vc-terminal-plugin-widget ${state.tabs.length === 0 ? "has-cwd-picker" : ""}`}" data-hosted-widget-focus-root="true" tabindex="-1" @click="${() => {
      closeContextMenu();
      if (state.tabs.length === 0) {
        focusCwdPickerInput();
        return;
      }
      focusTerminalInputSurface();
    }}">
      <div class="vc-terminal-plugin-tabbar">
        <div class="vc-terminal-plugin-tabs" @click="${(event: Event) => {
          if (event.target !== event.currentTarget) return;
          event.stopPropagation();
          if (state.tabs.length === 0) {
            focusCwdPickerInput();
            return;
          }
          addTab();
        }}">
          ${() => state.tabs.length === 0
            ? html`<div class="vc-terminal-plugin-empty-tabs" @click="${(event: Event) => {
              event.stopPropagation();
              focusCwdPickerInput();
            }}">Choose cwd to start</div>`
            : state.tabs.map((tab: TTerminalTabState) => html`
              <button
                type="button"
                class="${() => `vc-terminal-plugin-tab ${state.activeTabId === tab.id ? "is-active" : ""} ${tab.status === "error" ? "has-error" : ""}`}"
                title="${() => `${tab.title}\n${tab.workingDirectory}\n${tab.status}${tab.error ? `: ${tab.error}` : ""}`}"
                @click="${(event: Event) => {
                  event.stopPropagation();
                  setActiveTab(tab.id);
                }}"
                @contextmenu="${(event: Event) => openTabContextMenu(event as MouseEvent, tab.id)}"
              >
                <span class="vc-terminal-plugin-tab-icon">▸_</span>
                <span class="vc-terminal-plugin-tab-title">${() => tab.title}</span>
                <span class="vc-terminal-plugin-tab-status">${() => tab.status === "connected" ? "" : tab.status}</span>
                <span
                  role="button"
                  tabindex="0"
                  class="vc-terminal-plugin-tab-close"
                  title="Close tab"
                  @click="${(event: Event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}"
                >×</span>
              </button>
            `.key(tab.id))}
        </div>
        <button type="button" class="vc-terminal-plugin-tab-action" title="New terminal tab" disabled="${() => state.tabs.length === 0}" @click="${(event: Event) => {
          event.stopPropagation();
          addTab();
        }}">+</button>
        <button type="button" class="vc-terminal-plugin-tab-action" title="Restart active tab" disabled="${() => getActiveTab()?.status === 'creating' || state.tabs.length === 0}" @click="${(event: Event) => {
          event.stopPropagation();
          void restartActiveTab();
        }}">↻</button>
      </div>

      <div class="vc-terminal-plugin-panes">
        ${() => state.tabs.length === 0
          ? html`
            <div class="vc-terminal-plugin-cwd-picker" @click="${(event: Event) => event.stopPropagation()}">
              <header class="vc-terminal-plugin-cwd-header">
                <div>
                  <h3>Select terminal cwd</h3>
                  <p>Choose the working directory for this terminal session.</p>
                </div>
              </header>

              <div class="vc-terminal-plugin-cwd-toolbar">
                <label class="vc-terminal-plugin-cwd-label" for="${cwdInputId}">Path</label>
                <div class="vc-terminal-plugin-cwd-input-wrap">
                  <input
                    id="${cwdInputId}"
                    class="vc-terminal-plugin-cwd-input"
                    data-terminal-cwd-input="true"
                    .value="${() => cwdPicker.path}"
                    placeholder="/Users/me/project"
                    @input="${onCwdInput}"
                    @keydown="${(event: Event) => {
                      const keyboardEvent = event as KeyboardEvent;
                      if (keyboardEvent.key === "Enter" && !cwdPicker.loading) void loadCwdPath(cwdPicker.path);
                    }}"
                  />
                  <span class="vc-terminal-plugin-cwd-input-chev">⌄</span>
                </div>
                <div class="vc-terminal-plugin-cwd-toolbar-actions">
                  <button type="button" class="vc-terminal-plugin-cwd-icon-button" title="Back" disabled="${() => cwdPicker.loading || cwdPicker.historyIndex <= 0}" @click="${() => loadCwdHistory(cwdPicker.historyIndex - 1)}">←</button>
                  <button type="button" class="vc-terminal-plugin-cwd-icon-button" title="Forward" disabled="${() => cwdPicker.loading || cwdPicker.historyIndex >= cwdPicker.history.length - 1}" @click="${() => loadCwdHistory(cwdPicker.historyIndex + 1)}">→</button>
                  <button type="button" class="vc-terminal-plugin-cwd-icon-button" title="Up" disabled="${() => !cwdPicker.parentPath || cwdPicker.loading}" @click="${() => cwdPicker.parentPath ? void loadCwdPath(cwdPicker.parentPath) : undefined}">↑</button>
                  <button type="button" class="vc-terminal-plugin-cwd-button vc-terminal-plugin-cwd-new-folder" disabled title="Creating folders is not available yet">▣ <span>New Folder</span></button>
                  <button type="button" class="vc-terminal-plugin-cwd-button" disabled="${() => cwdPicker.loading}" @click="${() => void loadCwdPath(cwdPicker.path)}">Go</button>
                </div>
              </div>

              <div class="vc-terminal-plugin-cwd-main">
                <aside class="vc-terminal-plugin-cwd-sidebar" aria-label="Common folders">
                  <div class="vc-terminal-plugin-cwd-sidebar-section">
                    <h4>Home</h4>
                    ${() => quickCwdPaths().map((item) => html`
                      <button
                        type="button"
                        class="${() => `vc-terminal-plugin-cwd-sidebar-item ${cwdPicker.path === item.path ? "is-active" : ""}`}"
                        title="${item.path}"
                        @click="${() => void loadCwdPath(item.path)}"
                      >
                        <span>${item.icon}</span>
                        <span>${item.label}</span>
                      </button>
                    `.key(item.path))}
                  </div>
                  <div class="vc-terminal-plugin-cwd-sidebar-section">
                    <h4>Recent</h4>
                    ${() => recentCwdPaths().length === 0
                      ? html`<div class="vc-terminal-plugin-cwd-sidebar-empty">No recent folders</div>`
                      : recentCwdPaths().map((path) => html`
                        <button
                          type="button"
                          class="${() => `vc-terminal-plugin-cwd-sidebar-item ${cwdPicker.path === path ? "is-active" : ""}`}"
                          title="${path}"
                          @click="${() => void loadCwdPath(path)}"
                        >
                          <span>◷</span>
                          <span>${toPathLabel(path)}</span>
                        </button>
                      `.key(path))}
                  </div>
                </aside>

                <div class="vc-terminal-plugin-cwd-browser" role="listbox" aria-label="Folders">
                  <div class="vc-terminal-plugin-cwd-list-head">
                    <span>Name</span>
                    <span>Modified ↓</span>
                  </div>
                  <div class="vc-terminal-plugin-cwd-list-body">
                    ${() => cwdPicker.loading
                      ? html`<div class="vc-terminal-plugin-cwd-message">Loading folders...</div>`
                      : cwdPicker.children.length === 0
                        ? html`<div class="vc-terminal-plugin-cwd-message">No folders loaded. Type a path or use Home.</div>`
                        : cwdPicker.children.map((child: TTerminalFolderNode) => html`
                          <button
                            type="button"
                            class="${() => `vc-terminal-plugin-cwd-row ${cwdPicker.selectedPath === child.path ? "is-selected" : ""}`}"
                            title="${child.path}"
                            @click="${() => selectCwdPath(child.path)}"
                            @dblclick="${() => void loadCwdPath(child.path)}"
                          >
                            <span class="vc-terminal-plugin-cwd-row-name">
                              <span class="vc-terminal-plugin-cwd-folder-icon">📁</span>
                              <span>${child.name}</span>
                            </span>
                            <span class="vc-terminal-plugin-cwd-row-modified">—</span>
                          </button>
                        `.key(child.path))}
                  </div>
                </div>
              </div>

              ${() => cwdPicker.error ? html`<div class="vc-terminal-plugin-cwd-error">${cwdPicker.error}</div>` : null}

              <footer class="vc-terminal-plugin-cwd-footer">
                <span class="vc-terminal-plugin-cwd-selection">${() => toPathLabel(cwdPicker.selectedPath ?? cwdPicker.path)}</span>
                <button type="button" class="vc-terminal-plugin-cwd-button vc-terminal-plugin-cwd-cancel" @click="${() => {
                  cwdPicker.selectedPath = null;
                  cwdPicker.error = null;
                }}">Cancel</button>
                <button type="button" class="vc-terminal-plugin-cwd-button is-primary" disabled="${() => cwdPicker.loading}" @click="${createTerminalFromPicker}">Start terminal</button>
              </footer>
            </div>
          `
          : state.tabs.map((tab: TTerminalTabState) => html`
            <div
              class="${() => `vc-terminal-plugin-pane ${state.activeTabId === tab.id ? "is-active" : ""}`}"
              data-terminal-pane-id="${tab.id}"
            >
              <div class="vc-terminal-plugin-mount" data-ghostty-terminal-host="true">
                <div class="vc-terminal-plugin-root" data-ghostty-terminal-root="true" tabindex="-1"></div>
              </div>
            </div>
          `.key(tab.id))}
      </div>

      ${() => {
        const activeTab = getActiveTab();
        if (!activeTab) {
          return null;
        }
        if (activeTab.error) {
          return html`<div class="vc-terminal-plugin-error">${activeTab.error}</div>`;
        }
        return html`<div class="vc-terminal-plugin-message">${activeTab.workingDirectory} · ${activeTab.status} · ${activeTab.cols}×${activeTab.rows}</div>`;
      }}

      ${() => {
        const menu = state.contextMenu;
        const tab = contextMenuTab();
        if (!menu || !tab) return null;
        const index = state.tabs.findIndex((candidate) => candidate.id === tab.id);
        const hasOthers = state.tabs.length > 1;
        const hasLeft = index > 0;
        const hasRight = index >= 0 && index < state.tabs.length - 1;
        return html`
          <div
            class="vc-terminal-plugin-context-menu"
            style="${() => `left: ${menu.x}px; top: ${menu.y}px;`}"
            @click="${(event: Event) => event.stopPropagation()}"
            @contextmenu="${(event: Event) => event.preventDefault()}"
          >
            <button type="button" @click="${() => renameTab(tab.id)}">Rename</button>
            <button type="button" @click="${() => closeTab(tab.id)}">Close</button>
            <button type="button" disabled="${() => !hasOthers}" @click="${() => closeOthers(tab.id)}">Close others</button>
            <button type="button" disabled="${() => !hasRight}" @click="${() => closeRight(tab.id)}">Close right</button>
            <button type="button" disabled="${() => !hasLeft}" @click="${() => closeLeft(tab.id)}">Close left</button>
          </div>
        `;
      }}
    </div>
  `;

  args.root.replaceChildren();
  view(args.root);

  queueMicrotask(() => {
    if (state.tabs.length === 0) {
      if (!cwdPicker.path.trim()) {
        void loadHomeCwd();
      }
      focusCwdPickerInput();
      return;
    }

    state.tabs.forEach((tab) => {
      void mountSession(tab.id);
    });
  });

  return () => {
    disposed = true;
    [...sessions.keys()].forEach((tabId) => cleanupSession(tabId));
    args.root.replaceChildren();
  };
}
