import type { TCanvasExtensionDocumentPort } from "@omnidraw/canvas";
import {
  fnReadCanvasWidgetExtension,
  type TCanvasSceneNode,
} from "@omnidraw/canvas-contract";
import type { TFrontendRuntime } from "@/shell/runtime/frontend-runtime";
import { WIDGET_PREVIEW_DEFAULT_BOUNDS } from "@/core/widgets/fn.placed-widget-node";
import type { TWidgetPublicCatalog } from "../sidebar/ports";

type TPreviewDocument = Pick<TCanvasExtensionDocumentPort, "nodes" | "setSelection">;

export type TWidgetPreviewAutomation = Readonly<{
  bind(document: TPreviewDocument): () => void;
  ensure(name: string): Promise<void>;
}>;

function isDraftPreview(node: Readonly<TCanvasSceneNode>, widgetKey: string): boolean {
  const extension = fnReadCanvasWidgetExtension(node);
  return extension?.type === "widget-preview" && extension.widgetKey === widgetKey;
}

function findDraft(
  catalog: TWidgetPublicCatalog,
  name: string,
): TWidgetPublicCatalog["entries"][number] | null {
  return catalog.entries.find((entry) => (
    entry.widgetKey === name || entry.draft?.config?.name === name
  )) ?? null;
}

/** Bridges a structured AI result to the existing normal Canvas placement path. */
export function createWidgetPreviewAutomation(
  runtime: TFrontendRuntime,
): TWidgetPreviewAutomation {
  let document: TPreviewDocument | null = null;
  const waiters: Array<(value: TPreviewDocument) => void> = [];
  let gate: Promise<void> = Promise.resolve();

  const currentDocument = async (): Promise<TPreviewDocument> => {
    if (document !== null) return document;
    return new Promise<TPreviewDocument>((resolve) => waiters.push(resolve));
  };

  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const run = gate.then(work, work);
    gate = run.then(() => undefined, () => undefined);
    return run;
  };

  const ensureOnce = async (name: string): Promise<void> => {
    const target = await currentDocument();
    const [catalogError, catalog] = await runtime.api.safeRequest("widget.catalog.get", {});
    if (catalogError || catalog === undefined) {
      throw catalogError ?? new Error("The widget catalog is unavailable.");
    }
    const entry = findDraft(catalog, name);
    const draft = entry?.draft;
    if (entry === null || draft === null || draft === undefined || draft.health !== "healthy") {
      throw new Error(`The widget draft '${name}' is not ready for Preview.`);
    }
    const existing = target.nodes().find((node) => isDraftPreview(node, entry.widgetKey));
    if (existing !== undefined) {
      target.setSelection([existing.id], { focusedNodeId: existing.id });
      return;
    }
    await runtime.widgetPlacement.addToCanvas({
      reference: {
        source: "draft",
        widgetKey: entry.widgetKey,
        catalogGeneration: catalog.generation,
      },
      bounds: WIDGET_PREVIEW_DEFAULT_BOUNDS,
      label: draft.config?.tool.label ?? draft.config?.name ?? entry.widgetKey,
    });
  };

  return Object.freeze({
    bind(nextDocument) {
      document = nextDocument;
      for (const resolve of waiters.splice(0)) resolve(nextDocument);
      return () => {
        if (document !== nextDocument) return;
        document = null;
      };
    },
    ensure(name) {
      return enqueue(() => ensureOnce(name));
    },
  });
}
