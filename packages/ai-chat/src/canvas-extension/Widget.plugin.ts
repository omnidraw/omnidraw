import type { IPlugin } from "@vibecanvas/runtime";
import type { IRuntimeConfig, IRuntimeHooks, IRuntimeServices } from "@vibecanvas/canvas";
import type { TWidgetCatalog, TWidgetPlacementRef, TWidgetVariantSummary } from "@vibecanvas/orpc-client";
import { fnWidgetPlacementToolId } from "@vibecanvas/service-actor/core/fn.widget-frame";
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
      const publishedRegistrationFingerprints = new Map<string, string>();
      const placementToolFingerprints = new Map<string, string>();
      let refreshGeneration = 0;

      const placementTool = (
        variant: TWidgetVariantSummary,
        nextToolIds: Set<string>,
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
        });
        if (placementToolFingerprints.get(id) === fingerprint) return;
        portal.widgetManager.registerPlacementTool({
          id,
          label: `${variant.tool.label ?? variant.displayName} · Draft`,
          tone: "draft",
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

      const registerPublished = async (
        variant: TWidgetVariantSummary | undefined,
        actorDefinitionName: string,
        fingerprint: string,
        generation: number,
      ) => {
        if (publishedRegistrationFingerprints.get(actorDefinitionName) === fingerprint) return;
        const [error, actor] = await portal.transport.api.actors.definitions.get({ name: actorDefinitionName });
        if (generation !== refreshGeneration) return;
        if (error) {
          portal.widgetManager.setDefinitionError(actorDefinitionName, {
            phase: "definition-fetch",
            code: "WIDGET_DEFINITION_UNAVAILABLE",
            message: `Could not load widget definition "${actorDefinitionName}".`,
            retryable: true,
          });
          return;
        }
        const arrowjs = actor.widgetCode.reduce<Record<string, string>>((sources, file) => {
          sources[file.path] = file.content;
          return sources;
        }, {});
        const reference = variant?.placement?.reference;
        portal.widgetManager.registerWidget({
          id: actor.def.name,
          toolId: reference ? fnWidgetPlacementToolId(reference) : undefined,
          dataType: "widget",
          tool: {
            ...actor.def.widget.tool,
            icon: fnResolveWidgetToolIcon(actor.def.widget.tool.icon),
          },
          widgetPlacement: variant?.placement && reference ? portal.widgetPlacement.createDropRequest({
            reference,
            bounds: variant.placement.bounds,
            label: actor.def.widget.tool.label,
          }) : undefined,
          actor: { actorDefinitionName: actor.def.name },
          sandbox: {
            // @ts-expect-error Published definitions guarantee main.ts or main.js after backend validation.
            arrowjs,
          },
        });
        publishedRegistrationFingerprints.set(actorDefinitionName, fingerprint);
      };

      const refreshWidgets = async () => {
        const generation = ++refreshGeneration;
        const [definitionsResult, catalogResult] = await Promise.all([
          portal.transport.api.actors.definitions.list(),
          portal.transport.api.agent?.widgets?.catalog({}) ?? Promise.resolve([new Error("Widget catalog is unavailable."), null] as const),
        ]);
        if (generation !== refreshGeneration) return;
        const [definitionsError, actorDefs] = definitionsResult;
        const [catalogError, catalogValue] = catalogResult;
        if (definitionsError) {
          portal.widgetManager.setGlobalDefinitionError({
            phase: "definition-discovery",
            code: "WIDGET_DEFINITION_UNAVAILABLE",
            message: "Widget definitions or placement catalog could not be loaded.",
            retryable: true,
          });
          portal.widgetManager.completeDefinitionDiscovery();
          return;
        }
        if (catalogError || !catalogValue) {
          portal.widgetManager.setGlobalDefinitionError(null);
          placementToolFingerprints.forEach((_fingerprint, id) => portal.widgetManager.unregisterPlacementTool(id));
          placementToolFingerprints.clear();
          const nextPublishedKinds = new Set(actorDefs.filter((definition) => definition.health !== "error").map((definition) => definition.name));
          publishedRegistrationFingerprints.forEach((_fingerprint, name) => {
            if (nextPublishedKinds.has(name)) return;
            portal.widgetManager.unregisterWidget(name);
            publishedRegistrationFingerprints.delete(name);
          });
          await Promise.all(actorDefs.flatMap((definition) => {
            if (definition.health === "error") return [];
            return [registerPublished(undefined, definition.name, `fallback:${definition.updated_at}`, generation)];
          }));
          portal.widgetManager.completeDefinitionDiscovery();
          return;
        }
        const catalog: TWidgetCatalog = catalogValue;
        portal.widgetManager.setGlobalDefinitionError(null);

        const definitionsByName = new Map(actorDefs.map((definition) => [definition.name, definition]));
        const nextPublishedKinds = new Set<string>();
        const nextPlacementToolIds = new Set<string>();
        const availableReferences: TWidgetPlacementRef[] = [];
        const registrations: Promise<void>[] = [];
        for (const entry of catalog.widgets) {
          const published = entry.published;
          if (published) {
            if (published.placement) availableReferences.push(published.placement.reference);
            const actorDefinition = definitionsByName.get(published.displayName) ?? definitionsByName.get(entry.name);
            if (actorDefinition?.health === "error") {
              portal.widgetManager.setDefinitionError(actorDefinition.name, actorDefinition.error ?? {
                phase: "definition-fetch",
                code: "WIDGET_DEFINITION_UNAVAILABLE",
                message: `Could not load widget definition "${actorDefinition.name}".`,
                retryable: true,
              });
            } else if (actorDefinition) {
              nextPublishedKinds.add(actorDefinition.name);
              registrations.push(registerPublished(
                published,
                actorDefinition.name,
                JSON.stringify({
                  revision: published.revision,
                  updatedAt: actorDefinition.updated_at,
                  placement: published.placement,
                  tool: published.tool,
                }),
                generation,
              ));
            }
          }
          if (entry.draft?.placement) availableReferences.push(entry.draft.placement.reference);
          if (entry.draft && (entry.relation !== "same" || !entry.published)) {
            placementTool(entry.draft, nextPlacementToolIds);
          }
        }
        portal.widgetPlacement.cancelActiveIfUnavailable(availableReferences);
        placementToolFingerprints.forEach((_fingerprint, id) => {
          if (nextPlacementToolIds.has(id)) return;
          portal.widgetManager.unregisterPlacementTool(id);
          placementToolFingerprints.delete(id);
        });
        publishedRegistrationFingerprints.forEach((_fingerprint, name) => {
          if (nextPublishedKinds.has(name)) return;
          portal.widgetManager.unregisterWidget(name);
          publishedRegistrationFingerprints.delete(name);
        });
        await Promise.all(registrations);
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
