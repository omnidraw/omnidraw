import { autocompletion, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
} from "@codemirror/language";
import { vsCodeDark } from "@fsegurai/codemirror-theme-vscode-dark";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightSpecialChars, keymap, lineNumbers } from "@codemirror/view";
import { html, reactive } from "@arrow-js/core";
import { getLanguageExtension } from "../../components/file/getLanguageExtension";
import type {
  TFilesystemNode,
  TFilesystemReadOutput,
  TFilesystemTab,
  TFilesystemWidgetMountArgs,
  TFilesystemWidgetPayload,
  TFilesystemWidgetState,
} from "./typed";
import "./widget.css";

const READ_MAX_BYTES = 512 * 1024;

type TFilesystemTreeRow = {
  node: TFilesystemNode;
  depth: number;
  isOpen: boolean;
  isSelected: boolean;
};

function basename(path: string) {
  const parts = path.replaceAll("\\", "/").split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

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

function replaceNodeChildren(nodes: TFilesystemNode[], targetPath: string, children: TFilesystemNode[]): TFilesystemNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) {
      return { ...node, children };
    }

    if (!node.is_dir || node.children.length === 0) {
      return node;
    }

    return {
      ...node,
      children: replaceNodeChildren(node.children, targetPath, children),
    };
  });
}

function findTab(tabs: TFilesystemTab[], path: string) {
  return tabs.find((tab) => tab.path === path) ?? null;
}

function hasOpenFolder(paths: string[], path: string) {
  return paths.includes(path);
}

function addOpenFolder(paths: string[], path: string) {
  return hasOpenFolder(paths, path) ? paths : [...paths, path];
}

function removeOpenFolder(paths: string[], path: string) {
  return paths.filter((openPath) => openPath !== path);
}

function toPayload(state: TFilesystemWidgetState): TFilesystemWidgetPayload {
  return {
    rootPath: state.rootPath,
    openTabPaths: state.tabs.map((tab) => tab.path),
    activePath: state.activePath,
  };
}

function createEditor(args: {
  parent: HTMLElement;
  onChange: (content: string) => void;
  onSave: () => void;
  shouldIgnoreChange: () => boolean;
}) {
  const languageCompartment = new Compartment();
  const editorKeymap = [
    {
      key: "Mod-s",
      preventDefault: true,
      run: () => {
        args.onSave();
        return true;
      },
    },
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
  ] as unknown as Parameters<typeof keymap.of>[0];

  const state = EditorState.create({
    doc: "",
    extensions: [
      lineNumbers(),
      highlightSpecialChars(),
      drawSelection(),
      history(),
      foldGutter(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      highlightSelectionMatches(),
      search(),
      keymap.of(editorKeymap),
      vsCodeDark,
      languageCompartment.of([]),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || args.shouldIgnoreChange()) return;
        args.onChange(update.state.doc.toString());
      }),
      EditorView.theme({
        "&": {
          height: "100%",
          backgroundColor: "var(--vc-filesystem-editor-bg)",
          color: "var(--vc-filesystem-fg)",
        },
        "&.cm-focused": { outline: "none" },
        ".cm-scroller": { height: "100%", overflow: "auto" },
        ".cm-gutters": {
          backgroundColor: "var(--vc-filesystem-editor-gutter-bg)",
          color: "var(--vc-filesystem-muted-fg)",
          border: "none",
          borderRight: "1px solid var(--vc-filesystem-border)",
        },
        ".cm-activeLine": { backgroundColor: "var(--vc-filesystem-editor-line-highlight)" },
        ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--vc-filesystem-editor-selection)" },
        ".cm-cursor": { borderLeftColor: "var(--vc-filesystem-editor-cursor)" },
      }),
    ],
  });

  const view = new EditorView({ state, parent: args.parent });

  return {
    view,
    languageCompartment,
  };
}

export function mountFilesystemWidget(args: TFilesystemWidgetMountArgs) {
  const payload = args.element.data.type === "widget"
    ? args.element.data.payload as TFilesystemWidgetPayload
    : {};
  const rootPath = payload.rootPath ?? "";
  const state = reactive<TFilesystemWidgetState>({
    rootPath,
    rootChildren: [],
    openFolderPaths: rootPath ? [rootPath] : [],
    selectedPath: null,
    activePath: null,
    tabs: [],
    loadingTree: false,
    error: rootPath ? null : "Choose a root path to load files.",
  });

  let disposed = false;
  let restoringPersistedTabs = true;
  let syncingEditor = false;
  let editor: ReturnType<typeof createEditor> | null = null;

  const persist = () => {
    if (restoringPersistedTabs) return;
    args.onPersist?.(toPayload(state));
  };

  const syncEditorFromActiveTab = async () => {
    if (!editor) return;
    const activeTab = state.activePath ? findTab(state.tabs, state.activePath) : null;
    const nextContent = activeTab?.content ?? "";
    const currentContent = editor.view.state.doc.toString();

    if (currentContent !== nextContent) {
      syncingEditor = true;
      try {
        editor.view.dispatch({
          changes: {
            from: 0,
            to: currentContent.length,
            insert: nextContent,
          },
        });
      } finally {
        syncingEditor = false;
      }
    }

    const languageExtension = activeTab ? await getLanguageExtension(activeTab.path) : null;
    if (!disposed && editor) {
      editor.view.dispatch({
        effects: editor.languageCompartment.reconfigure(languageExtension ? [languageExtension] : []),
      });
    }
  };

  const loadFolder = async (path: string) => {
    const [error, result] = await args.apiService.api.filesystem.files({
      query: { path, max_depth: 1 },
    });

    if (disposed) return null;
    if (error || !result || isApiError(result)) {
      state.error = getErrorMessage(error, result, "Failed to load folder");
      return null;
    }

    return result.children;
  };

  const loadRoot = async () => {
    if (!state.rootPath) return;
    state.loadingTree = true;
    state.error = null;
    const children = await loadFolder(state.rootPath);
    if (disposed) return;
    if (children) {
      state.rootChildren = children;
      state.openFolderPaths = addOpenFolder(state.openFolderPaths, state.rootPath);
    }
    state.loadingTree = false;
  };

  const toggleFolder = async (node: TFilesystemNode) => {
    if (node.is_unreadable) return;

    const isOpen = hasOpenFolder(state.openFolderPaths, node.path);
    if (isOpen) {
      state.openFolderPaths = removeOpenFolder(state.openFolderPaths, node.path);
      return;
    }

    state.openFolderPaths = addOpenFolder(state.openFolderPaths, node.path);

    if (node.children.length > 0) return;
    const children = await loadFolder(node.path);
    if (disposed || !children) return;
    state.rootChildren = replaceNodeChildren(state.rootChildren, node.path, children);
  };

  const activateTab = async (path: string) => {
    state.activePath = path;
    state.selectedPath = path;
    persist();
    await syncEditorFromActiveTab();
  };

  const updateTab = (path: string, patch: Partial<TFilesystemTab>) => {
    state.tabs = state.tabs.map((tab) => tab.path === path ? { ...tab, ...patch } : tab);
  };

  const saveActiveTab = async () => {
    const activePath = state.activePath;
    if (!activePath || !editor) return;

    const activeTab = findTab(state.tabs, activePath);
    if (!activeTab || activeTab.loading || activeTab.truncated) return;

    const content = editor.view.state.doc.toString();
    updateTab(activePath, { saving: true, error: null, content });

    const [error, result] = await args.apiService.api.filesystem.write({
      query: { path: activePath, content },
    });

    if (disposed) return;

    if (error || !result || isApiError(result)) {
      updateTab(activePath, {
        saving: false,
        dirty: true,
        error: getErrorMessage(error, result, "Failed to save file"),
      });
      return;
    }

    updateTab(activePath, {
      saving: false,
      dirty: false,
      content,
      error: null,
    });
  };

  const loadFileIntoTab = async (path: string) => {
    updateTab(path, { loading: true, saving: false, dirty: false, error: null, content: "Loading..." });
    await syncEditorFromActiveTab();

    const [error, result] = await args.apiService.api.filesystem.read({
      query: { path, content: "text", maxBytes: READ_MAX_BYTES },
    });

    if (disposed) return;

    if (error || !result || isApiError(result)) {
      updateTab(path, {
        loading: false,
        saving: false,
        dirty: false,
        error: getErrorMessage(error, result, "Failed to read file"),
        content: "",
      });
      await syncEditorFromActiveTab();
      return;
    }

    const readResult = result as TFilesystemReadOutput;
    if (readResult.kind !== "text") {
      updateTab(path, {
        loading: false,
        saving: false,
        dirty: false,
        error: "Binary preview is not available in the first IDE widget version.",
        content: "",
        truncated: false,
      });
      await syncEditorFromActiveTab();
      return;
    }

    updateTab(path, {
      loading: false,
      saving: false,
      dirty: false,
      error: null,
      content: readResult.content,
      truncated: readResult.truncated,
    });
    await syncEditorFromActiveTab();
  };

  const openFile = async (path: string) => {
    state.selectedPath = path;
    const existing = findTab(state.tabs, path);
    if (!existing) {
      state.tabs = [
        ...state.tabs,
        {
          path,
          name: basename(path),
          content: "",
          loading: true,
          saving: false,
          dirty: false,
          error: null,
          truncated: false,
          readonly: false,
        },
      ];
    }

    await activateTab(path);
    if (!existing) {
      persist();
      await loadFileIntoTab(path);
    }
  };

  const closeTab = async (path: string) => {
    const index = state.tabs.findIndex((tab) => tab.path === path);
    if (index < 0) return;

    const wasActive = state.activePath === path;
    const nextTabs = state.tabs.filter((tab) => tab.path !== path);
    state.tabs = nextTabs;
    if (wasActive) {
      state.activePath = nextTabs[Math.max(0, index - 1)]?.path ?? nextTabs[0]?.path ?? null;
    }
    persist();
    await syncEditorFromActiveTab();
  };

  const refreshRoot = () => {
    void loadRoot();
  };

  const onNodeClick = (node: TFilesystemNode) => {
    state.selectedPath = node.path;
    if (node.is_dir) {
      void toggleFolder(node);
    }
  };

  const onNodeDoubleClick = (node: TFilesystemNode) => {
    if (node.is_dir || node.is_unreadable) return;
    void openFile(node.path);
  };

  const flattenTreeNodes = (nodes: TFilesystemNode[], depth: number): TFilesystemTreeRow[] => {
    const rows: TFilesystemTreeRow[] = [];

    for (const node of nodes) {
      const isOpen = node.is_dir && hasOpenFolder(state.openFolderPaths, node.path);
      const isSelected = state.selectedPath === node.path;
      rows.push({ node, depth, isOpen, isSelected });

      if (isOpen && node.children.length > 0) {
        rows.push(...flattenTreeNodes(node.children, depth + 1));
      }
    }

    return rows;
  };

  const view = html`
    <div class="vc-filesystem-widget" data-hosted-widget-focus-root="true" tabindex="-1">
      <aside class="vc-filesystem-sidebar">
        <div class="vc-filesystem-rootbar">
          <div class="vc-filesystem-root" title="${() => state.rootPath}">${() => state.rootPath || "No root selected"}</div>
          <button type="button" class="vc-filesystem-icon-button" title="Refresh" @click="${refreshRoot}">↻</button>
        </div>
        <div class="vc-filesystem-tree">
          ${() => state.loadingTree
            ? html`<div class="vc-filesystem-message">Loading files...</div>`
            : flattenTreeNodes(state.rootChildren, 0).map((row) => html`
              <button
                type="button"
                class="${() => [
                  "vc-filesystem-tree-row",
                  row.isSelected ? "is-selected" : "",
                  row.node.is_unreadable ? "is-disabled" : "",
                ].filter(Boolean).join(" ")}"
                style="${() => `padding-left: ${8 + row.depth * 14}px`}"
                title="${row.node.path}"
                @click="${() => onNodeClick(row.node)}"
                @dblclick="${() => onNodeDoubleClick(row.node)}"
              >
                <span class="vc-filesystem-tree-twist">${row.node.is_dir ? (row.isOpen ? "▾" : "▸") : ""}</span>
                <span class="vc-filesystem-tree-icon">${row.node.is_dir ? "📁" : "📄"}</span>
                <span class="vc-filesystem-tree-name">${row.node.name}</span>
              </button>
            `)}
        </div>
      </aside>

      <main class="vc-filesystem-main">
        <div class="vc-filesystem-tabs">
          ${() => state.tabs.length === 0
            ? html`<div class="vc-filesystem-tab-placeholder">No file open</div>`
            : state.tabs.map((tab) => html`
              <button
                type="button"
                class="${() => `vc-filesystem-tab ${state.activePath === tab.path ? "is-active" : ""}`}"
                title="${tab.path}"
                @click="${() => void activateTab(tab.path)}"
              >
                <span>${tab.name}</span>
                ${() => tab.loading ? html`<span class="vc-filesystem-tab-state">•</span>` : null}
                ${() => tab.saving ? html`<span class="vc-filesystem-tab-state">saving</span>` : null}
                ${() => tab.dirty && !tab.saving ? html`<span class="vc-filesystem-tab-state">●</span>` : null}
                <span
                  role="button"
                  tabindex="0"
                  class="vc-filesystem-tab-close"
                  title="Close"
                  @click="${(event: Event) => {
                    event.stopPropagation();
                    void closeTab(tab.path);
                  }}"
                >×</span>
              </button>
            `.key(tab.path))}
        </div>

        <div class="vc-filesystem-editor-shell">
          <div class="vc-filesystem-editor-host" data-filesystem-editor-host="true"></div>
          ${() => {
            const activeTab = state.activePath ? findTab(state.tabs, state.activePath) : null;
            if (!activeTab) {
              return html`<div class="vc-filesystem-empty-editor">Open a file from the tree. The editor stays mounted.</div>`;
            }
            if (activeTab.error) {
              return html`<div class="vc-filesystem-editor-banner is-error">${activeTab.error}</div>`;
            }
            if (activeTab.truncated) {
              return html`<div class="vc-filesystem-editor-banner">File truncated to ${READ_MAX_BYTES} bytes · read-only</div>`;
            }
            return null;
          }}
        </div>

        <div class="vc-filesystem-statusbar">
          <span>${() => {
            const activeTab = state.activePath ? findTab(state.tabs, state.activePath) : null;
            if (activeTab?.saving) return `Saving ${activeTab.path}`;
            if (activeTab?.dirty) return `${activeTab.path} - unsaved`;
            return state.error ?? (state.activePath ? state.activePath : "Ready");
          }}</span>
          <span>${() => state.tabs.length} tab${() => state.tabs.length === 1 ? "" : "s"}</span>
        </div>
      </main>
    </div>
  `;

  args.root.replaceChildren();
  view(args.root);

  const editorHost = args.root.querySelector<HTMLElement>("[data-filesystem-editor-host]");
  if (editorHost) {
    editor = createEditor({
      parent: editorHost,
      onChange: (content) => {
        const activePath = state.activePath;
        if (!activePath) return;
        updateTab(activePath, {
          content,
          dirty: true,
          error: null,
        });
      },
      onSave: () => {
        void saveActiveTab();
      },
      shouldIgnoreChange: () => syncingEditor,
    });
  }

  void (async () => {
    await loadRoot();
    const openTabPaths = payload.openTabPaths ?? [];
    for (const path of openTabPaths) {
      if (disposed) return;
      await openFile(path);
    }

    if (payload.activePath && findTab(state.tabs, payload.activePath)) {
      await activateTab(payload.activePath);
    } else {
      await syncEditorFromActiveTab();
    }
    restoringPersistedTabs = false;
  })();

  return () => {
    disposed = true;
    editor?.view.destroy();
    editor = null;
    args.root.replaceChildren();
  };
}
