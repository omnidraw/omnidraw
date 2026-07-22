import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TLegacyActorUiCapability } from '@vibecanvas/ui-ai-chat';
import { ActorStateMachineView } from './ActorStateMachineView';
import { LegacyWidgetActorAdapter } from './LegacyWidgetActorAdapter';
import type { TCreateLegacyActorUiCapabilityArgs } from './interface';

export function createLegacyActorUiCapability(
  args: TCreateLegacyActorUiCapabilityArgs,
): TLegacyActorUiCapability {
  return {
    createRuntimeAdapter: ({ logging }) => new LegacyWidgetActorAdapter({
      ...args,
      logging,
    }),
    createWidgetPlugin: (portal) => ({
      name: 'legacy-actor-widget-plugin',
      apply(ctx) {
        const registrationFingerprints = new Map<string, string>();
        let refreshGeneration = 0;

        const registerDefinition = async (
          name: string,
          fingerprint: string,
          generation: number,
        ) => {
          if (registrationFingerprints.get(name) === fingerprint) return;
          const [error, actor] = await args.transport.api.actors.definitions.get({ name });
          if (generation !== refreshGeneration) return;
          if (error) {
            portal.widgetManager.setDefinitionError(name, {
              phase: 'definition-fetch',
              code: 'WIDGET_DEFINITION_UNAVAILABLE',
              message: `Could not load legacy widget definition "${name}".`,
              retryable: true,
            });
            return;
          }
          const arrowjs = actor.widgetCode.reduce<Record<string, string>>((sources, file) => {
            sources[file.path] = file.content;
            return sources;
          }, {});
          portal.widgetManager.registerWidget({
            id: actor.def.name,
            dataType: 'widget',
            getTitle: () => actor.def.widget.tool.label,
            actor: { actorDefinitionName: actor.def.name },
            sandbox: {
              // Actor definitions guarantee main.ts or main.js after legacy validation.
              arrowjs: arrowjs as { 'main.ts': string; 'main.css'?: string },
            },
          });
          portal.widgetManager.clearDefinitionError(name);
          registrationFingerprints.set(name, fingerprint);
        };

        const refresh = async () => {
          const generation = ++refreshGeneration;
          const [error, definitions] = await args.transport.api.actors.definitions.list();
          if (generation !== refreshGeneration) return;
          if (error) {
            portal.application.logError(error);
            return;
          }
          const nextNames = new Set<string>();
          const registrations: Promise<void>[] = [];
          for (const definition of definitions) {
            if (definition.health === 'error') {
              portal.widgetManager.setDefinitionError(definition.name, definition.error ?? {
                phase: 'definition-fetch',
                code: 'WIDGET_DEFINITION_UNAVAILABLE',
                message: `Could not load legacy widget definition "${definition.name}".`,
                retryable: true,
              });
              continue;
            }
            nextNames.add(definition.name);
            registrations.push(registerDefinition(
              definition.name,
              String(definition.updated_at),
              generation,
            ));
          }
          await Promise.all(registrations);
          if (generation !== refreshGeneration) return;
          registrationFingerprints.forEach((_fingerprint, name) => {
            if (nextNames.has(name)) return;
            portal.widgetManager.unregisterWidget(name);
            registrationFingerprints.delete(name);
          });
        };

        ctx.hooks.initAsync.tapPromise(refresh);
        ctx.hooks.init.tap(() => {
          let disposed = false;
          let iterator: AsyncIterator<unknown> | undefined;
          const closeIterator = (candidate: AsyncIterator<unknown> | undefined) => {
            if (!candidate?.return) return;
            try {
              const closing = candidate.return();
              if (closing) void Promise.resolve(closing).catch(() => undefined);
            } catch {
              // Legacy stream cleanup remains safe for synchronous iterators.
            }
          };
          const eventsEndpoint = args.transport.api.agent?.events;
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
                  if (!event || typeof event !== 'object' || !('kind' in event)) continue;
                  const kind = (event as { kind?: string }).kind;
                  if (kind === 'widgetupdate' || kind === 'widget-published' || kind === 'widget-catalog') {
                    await refresh();
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
          const unsubscribe = portal.application.subscribeCatalogInvalidation?.(
            'widgets',
            () => void refresh(),
          );
          ctx.hooks.destroy.tap(() => {
            disposed = true;
            refreshGeneration += 1;
            unsubscribe?.();
            closeIterator(iterator);
            iterator = undefined;
            registrationFingerprints.forEach((_fingerprint, name) => {
              portal.widgetManager.unregisterWidget(name);
            });
            registrationFingerprints.clear();
          });
        });
      },
    }),
    StateMachineView: (props) => {
      if (!('actor' in props.manifest)) return null;
      return <ActorStateMachineView
        manifest={props.manifest as TVibecanvasJson}
        variant={props.variant}
        title={props.title}
      />;
    },
  };
}
