import { html, reactive } from "@arrow-js/core";
import HandIconUrl from "lucide-static/icons/hand.svg";
import "./widget.css";

type TFilesystemEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  content?: string;
};

const entries: TFilesystemEntry[] = [
  {
    name: "src",
    path: "/src",
    kind: "directory",
  },
  {
    name: "README.md",
    path: "/README.md",
    kind: "file",
    content: "# Filesystem widget\n\nThis is the minimal bundled Arrow sandbox widget.",
  },
  {
    name: "package.json",
    path: "/package.json",
    kind: "file",
    content: '{\n  "name": "demo"\n}',
  },
];

const childEntriesByPath: Record<string, TFilesystemEntry[]> = {
  "/": entries,
  "/src": [
    {
      name: "main.ts",
      path: "/src/main.ts",
      kind: "file",
      content: 'console.log("hello from the filesystem widget")',
    },
    {
      name: "widget.css",
      path: "/src/widget.css",
      kind: "file",
      content: ".fs-widget { height: 100%; }",
    },
  ],
};

const state = reactive({
  path: "/",
  selectedPath: "",
  preview: "",
});

function openDirectory(path: string) {
  state.path = path;
  state.selectedPath = "";
  state.preview = "";
}

function openFile(entry: TFilesystemEntry) {
  state.selectedPath = entry.path;
  state.preview = entry.content ?? "";
}

function openEntry(entry: TFilesystemEntry) {
  if (entry.kind === "directory") {
    openDirectory(entry.path);
    return;
  }

  openFile(entry);
}

function goUp() {
  if (state.path === "/") return;
  openDirectory("/");
}

export default html`
  <main class="fs-widget">
    <header class="fs-header">
      <strong>Filesystem</strong>
      <code title="${() => state.path}">${() => state.path}</code>
    </header>

    <section class="fs-body">
      <nav class="fs-list-pane" aria-label="Directory entries">
        <button
          class="fs-up-button"
          type="button"
          disabled="${() => state.path === "/" ? true : false}"
          @click="${goUp}"
        >
          <img class="fs-button-icon" src="${HandIconUrl}" alt="" />
          Parent
        </button>

        <ul class="fs-list">
          ${() => (childEntriesByPath[state.path] ?? []).map((entry) => html`
            <li>
              <button
                type="button"
                title="${entry.path}"
                data-active="${() => state.selectedPath === entry.path ? "true" : false}"
                @click="${() => openEntry(entry)}"
              >
                <span aria-hidden="true">${entry.kind === "directory" ? "📁" : "📄"}</span>
                <span class="fs-entry-name">${entry.name}</span>
              </button>
            </li>
          `)}
        </ul>
      </nav>

      <article class="fs-preview">
        <h2>${() => state.selectedPath || "No file selected"}</h2>
        <pre>${() => state.preview}</pre>
      </article>
    </section>
  </main>
`;
