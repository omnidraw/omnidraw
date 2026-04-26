import { html, reactive } from "@arrow-js/core";
import type {
  TFilesystemNode,
  TFilesystemRootDialogArgs,
  TFilesystemRootDialogResult,
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

export function showFilesystemRootDialog(args: TFilesystemRootDialogArgs): Promise<TFilesystemRootDialogResult> {
  const document = args.container.ownerDocument;
  const mount = document.createElement("div");
  mount.className = "vc-filesystem-dialog-mount";

  const state = reactive({
    path: "",
    parentPath: null as string | null,
    children: [] as TFilesystemNode[],
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
      state.loading = true;
      state.error = null;

      const [error, result] = await args.apiService.api.filesystem.list({
        query: { path, omitFiles: true },
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
        state.error = "Root path is required.";
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
      <div class="vc-filesystem-dialog-backdrop" @click="${() => settle(null)}">
        <section class="vc-filesystem-dialog" role="dialog" aria-modal="true" @click="${(event: Event) => event.stopPropagation()}">
          <header class="vc-filesystem-dialog-header">
            <div>
              <h2>Select filesystem root</h2>
              <p>Choose a cwd/root path before creating the IDE widget.</p>
            </div>
            <button type="button" class="vc-filesystem-dialog-close" @click="${() => settle(null)}">×</button>
          </header>

          <div class="vc-filesystem-dialog-path-row">
            <input
              class="vc-filesystem-dialog-input"
              .value="${() => state.path}"
              placeholder="/Users/me/project"
              @input="${onInput}"
              @keydown="${(event: Event) => {
                const keyboardEvent = event as KeyboardEvent;
                if (keyboardEvent.key === "Enter") confirm();
                if (keyboardEvent.key === "Escape") settle(null);
              }}"
            />
            <button type="button" class="vc-filesystem-dialog-button" @click="${() => void loadPath(state.path)}">Load</button>
          </div>

          <div class="vc-filesystem-dialog-actions">
            <button type="button" class="vc-filesystem-dialog-button" @click="${() => void loadHome()}">Home</button>
            <button
              type="button"
              class="vc-filesystem-dialog-button"
              disabled="${() => state.parentPath ? false : true}"
              @click="${() => state.parentPath ? void loadPath(state.parentPath) : undefined}"
            >Up</button>
          </div>

          <div class="vc-filesystem-dialog-browser">
            ${() => state.loading
              ? html`<div class="vc-filesystem-message">Loading folders...</div>`
              : state.children.length === 0
                ? html`<div class="vc-filesystem-message">No folders loaded. Type a path or use Home.</div>`
                : state.children.map((child: TFilesystemNode) => html`
                  <button
                    type="button"
                    class="vc-filesystem-dialog-folder"
                    title="${child.path}"
                    @click="${() => void loadPath(child.path)}"
                  >
                    <span>📁</span>
                    <span>${child.name}</span>
                  </button>
                `.key(child.path))}
          </div>

          ${() => state.error ? html`<div class="vc-filesystem-dialog-error">${state.error}</div>` : null}

          <footer class="vc-filesystem-dialog-footer">
            <button type="button" class="vc-filesystem-dialog-button" @click="${() => settle(null)}">Cancel</button>
            <button type="button" class="vc-filesystem-dialog-button is-primary" @click="${confirm}">Create widget</button>
          </footer>
        </section>
      </div>
    `;

    view(mount);
    void loadHome();
  });
}
