import type { IService, IStartableService, IStoppableService } from "@vibecanvas/runtime";
import type { TOrpcSafeClient } from "@vibecanvas/orpc-client";
import { SyncHook } from "@vibecanvas/tapable";
import type { IRuntimeConfig, IRuntimeHooks } from "../../types";
import type { CrdtService } from "../crdt/CrdtService";
import type { ActorConnectionService } from "../actor-connection/ActorConnectionService";
import { fnCreateActorWidgetPendingKey, fnListActorWidgetElements } from "./fn.widget-actor";
import { txEnsureActorInstance } from "./tx.ensure-actor-instance";

export interface IActorWidgetBindingServiceHooks {
  change: SyncHook<[]>;
}

export type TActorWidgetBindingServiceProps = {
  apiService: TOrpcSafeClient;
  canvasId: string;
  crdt: CrdtService;
  actorConnection: ActorConnectionService;
};

export class ActorWidgetBindingService implements IService<IActorWidgetBindingServiceHooks>, IStartableService<IRuntimeHooks, IRuntimeConfig>, IStoppableService {
  readonly name = "actor-widget-binding";
  readonly hooks: IActorWidgetBindingServiceHooks = { change: new SyncHook() };

  #apiService: TOrpcSafeClient;
  #canvasId: string;
  #crdt: CrdtService;
  #actorConnection: ActorConnectionService;
  #pending = new Map<string, Promise<unknown>>();
  #removeCrdtListener?: () => boolean;

  constructor(props: TActorWidgetBindingServiceProps) {
    this.#apiService = props.apiService;
    this.#canvasId = props.canvasId;
    this.#crdt = props.crdt;
    this.#actorConnection = props.actorConnection;
  }

  start(): void {
    this.#removeCrdtListener = this.#crdt.hooks.change.tap(() => {
      this.scan();
    });
    this.scan();
  }

  stop(): void {
    this.#removeCrdtListener?.();
    this.#removeCrdtListener = undefined;
    this.#pending.clear();
  }

  scan() {
    const widgets = fnListActorWidgetElements({ doc: this.#crdt.doc() });
    widgets.forEach((element) => {
      if (element.data.actorInstanceId) {
        const instance = this.#actorConnection.getInstances().find((candidate) => candidate.id === element.data.actorInstanceId);
        if (instance) this.#actorConnection.upsertInstance(instance);
        return;
      }

      const key = fnCreateActorWidgetPendingKey({ canvasId: this.#canvasId, elementId: element.id });
      if (this.#pending.has(key)) return;

      const pending = txEnsureActorInstance({
        apiService: this.#apiService,
        crdt: this.#crdt,
      }, {
        canvasId: this.#canvasId,
        element,
      }).then((instance) => {
        if (instance) {
          this.#actorConnection.upsertInstance(instance);
          this.hooks.change.call();
        }
      }).finally(() => {
        this.#pending.delete(key);
      });
      this.#pending.set(key, pending);
    });
  }
}
