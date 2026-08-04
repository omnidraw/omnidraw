import { OrpcWebsocketService, type TOrpcSafeClient } from "@omnidraw/orpc-client";
import { showErrorToast, showSuccessToast, showToast, showWarningToast } from "../components/ui/Toast";
import { txRouteNotificationToast } from "./tx.route-notification-toast";

function websocketUrl(): string {
  const origin = new URL(globalThis.location?.origin ?? "http://localhost");
  origin.protocol = origin.protocol === "https:" ? "wss:" : "ws:";
  origin.pathname = "/api";
  origin.search = "";
  origin.hash = "";
  return origin.toString();
}

function dynamicClient(resolveRoot: () => unknown, path: readonly PropertyKey[] = []): unknown {
  const callable = () => undefined;
  return new Proxy(callable, {
    get(_target, property) {
      return dynamicClient(resolveRoot, [...path, property]);
    },
    apply(_target, _thisArg, args) {
      let parent = resolveRoot() as Record<PropertyKey, unknown>;
      for (const part of path.slice(0, -1)) {
        parent = parent[part] as Record<PropertyKey, unknown>;
      }
      const method = parent[path.at(-1)!];
      if (typeof method !== "function") throw new Error("The active ORPC client method is unavailable.");
      return Reflect.apply(method, parent, args);
    },
  });
}

class FrontendOrpcConnection {
  readonly apiService: TOrpcSafeClient;
  #service: OrpcWebsocketService | null = null;
  #notificationIterator: AsyncIterator<unknown> | null = null;
  #generation = 0;

  constructor() {
    this.apiService = dynamicClient(() => {
      if (!this.#service) throw new Error("The server connection is not active.");
      return this.#service.apiService;
    }) as TOrpcSafeClient;
    this.connect();
  }

  connect(): void {
    if (this.#service) throw new Error("The server connection is already active.");
    const service = new OrpcWebsocketService({ websocketUrl: websocketUrl() });
    this.#service = service;
    const generation = ++this.#generation;
    void this.#consumeNotifications(service, generation);
  }

  async disconnect(): Promise<void> {
    this.#generation += 1;
    const service = this.#service;
    this.#service = null;
    const iterator = this.#notificationIterator;
    this.#notificationIterator = null;
    const returning = iterator?.return?.();
    service?.dispose();
    await returning?.catch(() => undefined);
  }

  async #consumeNotifications(service: OrpcWebsocketService, generation: number): Promise<void> {
    const [error, iterable] = await service.apiService.api.notification.events({});
    if (generation !== this.#generation || service !== this.#service) {
      await iterable?.[Symbol.asyncIterator]().return?.();
      return;
    }
    if (error) {
      showErrorToast(error.name, error.message);
      return;
    }

    const iterator = iterable[Symbol.asyncIterator]();
    this.#notificationIterator = iterator;
    try {
      while (generation === this.#generation && service === this.#service) {
        const result = await iterator.next();
        if (result.done || generation !== this.#generation || service !== this.#service) return;
        txRouteNotificationToast({
          showError: showErrorToast,
          showInfo: showToast,
          showSuccess: showSuccessToast,
          showWarning: showWarningToast,
        }, { event: result.value });
      }
    } catch (error) {
      if (generation === this.#generation && service === this.#service) {
        showErrorToast("Notification connection failed", error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (this.#notificationIterator === iterator) this.#notificationIterator = null;
    }
  }
}

export const orpcWebsocketService = new FrontendOrpcConnection();
