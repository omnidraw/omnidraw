import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import { SyncHook } from '@vibecanvas/tapable';
import type { TActorConnection, TActorEvent, TActorInstance } from '@vibecanvas/api-actors/contract';
import type { TOrpcSafeClient } from '@vibecanvas/orpc-client';
import Konva from 'konva';
import { CanvasMode } from '../selection/CONSTANTS';
import type { ContextMenuService } from '../context-menu/ContextMenuService';
import type { SceneService } from '../scene/SceneService';
import type { SelectionService } from '../selection/SelectionService';
import type { IRuntimeConfig, IRuntimeHooks } from '../../types';
import { txRemoveActorConnectionLine, txSyncActorConnectionLines } from './tx.sync-lines';

export interface IActorConnectionServiceHooks {
  change: SyncHook<[]>;
}

export type TActorConnectionCreateArgs = {
  id?: string;
  sourceElementId: string;
  targetElementId: string;
  sourceActorInstanceId?: string;
  targetActorInstanceId?: string;
  label?: string | null;
  eventNameWhitelist?: string[] | null;
  style?: Record<string, unknown>;
};

export type TActorConnectionUpdatePatch = {
  enabled?: boolean;
  label?: string | null;
  eventNameWhitelist?: string[] | null;
  style?: Record<string, unknown>;
};

export type TActorConnectionServiceProps = {
  apiService: TOrpcSafeClient;
  canvasId: string;
  contextMenu: ContextMenuService;
  scene: SceneService;
  selection: SelectionService;
  notifyError?: (title: string, description?: string) => void;
};

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLElement && target.isContentEditable;
}

export class ActorConnectionService implements IService<IActorConnectionServiceHooks>, IStartableService<IRuntimeHooks, IRuntimeConfig>, IStoppableService {
  readonly name = 'actor-connection';
  readonly hooks: IActorConnectionServiceHooks = { change: new SyncHook() };

  #apiService: TOrpcSafeClient;
  #canvasId: string;
  #contextMenu: ContextMenuService;
  #scene: SceneService;
  #selection: SelectionService;
  #notifyError?: (title: string, description?: string) => void;
  #instances = new Map<string, TActorInstance>();
  #connections = new Map<string, TActorConnection>();
  #stopped = false;
  #removeSelectionChangeListener?: () => boolean;
  #removeKeydownListener?: () => boolean;

  constructor(props: TActorConnectionServiceProps) {
    this.#apiService = props.apiService;
    this.#canvasId = props.canvasId;
    this.#contextMenu = props.contextMenu;
    this.#scene = props.scene;
    this.#selection = props.selection;
    this.#notifyError = props.notifyError;
  }

  start(ctx: { hooks: IRuntimeHooks; config: IRuntimeConfig }): void {
    this.#removeSelectionChangeListener = this.#selection.hooks.change.tap(() => this.syncAllLines());
    this.#removeKeydownListener = ctx.hooks.keydown.tap((event) => {
      if (this.#selection.mode !== CanvasMode.SELECT) return;
      if (!this.#selection.selectedConnectionId) return;
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      if (isEditableTarget(event.target)) return;

      event.preventDefault();
      event.stopPropagation();
      void this.deleteConnection(this.#selection.selectedConnectionId);
    });
    this.#contextMenu.registerProvider('actor-connection', ({ scope, connectionId }) => {
      if (scope !== 'connection' || !connectionId) return [];
      const connection = this.#connections.get(connectionId);
      return [
        {
          id: connection?.enabled === false ? 'enable-actor-connection' : 'disable-actor-connection',
          label: connection?.enabled === false ? 'Enable connection' : 'Disable connection',
          priority: 240,
          onSelect: () => void this.updateConnection(connectionId, { enabled: connection?.enabled === false }),
        },
        {
          id: 'delete-actor-connection',
          label: 'Delete connection',
          priority: 250,
          onSelect: () => void this.deleteConnection(connectionId),
        },
      ];
    });
    void this.#subscribe();
  }

  stop(): void {
    this.#stopped = true;
    this.#removeSelectionChangeListener?.();
    this.#removeKeydownListener?.();
    this.#contextMenu.unregisterProvider('actor-connection');
  }

  getInstances() {
    return [...this.#instances.values()];
  }

  getConnections() {
    return [...this.#connections.values()];
  }

  upsertInstance(row: TActorInstance) {
    this.#instances.set(row.id, row);
    this.hooks.change.call();
  }

  upsertConnection(row: TActorConnection) {
    this.#connections.set(row.id, row);
    this.syncConnection(row.id);
    this.hooks.change.call();
  }

  removeConnection(id: string) {
    this.#connections.delete(id);
    this.#removeLine(id);
    this.hooks.change.call();
  }

  removeInstance(id: string) {
    this.#instances.delete(id);
    this.getConnections()
      .filter((connection) => connection.source_actor_instance_id === id || connection.target_actor_instance_id === id)
      .forEach((connection) => this.removeConnection(connection.id));
    this.hooks.change.call();
  }

  async deleteInstanceForElement(args: { elementId: string; actorInstanceId?: string | null }) {
    const actorInstanceId = args.actorInstanceId
      ?? this.getInstances().find((instance) => instance.element_id === args.elementId)?.id
      ?? null;
    if (!actorInstanceId) return null;

    const [error, instance] = await this.#apiService.api.actors.instances.remove({ id: actorInstanceId });
    if (error || !instance) {
      this.#notifyError?.('Could not delete actor instance', error instanceof Error ? error.message : undefined);
      return null;
    }

    this.removeInstance(instance.id);
    return instance;
  }

  async createConnection(input: TActorConnectionCreateArgs) {
    const [error, connection] = await this.#apiService.api.actors.connections.create({
      ...input,
      canvasId: this.#canvasId,
    });
    if (error || !connection) {
      this.#notifyError?.('Could not create actor connection', error instanceof Error ? error.message : undefined);
      return null;
    }

    this.upsertConnection(connection);
    return connection;
  }

  async updateConnection(id: string, patch: TActorConnectionUpdatePatch) {
    const [error, connection] = await this.#apiService.api.actors.connections.update({ id, patch });
    if (error || !connection) {
      this.#notifyError?.('Could not update actor connection', error instanceof Error ? error.message : undefined);
      return null;
    }

    this.upsertConnection(connection);
    return connection;
  }

  async deleteConnection(id: string) {
    const [error, connection] = await this.#apiService.api.actors.connections.remove({ id });
    if (error || !connection) {
      this.#notifyError?.('Could not delete actor connection', error instanceof Error ? error.message : undefined);
      return null;
    }

    this.removeConnection(connection.id);
    return connection;
  }

  syncAllLines() {
    txSyncActorConnectionLines(this.#portal(), { connections: this.getConnections() });
  }

  syncConnection(id: string) {
    const connection = this.#connections.get(id);
    if (!connection) {
      this.#removeLine(id);
      return;
    }

    txSyncActorConnectionLines(this.#portal(), { connections: [connection] });
  }

  syncAttachedNode(node: Konva.Node, args?: { syncHandles?: boolean }) {
    if (!(node instanceof Konva.Group)) return false;
    return txSyncActorConnectionLines(this.#portal(), {
      connections: this.getConnections(),
      sourceNode: node,
      syncHandles: args?.syncHandles,
    });
  }

  #portal() {
    return {
      Circle: Konva.Circle,
      Group: Konva.Group,
      Line: Konva.Line,
      layer: this.#scene.staticForegroundLayer,
      selection: this.#selection,
    };
  }

  #removeLine(id: string) {
    txRemoveActorConnectionLine(this.#portal(), { id });
  }

  #applyEvent(event: TActorEvent) {
    if (event.type === 'actor.snapshot') {
      this.#instances = new Map(event.instances.map((instance) => [instance.id, instance]));
      this.#connections = new Map(event.connections.map((connection) => [connection.id, connection]));
      this.syncAllLines();
      this.hooks.change.call();
      return;
    }

    if (event.type === 'actor.instance.created' || event.type === 'actor.instance.updated') {
      this.upsertInstance(event.instance);
      return;
    }

    if (event.type === 'actor.instance.deleted') {
      this.removeInstance(event.instanceId);
      return;
    }

    if (event.type === 'actor.connection.created' || event.type === 'actor.connection.updated') {
      this.upsertConnection(event.connection);
      return;
    }

    if (event.type === 'actor.connection.deleted') {
      this.removeConnection(event.connectionId);
    }
  }

  async #subscribe() {
    const [error, iterator] = await this.#apiService.api.actors.events({ canvasId: this.#canvasId });
    if (error || !iterator) {
      this.#notifyError?.('Could not subscribe to actor connections', error instanceof Error ? error.message : undefined);
      return;
    }

    for await (const event of iterator) {
      if (this.#stopped) return;
      this.#applyEvent(event);
    }
  }
}
