import type { IPlugin } from "@vibecanvas/runtime";
import type { TElement } from "@vibecanvas/service-automerge/types/canvas-doc.types";
import Type from "lucide-static/icons/type.svg?raw";
import { fnCreateShape2dInlineTextElement } from "../../core/fn.shape2d";
import type { TCanvasProductTextSession } from "../../engine/product-runtime/typed";
import { fnCanvasActiveSessionDependencies } from "../../services/active-session/fn.dependencies";
import type { TCrdtCommitResult } from "../../services/crdt/CrdtService";
import type { THistoryEntry } from "../../services/history/HistoryService";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "../../types";
import {
  DEFAULT_TEXT_ALIGN,
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_FONT_SIZE_TOKEN,
  DEFAULT_TEXT_VERTICAL_ALIGN,
} from "./CONSTANTS";
import { fnCreateTextElement } from "./fn.create-text-element";

const DEFAULT_TEXT_COLOR_TOKEN = "@base/900";

const TEXT_EDIT_ELEMENT_DEPENDENCY_FIELDS = [
  "x",
  "y",
  "rotation",
  "scaleX",
  "scaleY",
  "parentGroupId",
  "data",
  "style",
  "locked",
] as const;

const TEXT_EDIT_GROUP_DEPENDENCY_FIELDS = [
  "parentGroupId",
  "locked",
] as const;

function createId(document: Document) {
  return document.defaultView?.crypto.randomUUID()
    ?? `text-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nextZIndex(crdt: IRuntimeServices["crdt"]) {
  const document = crdt.doc();
  return `z${String(
    Object.keys(document.elements).length + Object.keys(document.groups).length,
  ).padStart(8, "0")}`;
}

function textOf(element: TElement) {
  if (element.data.type === "text") {
    return element.data.text;
  }
  if (
    element.data.type === "rect"
    || element.data.type === "diamond"
    || element.data.type === "ellipse"
  ) {
    return element.data.text?.text ?? "";
  }
  return null;
}

type TShapeTextHost = TElement & {
  data: Extract<
    TElement["data"],
    { type: "rect" | "diamond" | "ellipse" }
  >;
};

function isShapeTextHost(element: TElement): element is TShapeTextHost {
  return element.data.type === "rect"
    || element.data.type === "diamond"
    || element.data.type === "ellipse";
}

type TPendingTextCreation = {
  commit: TCrdtCommitResult;
  element: TElement;
  historyEntry: THistoryEntry;
  resolved: boolean;
};

function isUnchangedCreation(
  current: TElement | undefined,
  creation: TPendingTextCreation,
) {
  return current !== undefined
    && JSON.stringify(current) === JSON.stringify(creation.element);
}

export function createTextPlugin():
IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "text",
    apply(ctx) {
      const activeSession = ctx.services.require("activeSession");
      const crdt = ctx.services.require("crdt");
      const element = ctx.services.require("element");
      const history = ctx.services.require("history");
      const scene = ctx.services.require("scene");
      const selection = ctx.services.require("selection");
      const sharedSession = ctx.services.require("session");
      const theme = ctx.services.require("theme");
      const tool = ctx.services.require("tool");
      const document = scene.container.ownerDocument;
      const cleanups: Array<() => void> = [];
      let editor: {
        activeSessionId: string;
        targetId: string;
        textarea: HTMLTextAreaElement;
        session: TCanvasProductTextSession;
        creation: TPendingTextCreation | null;
      } | null = null;

      const closeEditor = (mode: "commit" | "cancel" | "destroy") => {
        const active = editor;
        if (active === null) {
          return;
        }
        editor = null;
        sharedSession.editingId = null;
        activeSession.complete(active.activeSessionId);
        try {
          if (mode === "commit") {
            active.session.commit();
          } else if (mode === "cancel") {
            active.session.cancel();
          }
        } finally {
          active.session.destroy();
          active.textarea.remove();
        }
      };

      const resolveCreation = (
        creation: TPendingTextCreation,
        mode: "commit" | "cancel",
        editCommit?: TCrdtCommitResult,
        ownedCreationBeforeEdit = false,
      ) => {
        if (creation.resolved) {
          return;
        }
        creation.resolved = true;
        history.discard(creation.historyEntry);
        if (mode === "cancel") {
          if (isUnchangedCreation(
            crdt.doc().elements[creation.element.id],
            creation,
          )) {
            creation.commit.rollback();
          }
          return;
        }
        if (editCommit === undefined) {
          return;
        }
        if (!ownedCreationBeforeEdit) {
          history.record({
            label: "Edit text",
            undo: () => crdt.applyOps({ ops: editCommit.undoOps }),
            redo: () => crdt.applyOps({ ops: editCommit.redoOps }),
          });
          return;
        }
        history.record({
          label: "Create text",
          undo: () => {
            crdt.applyOps({ ops: editCommit.undoOps });
            crdt.applyOps({ ops: creation.commit.undoOps });
          },
          redo: () => {
            crdt.applyOps({ ops: creation.commit.redoOps });
            crdt.applyOps({ ops: editCommit.redoOps });
          },
        });
      };

      const finishEditor = (targetId: string) => {
        if (editor?.targetId !== targetId) {
          return;
        }
        const active = editor;
        editor = null;
        sharedSession.editingId = null;
        activeSession.complete(active.activeSessionId);
        active.session.destroy();
        active.textarea.remove();
      };

      const openEditor = (
        targetId: string,
        creation: TPendingTextCreation | null = null,
      ) => {
        const persisted = crdt.doc().elements[targetId];
        const initialText = persisted === undefined ? null : textOf(persisted);
        if (persisted === undefined || initialText === null) {
          return false;
        }
        closeEditor("commit");
        const textarea = document.createElement("textarea");
        textarea.value = initialText;
        textarea.setAttribute("aria-label", "Edit canvas text");
        textarea.style.position = "fixed";
        textarea.style.margin = "0";
        textarea.style.padding = "0";
        textarea.style.border = "0";
        textarea.style.outline = "none";
        textarea.style.resize = "none";
        textarea.style.overflow = "hidden";
        textarea.style.background = "transparent";
        textarea.style.zIndex = "30";
        document.body.append(textarea);

        try {
          const productSession = scene.product.interactions.createTextSession({
            target: { kind: "element", id: targetId },
            role: persisted.data.type === "text" ? "render" : "inline-text",
            element: textarea,
            commitOnBlur: true,
            selectOnFocus: true,
            onCommit: (text) => {
              const current = crdt.doc().elements[targetId];
              if (current === undefined) {
                if (creation !== null) {
                  resolveCreation(creation, "cancel");
                }
                finishEditor(targetId);
                return;
              }
              if (
                creation !== null
                && text === ""
                && isUnchangedCreation(current, creation)
              ) {
                resolveCreation(creation, "cancel");
                selection.clear();
                finishEditor(targetId);
                return;
              }
              const ownedCreationBeforeEdit = creation !== null
                && isUnchangedCreation(current, creation);
              let next: TElement;
              if (current.data.type === "text") {
                next = {
                  ...current,
                  updatedAt: Date.now(),
                  data: {
                    ...current.data,
                    text,
                    originalText: text,
                    w: current.data.autoResize
                      ? Math.max(4, textarea.scrollWidth)
                      : current.data.w,
                    h: Math.max(4, textarea.scrollHeight),
                  },
                };
              } else if (isShapeTextHost(current)) {
                next = fnCreateShape2dInlineTextElement({
                  element: current,
                  text,
                  fontFamily: current.data.text?.fontFamily
                    ?? DEFAULT_TEXT_FONT_FAMILY,
                });
                next.updatedAt = Date.now();
              } else {
                if (creation !== null) {
                  resolveCreation(creation, "cancel");
                }
                finishEditor(targetId);
                return;
              }
              const result = crdt.build()
                .patchElement(targetId, next)
                .commit();
              if (creation === null) {
                history.record({
                  label: "Edit text",
                  undo: () => crdt.applyOps({ ops: result.undoOps }),
                  redo: () => crdt.applyOps({ ops: result.redoOps }),
                });
              } else {
                resolveCreation(
                  creation,
                  "commit",
                  result,
                  ownedCreationBeforeEdit,
                );
              }
              finishEditor(targetId);
            },
            onCancel: () => {
              if (creation !== null) {
                resolveCreation(creation, "cancel");
                selection.clear();
              }
              finishEditor(targetId);
            },
          });
          const activeSessionId = `text-edit:${targetId}`;
          editor = {
            activeSessionId,
            targetId,
            textarea,
            session: productSession,
            creation,
          };
          activeSession.register({
            id: activeSessionId,
            kind: "text-edit",
            startedAtRevision: crdt.revision,
            dependencies: fnCanvasActiveSessionDependencies({
              document: crdt.doc(),
              targets: [{ kind: "element", id: targetId }],
              elementFields: TEXT_EDIT_ELEMENT_DEPENDENCY_FIELDS,
              groupFields: TEXT_EDIT_GROUP_DEPENDENCY_FIELDS,
            }),
            cancel: (event) => {
              if (event.reason.startsWith("remote-")) {
                ctx.config.notification?.showInfo(
                  "Text editing stopped",
                  "The text changed in another session.",
                );
              }
              closeEditor("cancel");
            },
          });
          sharedSession.editingId = targetId;
          textarea.focus();
          textarea.select();
          return true;
        } catch {
          textarea.remove();
          return false;
        }
      };

      const openAfterProjection = (
        targetId: string,
        creation: TPendingTextCreation,
      ) => {
        if (openEditor(targetId, creation)) {
          return;
        }
        let removeListener: (() => void) | null = null;
        removeListener = scene.hooks.projection.tap(() => {
          if (!openEditor(targetId, creation)) {
            return;
          }
          removeListener?.();
          removeListener = null;
        });
        cleanups.push(() => removeListener?.());
      };

      cleanups.push(element.registerElement({
        id: "text",
        matchesElement: (candidate) => {
          return candidate.data.type === "text"
            && candidate.data.containerId === null;
        },
        getSelectionStyleMenu: () => ({
          sections: {
            showStrokeColorPicker: true,
            showOpacityPicker: true,
            showTextPickers: true,
          },
          values: {
            strokeColor: DEFAULT_TEXT_COLOR_TOKEN,
            opacity: 1,
            fontFamily: `${DEFAULT_TEXT_FONT_FAMILY}, sans-serif`,
            fontSize: DEFAULT_TEXT_FONT_SIZE_TOKEN,
            textAlign: DEFAULT_TEXT_ALIGN,
            verticalAlign: DEFAULT_TEXT_VERTICAL_ALIGN,
          },
        }),
        getTransformPolicy: () => ({
          handles: [
            "move",
            "rotate",
            "resize-ne",
            "resize-se",
            "resize-sw",
            "resize-nw",
          ],
          keepAspectRatio: true,
        }),
      }));

      cleanups.push(tool.registerTool({
        id: "text",
        label: "Text",
        icon: Type,
        shortcuts: ["t"],
        priority: 50,
        behavior: { type: "mode", mode: "click-create" },
        createSession: (event) => {
          scene.product.interactions.beginCreation(event, {
            thresholdViewport: 2,
            onCommit: (commit) => {
              const now = Date.now();
              const remembered = theme.getRememberedStyle("text");
              const created: TElement = fnCreateTextElement({
                id: createId(document),
                x: commit.start.world.x,
                y: commit.start.world.y,
                createdAt: now,
                updatedAt: now,
              });
              created.zIndex = nextZIndex(crdt);
              created.style = {
                ...created.style,
                strokeColor: remembered.strokeColor ?? DEFAULT_TEXT_COLOR_TOKEN,
                opacity: remembered.opacity ?? 1,
                fontSize: remembered.fontSize ?? DEFAULT_TEXT_FONT_SIZE_TOKEN,
                textAlign: remembered.textAlign ?? DEFAULT_TEXT_ALIGN,
                verticalAlign: remembered.verticalAlign
                  ?? DEFAULT_TEXT_VERTICAL_ALIGN,
              };
              if (created.data.type === "text") {
                created.data.fontFamily = remembered.fontFamily
                  ?? DEFAULT_TEXT_FONT_FAMILY;
              }
              const result = crdt.build()
                .patchElement(created.id, created)
                .commit();
              const historyEntry: THistoryEntry = {
                label: "Create text",
                undo: () => crdt.applyOps({ ops: result.undoOps }),
                redo: () => crdt.applyOps({ ops: result.redoOps }),
              };
              history.record(historyEntry);
              const creation: TPendingTextCreation = {
                commit: result,
                element: created,
                historyEntry,
                resolved: false,
              };
              selection.select({ kind: "element", id: created.id });
              tool.setActiveTool("select");
              openAfterProjection(created.id, creation);
            },
          });
          return {
            id: `create-text-${event.pointerId}`,
            cancel: () => scene.product.interactions.cancel(),
          };
        },
      }));

      cleanups.push(ctx.hooks.elementPointerDoubleClick.tap((event) => {
        return event.hit.target.kind === "element"
          && openEditor(event.hit.target.id);
      }));
      cleanups.push(ctx.hooks.keydown.tap((event) => {
        if (editor === null) {
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          if (editor.creation !== null && editor.textarea.value === "") {
            closeEditor("cancel");
          } else {
            closeEditor("commit");
          }
        } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          closeEditor("commit");
        }
      }));

      ctx.hooks.destroy.tap(() => {
        closeEditor("destroy");
        for (const cleanup of cleanups.splice(0).reverse()) {
          cleanup();
        }
      });
    },
  };
}
