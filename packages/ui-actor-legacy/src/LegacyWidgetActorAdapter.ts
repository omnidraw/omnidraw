import type { TActorEvent } from '@vibecanvas/api/actor/contract';
import type {
  TLegacyWidgetLoggingPort,
  TLegacyWidgetRuntimeAdapter,
  TLegacyWidgetSandboxMountArgs,
} from '@vibecanvas/ui-ai-chat';
import type {
  TCreateLegacyActorUiCapabilityArgs,
  TLegacyActorUiTransportPort,
} from './interface';
import { mountLegacyWidgetSandbox } from './mount-legacy-widget-sandbox';

export type TWidgetActorEvent = TActorEvent;
type TWidgetActorEventHandler = (event: TWidgetActorEvent) => void;
type TActorInstancesPort = TLegacyActorUiTransportPort['api']['actors']['instances'];
type TActorSnapshotArgs = Parameters<TActorInstancesPort['snapshot']>[0];
type TActorSendMessageArgs = Parameters<TActorInstancesPort['sendMessage']>[0];

type TLegacyWidgetActorAdapterConfig = TCreateLegacyActorUiCapabilityArgs & Readonly<{
  logging: TLegacyWidgetLoggingPort;
}>;

type TActiveIterator = Readonly<{
  generation: number;
  iterator: AsyncIterator<unknown>;
}>;

type TReconnectWait = {
  generation: number;
  timer: unknown | null;
  resolve: () => void;
};

/** Compatibility-only actor bridge. Neutral widget instances never start it. */
export class LegacyWidgetActorAdapter implements TLegacyWidgetRuntimeAdapter {
  readonly #subscribers = new Map<string, Set<TWidgetActorEventHandler>>();
  #running = false;
  #generation = 0;
  #activeIterator: TActiveIterator | null = null;
  #reconnectWait: TReconnectWait | null = null;

  constructor(readonly config: TLegacyWidgetActorAdapterConfig) {}

  start(): void {
    if (this.#running) return;
    this.#running = true;
    const generation = ++this.#generation;
    void this.#listen(generation);
  }

  stop(): void {
    this.#running = false;
    this.#generation += 1;
    const reconnectWait = this.#reconnectWait;
    this.#reconnectWait = null;
    if (reconnectWait) {
      if (reconnectWait.timer !== null) this.config.browser.clearTimeout(reconnectWait.timer);
      reconnectWait.resolve();
    }
    this.#closeIterator(this.#activeIterator?.iterator ?? null);
    this.#activeIterator = null;
    this.#subscribers.clear();
  }

  subscribe(actorInstanceId: string, handler: TWidgetActorEventHandler): () => void {
    let subscribers = this.#subscribers.get(actorInstanceId);
    if (!subscribers) {
      subscribers = new Set();
      this.#subscribers.set(actorInstanceId, subscribers);
    }
    subscribers.add(handler);
    return () => {
      subscribers.delete(handler);
      if (subscribers.size === 0) this.#subscribers.delete(actorInstanceId);
    };
  }

  async deleteDefinition(name: string): Promise<boolean> {
    const [error] = await this.config.transport.api.actors.definitions.delete({ name });
    if (!error) return true;
    this.config.logging.warn({
      kind: 'service',
      name: 'legacy-widget-actor-adapter',
      level: 1,
      event: 'delete-widget-definition-failed',
      payload: error,
    });
    return false;
  }

  getSnapshot(args: TActorSnapshotArgs): ReturnType<TActorInstancesPort['snapshot']> {
    return this.config.transport.api.actors.instances.snapshot(args);
  }

  sendMessage(args: TActorSendMessageArgs): ReturnType<TActorInstancesPort['sendMessage']> {
    return this.config.transport.api.actors.instances.sendMessage(args);
  }

  mountSandbox(args: TLegacyWidgetSandboxMountArgs): () => void {
    return mountLegacyWidgetSandbox(this, args);
  }

  async #listen(generation: number): Promise<void> {
    let delay = 250;
    while (this.#isActive(generation)) {
      try {
        const [error, events] = await this.config.transport.api.actors.events({});
        if (error) {
          if (!this.#isActive(generation)) return;
          throw error;
        }
        delay = 250;
        const iterator = events[Symbol.asyncIterator]();
        if (!this.#isActive(generation)) {
          this.#closeIterator(iterator);
          return;
        }
        const activeIterator: TActiveIterator = { generation, iterator };
        this.#activeIterator = activeIterator;
        try {
          while (this.#isActive(generation)) {
            const next = await iterator.next();
            if (!this.#isActive(generation)) return;
            if (next.done) break;
            this.#route(next.value as TWidgetActorEvent);
          }
        } finally {
          if (this.#activeIterator === activeIterator) {
            this.#activeIterator = null;
            this.#closeIterator(iterator);
          }
        }
      } catch (error) {
        if (!this.#isActive(generation)) return;
        this.config.logging.warn({
          kind: 'service',
          name: 'legacy-widget-actor-adapter',
          level: 1,
          event: 'actor-event-stream-disconnected',
          payload: error,
        });
        this.#subscribers.forEach((subscribers, actorId) => {
          const event: TWidgetActorEvent = {
            kind: 'system',
            actorId,
            type: 'error',
            code: 'ACTOR_EVENT_STREAM_DISCONNECTED',
            message: 'Widget actor updates were disconnected. Reconnecting…',
          };
          subscribers.forEach((handler) => handler(event));
        });
      }
      if (!this.#isActive(generation)) return;
      await this.#waitForReconnect(generation, delay);
      if (!this.#isActive(generation)) return;
      delay = Math.min(delay * 2, 5_000);
    }
  }

  async #waitForReconnect(generation: number, delay: number): Promise<void> {
    if (!this.#isActive(generation)) return;
    await new Promise<void>((resolve) => {
      const reconnectWait: TReconnectWait = {
        generation,
        timer: null,
        resolve,
      };
      this.#reconnectWait = reconnectWait;
      reconnectWait.timer = this.config.browser.setTimeout(() => {
        if (this.#reconnectWait === reconnectWait) this.#reconnectWait = null;
        resolve();
      }, delay);
    });
  }

  #isActive(generation: number): boolean {
    return this.#running && this.#generation === generation;
  }

  #route(event: TWidgetActorEvent): void {
    this.#subscribers.get(event.actorId)?.forEach((handler) => handler(event));
  }

  #closeIterator(iterator: AsyncIterator<unknown> | null): void {
    if (!iterator?.return) return;
    try {
      const closing = iterator.return();
      if (closing) void Promise.resolve(closing).catch(() => undefined);
    } catch {
      // Compatibility stream cleanup remains safe for synchronous iterators.
    }
  }
}
