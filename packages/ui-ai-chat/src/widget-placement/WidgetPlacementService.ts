import type { IService, IStartableService, IStoppableService } from "@vibecanvas/runtime";
import type { IServiceContext } from "@vibecanvas/runtime/interface.js";
import type { TWidgetFrameBounds, TWidgetPlacementRef } from '@vibecanvas/widget-contract';
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
  fnValidateDirectPublishedWidgetPlacement,
  fnValidateWidgetPlacementDescriptor,
} from "./fn.validate-widget-placement-descriptor";
import type { TDirectPublishedWidgetPlacementDescriptor } from "./fn.validate-widget-placement-descriptor";

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
    const directPublishedPlacement = fnValidateDirectPublishedWidgetPlacement({
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
        if (directPublishedPlacement.kind !== "not-published") {
          try {
            if (directPublishedPlacement.kind === "invalid") {
              throw new Error(directPublishedPlacement.message);
            }
            this.#commitDirectPublished(commitArgs, directPublishedPlacement.descriptor, args.label);
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

  #commitDirectPublished(args: {
    reference: TWidgetPlacementRef;
    bounds: TWidgetFrameBounds;
    clientPoint: { x: number; y: number };
  }, expected: TDirectPublishedWidgetPlacementDescriptor, label: string): void {
    const validated = fnValidateDirectPublishedWidgetPlacement({
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
      throw new Error("The committed published widget placement differs from its catalog descriptor.");
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
    let durableDraftId: string | undefined;
    {
      if (args.reference.source === "draft") {
        durableDraftId = await this.#resolveDurableDraftOwner(args.reference);
      }
      const [error, result] = await this.#args.api.api.agent.widgets.resolvePlacement({
        reference: args.reference,
        ...(durableDraftId ? { expectedDraftId: durableDraftId } : {}),
      });
      if (error) throw error;
      if (!result.ok) throw new Error(result.message);
      const validated = fnValidateWidgetPlacementDescriptor({
        descriptor: result.descriptor,
        expectedReference: args.reference,
      });
      if (!validated.ok) throw new Error(validated.message);
      const descriptor = validated.descriptor;
      const worldBounds = this.#args.dropPlacement.resolveWorldBounds(args.clientPoint, descriptor.bounds);
      if (descriptor.kind === "published") {
        throw new Error("Published widgets must be placed from their local catalog descriptor.");
      }
      {
        if (!descriptor.draftId) throw new Error("The draft identity is unavailable.");
        if (descriptor.draftId !== durableDraftId) {
          throw new Error("The placement resolver returned a different durable draft owner.");
        }
        await this.#args.previewFrames.place({
          draftId: descriptor.draftId,
          expectedRevision: descriptor.reference.revision,
          bounds: worldBounds,
        });
      }
      this.#notification?.showSuccess(`${label} added to canvas`, descriptor.reference.source === "draft" ? "Draft built as a pinned Preview." : undefined);
    }
  }

  async #resolveDurableDraftOwner(reference: TWidgetPlacementRef): Promise<string> {
    const [error, detail] = await this.#args.api.api.agent.widgets.detail({
      name: reference.name,
      source: "draft",
    });
    if (error) throw error;
    const draftId = detail?.variant.draftId;
    const validation = detail?.variant.validation;
    if (
      detail
      && detail.name === reference.name
      && detail.source === "draft"
      && detail.variant.source === "draft"
      && detail.variant.revision === reference.revision
      && draftId === null
    ) {
      throw new Error("Validate this widget again from its owning AI chat before placing it.");
    }
    if (
      detail
      && detail.name === reference.name
      && detail.source === "draft"
      && detail.variant.source === "draft"
      && detail.variant.revision === reference.revision
      && validation?.status === "invalid"
      && validation.validatedRevision === reference.revision
    ) {
      throw new Error("This widget cannot be placed because its current UI build is invalid.");
    }
    if (
      detail
      && detail.name === reference.name
      && detail.source === "draft"
      && detail.variant.source === "draft"
      && detail.variant.revision === reference.revision
      && validation?.status !== "valid"
    ) {
      throw new Error("Validate this widget successfully before placing it.");
    }
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

  #showCommitError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.#notification?.showError("Widget placement failed", message);
  }
}
