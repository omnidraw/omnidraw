import type { IPlugin } from "@vibecanvas/runtime";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "@vibecanvas/canvas";
import type { TWidgetCatalog, TWidgetPlacementRef, TWidgetVariantSummary } from "@vibecanvas/orpc-client";
import { fnWidgetPlacementToolId } from '@vibecanvas/widget-contract';
import { fnResolveWidgetToolIcon } from "../widget/fn.resolve-widget-tool-icon";
import type { TAiChatApplicationPort, TWidgetTransportPort } from "../ports";
import type { WidgetManagerService } from "../widget/WidgetManagerService";
import type { WidgetPlacementService } from "../widget-placement/WidgetPlacementService";

export function createWidgetPlugin(portal: {
  application: TAiChatApplicationPort;
  transport: TWidgetTransportPort;
  widgetManager: WidgetManagerService;
  widgetPlacement: WidgetPlacementService;
}): IPlugin<IRuntimeServices, IRuntimeHooks, IRuntimeConfig> {
  return {
    name: "widget-plugin",
    apply(ctx) {
      const placementToolFingerprints = new Map<string, string>();
      let refreshGeneration = 0;

      const placementTool = (
        variant: TWidgetVariantSummary,
        nextToolIds: Set<string>,
        tone?: "draft",
      ) => {
        const placement = variant.placement;
        if (!placement) return;
        const id = fnWidgetPlacementToolId(placement.reference);
        nextToolIds.add(id);
        const fingerprint = JSON.stringify({
          reference: placement.reference,
          bounds: placement.bounds,
          label: variant.tool.label ?? variant.displayName,
          icon: variant.tool.icon,
          group: variant.tool.group,
          priority: variant.tool.priority,
          tone: tone ?? null,
        });
        if (placementToolFingerprints.get(id) === fingerprint) return;
        portal.widgetManager.registerPlacementTool({
          id,
          label: `${variant.tool.label ?? variant.displayName}${tone === "draft" ? " · Draft" : ""}`,
          tone,
          icon: fnResolveWidgetToolIcon(variant.tool.icon ?? undefined),
          group: variant.tool.group ?? undefined,
          priority: variant.tool.priority ?? undefined,
          placement: portal.widgetPlacement.createDropRequest({
            reference: placement.reference,
            bounds: placement.bounds,
            label: variant.tool.label ?? variant.displayName,
          }),
        });
        placementToolFingerprints.set(id, fingerprint);
      };

      const refreshWidgets = async () => {
        const generation = ++refreshGeneration;
        const catalogResult = await (
          portal.transport.api.agent?.widgets?.catalog({})
          ?? Promise.resolve([new Error("Widget catalog is unavailable."), null] as const)
        );
        if (generation !== refreshGeneration) return;
        const [catalogError, catalogValue] = catalogResult;
        if (catalogError || !catalogValue) {
          portal.widgetManager.setGlobalDefinitionError({
            phase: "definition-discovery",
            code: "WIDGET_DEFINITION_UNAVAILABLE",
            message: "Widget placement catalog could not be loaded.",
            retryable: true,
          });
          portal.widgetManager.completeDefinitionDiscovery();
          return;
        }
        const catalog: TWidgetCatalog = catalogValue;
        portal.widgetManager.setGlobalDefinitionError(null);

        const nextPlacementToolIds = new Set<string>();
        const availableReferences: TWidgetPlacementRef[] = [];
        for (const entry of catalog.widgets) {
          const published = entry.published;
          if (published) {
            if (published.placement) {
              availableReferences.push(published.placement.reference);
              placementTool(published, nextPlacementToolIds);
            }
          }
          if (entry.draft?.placement) availableReferences.push(entry.draft.placement.reference);
          if (entry.draft && (entry.relation !== "same" || !entry.published)) {
            placementTool(entry.draft, nextPlacementToolIds, "draft");
          }
        }
        portal.widgetPlacement.cancelActiveIfUnavailable(availableReferences);
        placementToolFingerprints.forEach((_fingerprint, id) => {
          if (nextPlacementToolIds.has(id)) return;
          portal.widgetManager.unregisterPlacementTool(id);
          placementToolFingerprints.delete(id);
        });
        portal.widgetManager.completeDefinitionDiscovery();
      };

      ctx.hooks.initAsync.tapPromise(refreshWidgets);
      ctx.hooks.init.tap(() => {
        const eventsEndpoint = portal.transport.api.agent?.events;
        let disposed = false;
        let iterator: AsyncIterator<unknown> | undefined;
        const closeIterator = (candidate: AsyncIterator<unknown> | undefined) => {
          if (!candidate?.return) return;
          try {
            const closing = candidate.return();
            if (closing) void Promise.resolve(closing).catch(() => undefined);
          } catch {
            // Stream cleanup must remain safe when an iterator closes synchronously.
          }
        };
        if (eventsEndpoint) {
          void eventsEndpoint({}).then(async ([error, events]) => {
            if (error) {
              if (!disposed) portal.application.logError(error);
              return;
            }
            const currentIterator = events[Symbol.asyncIterator]();
            if (disposed) return closeIterator(currentIterator);
            iterator = currentIterator;
            try {
              while (!disposed) {
                const next = await currentIterator.next();
                if (next.done || disposed) break;
                const event = next.value;
                if (!(event && typeof event === "object" && "kind" in event)) continue;
                const kind = (event as { kind?: string }).kind;
                const type = (event as { type?: string }).type;
                if (kind === "widgetupdate" || kind === "widget-published" || kind === "widget-draft" || (kind === "widget-preview" && type === "catalog-changed") || kind === "widget-catalog") {
                  await refreshWidgets();
                }
              }
            } finally {
              if (iterator === currentIterator) {
                iterator = undefined;
                closeIterator(currentIterator);
              }
            }
          }).catch((error) => {
            if (!disposed) portal.application.logError(error);
          });
        }
        const unsubscribe = portal.application.subscribeCatalogInvalidation?.("widgets", () => void refreshWidgets());
        ctx.hooks.destroy.tap(() => {
          disposed = true;
          refreshGeneration += 1;
          unsubscribe?.();
          closeIterator(iterator);
          iterator = undefined;
          placementToolFingerprints.forEach((_fingerprint, id) => portal.widgetManager.unregisterPlacementTool(id));
          placementToolFingerprints.clear();
        });
      });
    },
  };
}
