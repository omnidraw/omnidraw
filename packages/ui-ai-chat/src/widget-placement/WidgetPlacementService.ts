import type { IService, IStartableService, IStoppableService } from "@vibecanvas/runtime";
import type { IServiceContext } from "@vibecanvas/runtime/interface.js";
import type { TWidgetFrameBounds, TWidgetPlacementRef } from "@vibecanvas/service-actor/core/fn.widget-frame";
import type { IRuntimeConfig, IRuntimeHooks } from "@vibecanvas/canvas";
import type { WidgetDropPlacementService } from "@vibecanvas/canvas/services";
import type { TAiChatApiPort, TWidgetBrowserPort } from "../ports";
import type { DraftPreviewFrameService } from "../draft-preview/DraftPreviewFrameService";
import type { WidgetManagerService } from "../widget/WidgetManagerService";
import type {
  TWidgetPlacementCoordinator,
  TWidgetPlacementStartArgs,
} from "./WidgetPlacementCoordinator";

type TWidgetPlacementServiceArgs = {
  api: TAiChatApiPort;
  browser: TWidgetBrowserPort;
  coordinator: TWidgetPlacementCoordinator;
  dropPlacement: WidgetDropPlacementService;
  previewFrames: DraftPreviewFrameService;
  widgetManager: WidgetManagerService;
};

export class WidgetPlacementService implements IService, IStartableService<IRuntimeHooks, IRuntimeConfig>, IStoppableService {
  readonly name = "widget-placement";
  readonly #args: TWidgetPlacementServiceArgs;
  #notification: IRuntimeConfig["notification"];
  #unregister: (() => void) | undefined;

  constructor(args: TWidgetPlacementServiceArgs) {
    this.#args = args;
  }

  start(context: IServiceContext<IRuntimeHooks, IRuntimeConfig>): void {
    this.#notification = context.config.notification;
    this.#unregister = this.#args.coordinator.register(this);
  }

  stop(): void {
    this.#unregister?.();
    this.#unregister = undefined;
  }

  beginPointerSession(args: TWidgetPlacementStartArgs): boolean {
    return this.#args.dropPlacement.beginPointerSession(this.#request(args), args.event);
  }

  async addToCanvas(args: {
    reference: TWidgetPlacementRef;
    bounds: TWidgetFrameBounds;
    label: string;
  }): Promise<void> {
    await this.#args.dropPlacement.addAtViewportCenter(this.#request(args));
  }

  createDropRequest(args: {
    reference: TWidgetPlacementRef;
    bounds: TWidgetFrameBounds;
    label: string;
  }) {
    return this.#request(args);
  }

  cancelActiveIfUnavailable(availableReferences: readonly TWidgetPlacementRef[]): void {
    this.#args.dropPlacement.cancelIfReferenceUnavailable(availableReferences);
  }

  #request(args: Omit<TWidgetPlacementStartArgs, "event">) {
    return {
      reference: args.reference,
      bounds: args.bounds,
      label: args.label,
      onDragStart: args.onDragStart,
      onDragEnd: args.onDragEnd,
      onCancel: () => this.#notification?.showInfo("Widget placement canceled"),
      onCommit: async (commitArgs: {
        reference: TWidgetPlacementRef;
        bounds: TWidgetFrameBounds;
        clientPoint: { x: number; y: number };
      }) => {
        try {
          await this.#commit(commitArgs, args.label);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.#notification?.showError("Widget placement failed", message);
        }
      },
    };
  }

  async #commit(args: {
    reference: TWidgetPlacementRef;
    bounds: TWidgetFrameBounds;
    clientPoint: { x: number; y: number };
  }, label: string): Promise<void> {
    const previewId = args.reference.source === "published" ? undefined : this.#args.browser.createId();
    try {
      const [error, result] = await this.#args.api.api.agent.widgets.resolvePlacement({
        reference: args.reference,
        ...(previewId ? { previewId } : {}),
      });
      if (error) throw error;
      if (!result.ok) throw new Error(result.message);
      const descriptor = result.descriptor;
      if (
        descriptor.reference.source !== args.reference.source
        || descriptor.reference.name !== args.reference.name
        || descriptor.reference.revision !== args.reference.revision
      ) {
        throw new Error("The placement resolver returned a different widget revision.");
      }
      const worldBounds = this.#args.dropPlacement.resolveWorldBounds(args.clientPoint, descriptor.bounds);
      if (descriptor.kind === "published") {
        if (!descriptor.definitionName) throw new Error("The published widget definition is unavailable.");
        this.#args.widgetManager.placePublishedWidget(descriptor.definitionName, worldBounds);
      } else {
        if (!descriptor.previewId) throw new Error("The Preview owner is unavailable.");
        await this.#args.previewFrames.place({
          draftName: descriptor.reference.name,
          expectedRevision: descriptor.reference.revision,
          previewId: descriptor.previewId,
          bounds: worldBounds,
        });
      }
      this.#notification?.showSuccess(`${label} added to canvas`, descriptor.reference.source === "draft" ? "Draft built as a pinned Preview." : undefined);
    } catch (error) {
      if (previewId) {
        await this.#args.api.api.agent.widgetPreview.close({
          draftId: args.reference.name,
          previewId,
          expectedRevision: args.reference.revision,
        }).catch(() => undefined);
      }
      throw error;
    }
  }
}
