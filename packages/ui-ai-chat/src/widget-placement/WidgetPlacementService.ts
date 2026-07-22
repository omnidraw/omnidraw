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
import {
  fnValidateDirectV2WidgetPlacement,
  fnValidateWidgetPlacementDescriptor,
} from "./fn.validate-widget-placement-descriptor";
import type { TDirectV2WidgetPlacementDescriptor } from "./fn.validate-widget-placement-descriptor";

type TWidgetPlacementServiceArgs = {
  api: TAiChatApiPort;
  browser: TWidgetBrowserPort;
  coordinator: TWidgetPlacementCoordinator;
  dropPlacement: WidgetDropPlacementService;
  previewFrames: DraftPreviewFrameService;
  widgetManager: WidgetManagerService;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
    const directV2Placement = fnValidateDirectV2WidgetPlacement({
      reference: args.reference,
      bounds: args.bounds,
    });
    return {
      reference: args.reference,
      bounds: args.bounds,
      label: args.label,
      onDragStart: args.onDragStart,
      onDragEnd: args.onDragEnd,
      onCancel: () => this.#notification?.showInfo("Widget placement canceled"),
      onCommit: (commitArgs: {
        reference: TWidgetPlacementRef;
        bounds: TWidgetFrameBounds;
        clientPoint: { x: number; y: number };
      }) => {
        if (directV2Placement.kind !== "not-v2") {
          try {
            if (directV2Placement.kind === "invalid") {
              throw new Error(directV2Placement.message);
            }
            this.#commitDirectV2(commitArgs, directV2Placement.descriptor, args.label);
          } catch (error) {
            this.#showCommitError(error);
          }
          return;
        }
        return this.#commitResolved(commitArgs, args.label).catch((error) => {
          this.#showCommitError(error);
        });
      },
    };
  }

  #commitDirectV2(args: {
    reference: TWidgetPlacementRef;
    bounds: TWidgetFrameBounds;
    clientPoint: { x: number; y: number };
  }, expected: TDirectV2WidgetPlacementDescriptor, label: string): void {
    const validated = fnValidateDirectV2WidgetPlacement({
      reference: args.reference,
      bounds: args.bounds,
    });
    if (
      validated.kind !== "valid"
      || validated.descriptor.definitionId !== expected.definitionId
      || validated.descriptor.revisionId !== expected.revisionId
      || validated.descriptor.bounds.width !== expected.bounds.width
      || validated.descriptor.bounds.height !== expected.bounds.height
    ) {
      throw new Error("The committed v2 widget placement differs from its catalog descriptor.");
    }
    const worldBounds = this.#args.dropPlacement.resolveWorldBounds(args.clientPoint, expected.bounds);
    this.#args.widgetManager.placeWidgetInstance({
      definitionId: expected.definitionId,
      revisionId: expected.revisionId,
      bounds: worldBounds,
    });
    this.#notification?.showSuccess(`${label} added to canvas`);
  }

  async #commitResolved(args: {
    reference: TWidgetPlacementRef;
    bounds: TWidgetFrameBounds;
    clientPoint: { x: number; y: number };
  }, label: string): Promise<void> {
    const previewId = args.reference.source === "published" ? undefined : this.#args.browser.createId();
    let durableDraftId: string | undefined;
    try {
      if (previewId) {
        durableDraftId = await this.#resolveDurableDraftOwner(args.reference);
      }
      const [error, result] = await this.#args.api.api.agent.widgets.resolvePlacement({
        reference: args.reference,
        ...(previewId ? { previewId } : {}),
        ...(durableDraftId ? { expectedDraftId: durableDraftId } : {}),
      });
      if (error) throw error;
      if (!result.ok) throw new Error(result.message);
      const validated = fnValidateWidgetPlacementDescriptor({
        descriptor: result.descriptor,
        expectedReference: args.reference,
        expectedPreviewId: previewId ?? null,
      });
      if (!validated.ok) throw new Error(validated.message);
      const descriptor = validated.descriptor;
      const worldBounds = this.#args.dropPlacement.resolveWorldBounds(args.clientPoint, descriptor.bounds);
      if (descriptor.kind === "published-v2") {
        throw new Error("Published v2 widgets must be placed from their local catalog descriptor.");
      }
      if (descriptor.kind === "published-legacy") {
        if (!descriptor.definitionName) throw new Error("The published widget definition is unavailable.");
        this.#args.widgetManager.placeLegacyPublishedWidget(descriptor.definitionName, worldBounds);
      } else {
        if (!descriptor.previewId || !descriptor.draftId) throw new Error("The Preview authority is unavailable.");
        if (descriptor.draftId !== durableDraftId) {
          throw new Error("The placement resolver returned a different durable draft owner.");
        }
        await this.#args.previewFrames.place({
          draftId: descriptor.draftId,
          expectedRevision: descriptor.reference.revision,
          previewId: descriptor.previewId,
          bounds: worldBounds,
        });
      }
      this.#notification?.showSuccess(`${label} added to canvas`, descriptor.reference.source === "draft" ? "Draft built as a pinned Preview." : undefined);
    } catch (error) {
      if (previewId && durableDraftId) {
        await this.#releasePreviewOwner(durableDraftId, previewId);
      }
      throw error;
    }
  }

  async #resolveDurableDraftOwner(reference: TWidgetPlacementRef): Promise<string> {
    const [error, detail] = await this.#args.api.api.agent.widgets.detail({
      name: reference.name,
      source: "draft",
    });
    if (error) throw error;
    const draftId = detail?.variant.draftId;
    if (
      !detail
      || detail.name !== reference.name
      || detail.source !== "draft"
      || detail.variant.source !== "draft"
      || detail.variant.revision !== reference.revision
      || typeof draftId !== "string"
      || !UUID_PATTERN.test(draftId)
    ) {
      throw new Error("The widget draft changed before Preview placement.");
    }
    return draftId;
  }

  async #releasePreviewOwner(draftId: string, previewId: string): Promise<void> {
    const [, current] = await this.#args.api.api.agent.widgetPreview.get({
      draftId,
      previewId,
    }).catch(() => [undefined, undefined] as const);
    if (!current?.ready || current.draftId !== draftId || current.previewId !== previewId) return;
    await this.#args.api.api.agent.widgetPreview.close({
      draftId,
      previewId,
      expectedPreviewRevisionId: current.previewRevisionId,
    }).catch(() => undefined);
  }

  #showCommitError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.#notification?.showError("Widget placement failed", message);
  }
}
