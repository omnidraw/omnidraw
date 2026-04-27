import { html, reactive } from "@arrow-js/core";
import { init as initGhostty, Terminal as GhosttyTerminal } from "ghostty-web";
import type {
  TPtyImageFormat,
  TPtyLike,
  TTerminalConnectionStatus,
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
  isAlternateScreen?: () => boolean;
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

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
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

export function mountTerminalWidget(args: TTerminalWidgetMountArgs) {
  const payload = args.element.data.type === "widget"
    ? args.element.data.payload as TTerminalWidgetPayload
    : {};
  const workingDirectory = payload.workingDirectory ?? "";
  const initialTitle = payload.title ?? (workingDirectory ? basename(workingDirectory) : "Terminal");
  const state = reactive({
    title: initialTitle,
    workingDirectory,
    status: "idle" as TTerminalConnectionStatus,
    error: null as string | null,
    rows: DEFAULT_ROWS,
    cols: DEFAULT_COLS,
    ptyID: null as string | null,
  });

  let disposed = false;
  let currentPty: TPtyLike | null = null;
  let term: TGhosttyTerminalInstance | null = null;
  let socket: WebSocket | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let sizePushTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let cursor = 0;
  let pendingInputBuffer = "";
  let closingSocketIntentionally = false;
  let cleanupPasteListeners: (() => void) | null = null;

  const setStatus = (status: TTerminalConnectionStatus, error: string | null = null) => {
    state.status = status;
    state.error = error;
  };

  const clearTimers = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    if (sizePushTimer) clearTimeout(sizePushTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    resizeTimer = null;
    sizePushTimer = null;
    reconnectTimer = null;
  };

  const closeSocket = () => {
    if (!socket) return;
    closingSocketIntentionally = true;
    socket.close(1000, "Terminal widget closed");
    socket = null;
  };

  const focusTerminalInputSurface = () => {
    const textarea = args.root.querySelector<HTMLElement>("[data-ghostty-terminal-textarea='true'], textarea");
    if (textarea) {
      textarea.focus({ preventScroll: true });
      return;
    }

    const terminalRoot = args.root.querySelector<HTMLElement>("[data-ghostty-terminal-root='true']");
    terminalRoot?.focus({ preventScroll: true });
  };

  const flushPendingInput = () => {
    if (!pendingInputBuffer) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(pendingInputBuffer);
    pendingInputBuffer = "";
  };

  const sendTerminalInput = (data: string) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      pendingInputBuffer += data;
      return;
    }

    socket.send(data);
  };

  const writeTerminalOutput = (data: string, byteLength: number) => {
    term?.write(data);
    cursor += byteLength;
  };

  const handleSocketMessage = (event: MessageEvent) => {
    if (disposed || !term) return;

    if (event.data instanceof ArrayBuffer) {
      writeTerminalOutput(new TextDecoder().decode(event.data), event.data.byteLength);
      return;
    }

    if (event.data instanceof Blob) {
      void asArrayBufferFromBlob(event.data).then((arrayBuffer) => {
        if (disposed || !term) return;
        writeTerminalOutput(new TextDecoder().decode(arrayBuffer), arrayBuffer.byteLength);
      });
      return;
    }

    if (typeof event.data === "string") {
      writeTerminalOutput(event.data, new TextEncoder().encode(event.data).byteLength);
    }
  };

  const getReconnectDelay = () => {
    const unclampedDelay = RECONNECT_BASE_DELAY_MS * (2 ** Math.max(0, reconnectAttempt));
    const baseDelay = Math.min(RECONNECT_MAX_DELAY_MS, unclampedDelay);
    const jitterWindow = Math.floor(baseDelay * RECONNECT_JITTER_RATIO);
    const jitter = jitterWindow > 0 ? Math.floor(Math.random() * (jitterWindow + 1)) : 0;
    reconnectAttempt += 1;
    return Math.max(0, baseDelay + jitter);
  };

  const connectPtySocket = (ptyID: string) => {
    if (disposed || !workingDirectory) return;
    closeSocket();
    closingSocketIntentionally = false;
    setStatus("connecting");

    const nextSocket = new WebSocket(getPtyWebsocketUrl({ ptyID, workingDirectory }));
    nextSocket.binaryType = "arraybuffer";
    socket = nextSocket;

    nextSocket.onopen = () => {
      if (disposed || socket !== nextSocket) return;
      reconnectAttempt = 0;
      setStatus("connected");
      flushPendingInput();
      focusTerminalInputSurface();
    };

    nextSocket.onmessage = (event) => {
      if (socket !== nextSocket) return;
      handleSocketMessage(event);
    };

    nextSocket.onerror = () => {
      if (disposed || socket !== nextSocket) return;
      setStatus("error", "Terminal stream failed.");
    };

    nextSocket.onclose = (event) => {
      if (socket && socket !== nextSocket) return;
      if (socket === nextSocket) {
        socket = null;
      }
      if (disposed || closingSocketIntentionally) return;

      if (event.code === 1000) {
        setStatus("closed", event.reason || "Terminal session closed.");
        return;
      }

      const delayMs = getReconnectDelay();
      setStatus("connecting", `Terminal disconnected. Reconnecting in ${Math.ceil(delayMs / 1000)}s…`);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (disposed || !currentPty) return;
        connectPtySocket(currentPty.id);
      }, delayMs);
    };
  };

  const pushSizeToBackend = (rows: number, cols: number) => {
    if (!currentPty || disposed) return;
    if (sizePushTimer) clearTimeout(sizePushTimer);

    const ptyID = currentPty.id;
    sizePushTimer = setTimeout(async () => {
      if (disposed || !currentPty || currentPty.id !== ptyID) return;
      await args.apiService.api.pty.update({
        workingDirectory,
        path: { ptyID },
        body: { size: { rows, cols } },
      });
    }, 120);
  };

  const syncFrontendSize = () => {
    const host = args.root.querySelector<HTMLElement>("[data-ghostty-terminal-host='true']");
    if (!host || !term || !hasUsableHostSize(host)) return;

    const next = calculateTerminalSize(host, term);
    if (next.cols === term.cols && next.rows === term.rows) return;
    term.resize(next.cols, next.rows);
  };

  const scheduleResizeSync = () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      syncFrontendSize();
    }, 120);
  };

  const createPty = async () => {
    if (disposed || !workingDirectory) return;
    setStatus("creating");

    const host = args.root.querySelector<HTMLElement>("[data-ghostty-terminal-host='true']");
    const measuredSize = host && hasUsableHostSize(host)
      ? calculateTerminalSize(host, term)
      : { rows: DEFAULT_ROWS, cols: DEFAULT_COLS };
    state.rows = measuredSize.rows;
    state.cols = measuredSize.cols;

    const [error, created] = await args.apiService.api.pty.create({
      workingDirectory,
      body: {
        title: initialTitle,
        size: measuredSize,
      },
    });

    if (disposed) {
      if (created) {
        void args.apiService.api.pty.remove({
          workingDirectory,
          path: { ptyID: created.id },
        });
      }
      return;
    }
    if (error || !created) {
      setStatus("error", getErrorMessage(error, "Failed to create terminal session"));
      return;
    }

    currentPty = created as TPtyLike;
    state.ptyID = currentPty.id;
    state.title = currentPty.title || initialTitle;
    cursor = 0;

    if (term) {
      term.resize(measuredSize.cols, measuredSize.rows);
    }

    connectPtySocket(currentPty.id);
  };

  const removeCurrentPty = async () => {
    const pty = currentPty;
    currentPty = null;
    state.ptyID = null;
    if (!pty) return;

    const [error] = await args.apiService.api.pty.remove({
      workingDirectory,
      path: { ptyID: pty.id },
    });

    if (error && !disposed) {
      state.error = getErrorMessage(error, "Failed to remove terminal session");
    }
  };

  const restartPty = async () => {
    if (disposed || state.status === "creating") return;
    closeSocket();
    clearTimers();
    term?.clear();
    await removeCurrentPty();
    if (disposed) return;
    pendingInputBuffer = "";
    reconnectAttempt = 0;
    cursor = 0;
    await createPty();
  };

  const uploadClipboardImage = async (file: File | Blob) => {
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

  const pasteText = (text: string) => {
    if (typeof term?.paste === "function") {
      term.paste(text);
      return;
    }

    sendTerminalInput(text);
  };

  const setupPasteListeners = (host: HTMLDivElement, terminalRoot: HTMLDivElement) => {
    const handlePaste = (event: Event) => {
      const clipboardEvent = asClipboardEventLike(event);
      if (!term || clipboardEvent.defaultPrevented) return;

      const text = getClipboardText(clipboardEvent.clipboardData);
      if (text) {
        clipboardEvent.preventDefault();
        clipboardEvent.stopPropagation();
        pasteText(text);
        return;
      }

      const imageFile = getFirstClipboardImageFile(clipboardEvent.clipboardData);
      if (imageFile) {
        clipboardEvent.preventDefault();
        clipboardEvent.stopPropagation();
        void uploadClipboardImage(imageFile)
          .then((path) => {
            if (disposed || !term) return;
            pasteText(toShellEscapedPathText(path));
          })
          .catch(() => {
            sendTerminalInput("\x16");
          });
      }
    };

    const pasteTargets = [host, terminalRoot, term?.element, term?.textarea].filter((value): value is HTMLDivElement | HTMLTextAreaElement => Boolean(value));
    pasteTargets.forEach((target) => target.addEventListener("paste", handlePaste, true));
    cleanupPasteListeners = () => {
      pasteTargets.forEach((target) => target.removeEventListener("paste", handlePaste, true));
    };
  };

  const setupWheelForwarding = () => {
    term?.attachCustomWheelEventHandler?.((event) => {
      if (!term) return false;
      const wasmTerm = term.wasmTerm;
      const mouseTracking = wasmTerm?.hasMouseTracking?.() ?? false;
      const sgrMouseMode = wasmTerm?.getMode?.(TERMINAL_MOUSE_SGR_MODE, false) ?? false;
      if (!mouseTracking || !sgrMouseMode) return false;

      const sequence = buildWheelMouseSequence(term, event);
      if (!sequence) return false;

      if (typeof term.input === "function") {
        term.input(sequence, true);
      } else {
        sendTerminalInput(sequence);
      }
      return true;
    });
  };

  const mountGhostty = async () => {
    const host = args.root.querySelector<HTMLDivElement>("[data-ghostty-terminal-host='true']");
    const terminalRoot = args.root.querySelector<HTMLDivElement>("[data-ghostty-terminal-root='true']");
    if (!host || !terminalRoot) return;

    await ensureGhosttyInit();
    if (disposed) return;

    const GhosttyTerminalCtor = GhosttyTerminal as unknown as new (options: TGhosttyTerminalOptions) => TGhosttyTerminalInstance;
    term = new GhosttyTerminalCtor({
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "JetBrains Mono Variable, ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      scrollback: 10000,
      theme: getGhosttyTheme(host),
    });

    terminalRoot.style.caretColor = "transparent";
    terminalRoot.style.outline = "none";
    term.open(terminalRoot);

    if (term.element) {
      term.element.style.caretColor = "transparent";
      term.element.style.outline = "none";
    }

    if (term.textarea) {
      term.textarea.style.caretColor = "transparent";
      term.textarea.dataset.ghosttyTerminalTextarea = "true";
    }

    term.onData((data) => {
      sendTerminalInput(data);
    });

    term.onResize((next) => {
      state.cols = next.cols;
      state.rows = next.rows;
      pushSizeToBackend(next.rows, next.cols);
    });

    setupPasteListeners(host, terminalRoot);
    setupWheelForwarding();

    resizeObserver = new ResizeObserver(scheduleResizeSync);
    resizeObserver.observe(host);
    scheduleResizeSync();
    await createPty();
  };

  const view = html`
    <div class="vc-terminal-plugin-widget" data-hosted-widget-focus-root="true" tabindex="-1" @click="${focusTerminalInputSurface}">
      <div class="vc-terminal-plugin-toolbar">
        <div class="vc-terminal-plugin-title" title="${() => state.title}">${() => state.title}</div>
        <div class="vc-terminal-plugin-cwd" title="${() => state.workingDirectory}">${() => state.workingDirectory || "No cwd"}</div>
        <div class="vc-terminal-plugin-status-text">${() => state.status}${() => state.ptyID ? ` · ${state.cols}×${state.rows}` : ""}</div>
        <button type="button" class="vc-terminal-plugin-button" title="Restart PTY" disabled="${() => state.status === 'creating'}" @click="${(event: Event) => {
          event.stopPropagation();
          void restartPty();
        }}">Restart</button>
      </div>

      <div class="vc-terminal-plugin-mount" data-ghostty-terminal-host="true">
        <div class="vc-terminal-plugin-root" data-ghostty-terminal-root="true" tabindex="-1"></div>
      </div>

      ${() => state.error
        ? html`<div class="vc-terminal-plugin-error">${state.error}</div>`
        : state.status === "creating" || state.status === "connecting"
          ? html`<div class="vc-terminal-plugin-message">${state.status === "creating" ? "Creating terminal..." : "Connecting terminal..."}</div>`
          : null}
    </div>
  `;

  args.root.replaceChildren();
  view(args.root);

  if (!workingDirectory) {
    setStatus("error", "Terminal working directory is missing.");
  } else {
    void mountGhostty().catch((error) => {
      if (disposed) return;
      setStatus("error", getErrorMessage(error, "Failed to mount terminal"));
    });
  }

  return () => {
    disposed = true;
    closeSocket();
    clearTimers();
    resizeObserver?.disconnect();
    resizeObserver = null;
    cleanupPasteListeners?.();
    cleanupPasteListeners = null;
    term?.attachCustomWheelEventHandler?.(undefined);
    term?.dispose();
    term = null;
    void removeCurrentPty();
    args.root.replaceChildren();
  };
}
