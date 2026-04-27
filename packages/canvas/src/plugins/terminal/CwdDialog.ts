import { html, reactive } from "@arrow-js/core";
import type {
  TTerminalCwdDialogArgs,
  TTerminalCwdDialogResult,
  TTerminalFolderNode,
} from "./typed";
import "./widget.css";

function isApiError(value: unknown): value is { type: string; message: string } {
  return value !== null
    && typeof value === "object"
    && "type" in value
    && "message" in value
    && typeof (value as { message?: unknown }).message === "string";
}

function getErrorMessage(error: unknown, result: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }

  if (isApiError(result)) {
    return result.message;
  }

  return fallback;
}

export function showTerminalCwdDialog(args: TTerminalCwdDialogArgs): Promise<TTerminalCwdDialogResult> {
  const document = args.container.ownerDocument;
  const mount = document.createElement("div");
  mount.className = "vc-terminal-plugin-dialog-mount";

  const state = reactive({
    path: "",
    parentPath: null as string | null,
    children: [] as TTerminalFolderNode[],
    loading: false,
    error: null as string | null,
  });

  args.container.appendChild(mount);

  return new Promise((resolve) => {
    let settled = false;

    const settle = (path: string | null) => {
      if (settled) return;
      settled = true;
      mount.replaceChildren();
      mount.remove();
      resolve(path);
    };

    const loadPath = async (path: string) => {
      const nextPath = path.trim();
      if (!nextPath) {
        state.error = "Working directory is required.";
        return;
      }

      state.loading = true;
      state.error = null;

      const [error, result] = await args.apiService.api.filesystem.list({
        query: { path: nextPath, omitFiles: true },
      });

      if (settled) return;
      if (error || !result || isApiError(result)) {
        state.loading = false;
        state.error = getErrorMessage(error, result, "Failed to list folders");
        return;
      }

      state.path = result.current;
      state.parentPath = result.parent;
      state.children = result.children.map((child) => ({
        name: child.name,
        path: child.path,
        is_dir: child.isDir,
        children: [],
      })).filter((child) => child.is_dir);
      state.loading = false;
    };

    const loadHome = async () => {
      state.loading = true;
      state.error = null;
      const [error, result] = await args.apiService.api.filesystem.home();
      if (settled) return;
      if (error || !result || isApiError(result)) {
        state.loading = false;
        state.error = getErrorMessage(error, result, "Failed to resolve home directory");
        return;
      }
      await loadPath(result.path);
    };

    const confirm = () => {
      const path = state.path.trim();
      if (!path) {
        state.error = "Working directory is required.";
        return;
      }
      settle(path);
    };

    const onInput = (event: InputEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      state.path = target.value;
    };

    const view = html`
      <div class="vc-terminal-plugin-dialog-backdrop" @click="${() => settle(null)}">
        <section class="vc-terminal-plugin-dialog" role="dialog" aria-modal="true" @click="${(event: Event) => event.stopPropagation()}">
          <header class="vc-terminal-plugin-dialog-header">
            <div>
              <h2>Select terminal cwd</h2>
              <p>Choose the working directory for the new terminal session.</p>
            </div>
            <button type="button" class="vc-terminal-plugin-dialog-close" @click="${() => settle(null)}">×</button>
          </header>

          <div class="vc-terminal-plugin-dialog-path-row">
            <input
              class="vc-terminal-plugin-dialog-input"
              .value="${() => state.path}"
              placeholder="/Users/me/project"
              @input="${onInput}"
              @keydown="${(event: Event) => {
                const keyboardEvent = event as KeyboardEvent;
                if (keyboardEvent.key === "Enter") confirm();
                if (keyboardEvent.key === "Escape") settle(null);
              }}"
            />
            <button type="button" class="vc-terminal-plugin-dialog-button" @click="${() => void loadPath(state.path)}">Load</button>
          </div>

          <div class="vc-terminal-plugin-dialog-actions">
            <button type="button" class="vc-terminal-plugin-dialog-button" @click="${() => void loadHome()}">Home</button>
            <button
              type="button"
              class="vc-terminal-plugin-dialog-button"
              disabled="${() => state.parentPath ? false : true}"
              @click="${() => state.parentPath ? void loadPath(state.parentPath) : undefined}"
            >Up</button>
          </div>

          <div class="vc-terminal-plugin-dialog-browser">
            ${() => state.loading
              ? html`<div class="vc-terminal-plugin-dialog-message">Loading folders...</div>`
              : state.children.length === 0
                ? html`<div class="vc-terminal-plugin-dialog-message">No folders loaded. Type a path or use Home.</div>`
                : state.children.map((child: TTerminalFolderNode) => html`
                  <button
                    type="button"
                    class="vc-terminal-plugin-dialog-folder"
                    title="${child.path}"
                    @click="${() => void loadPath(child.path)}"
                  >
                    <span>📁</span>
                    <span>${child.name}</span>
                  </button>
                `.key(child.path))}
          </div>

          ${() => state.error ? html`<div class="vc-terminal-plugin-dialog-error">${state.error}</div>` : null}

          <footer class="vc-terminal-plugin-dialog-footer">
            <button type="button" class="vc-terminal-plugin-dialog-button" @click="${() => settle(null)}">Cancel</button>
            <button type="button" class="vc-terminal-plugin-dialog-button is-primary" @click="${confirm}">Create terminal</button>
          </footer>
        </section>
      </div>
    `;

    view(mount);
    void loadHome();
  });
}
