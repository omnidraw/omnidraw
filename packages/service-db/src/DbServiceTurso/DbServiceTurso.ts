import type { IService, IStartableService, IStoppableService } from "@vibecanvas/runtime";
import path from "node:path";
import type { IDbConfig } from "../interface";
import type { TActorConnection, TActorDefinition, TActorInstance, TActorResource, TActorResourceKind, TActorResourceStatus, TCanvas, TCanvasMember, TDbResourceApplyInstanceStatus, TDbResourceApplyStatus, TDbResourceDraftChangeKind, TDbResourceDraftStatus, TFilesystem, TJson, TKeyValue, TMediaFile, TToolGroup } from "../model";
import { fxAccountGetDefaultOwner } from "./fx.account";
import { fxActorGetDefinition, fxActorGetInstanceByElementId, fxActorGetInstanceById, fxActorListConnections, fxActorListDefinitions, fxActorListInstances } from "./fx.actor";
import { fxActorResourceGet, fxActorResourceKeyValueGet, fxActorResourceKeyValueHas, fxActorResourceKeyValueList, fxActorResourceList, fxActorResourceListBindingsForDefinition, fxActorResourceListBindingsForResource, fxActorResourceListDefinitionsReferencingResource } from "./fx.actor-resource";
import { fxCanvasFindById, fxCanvasFindByName, fxCanvasListAll, fxCanvasListMembers } from "./fx.canvas";
import { fxDbResourceApplyGet, fxDbResourceApplyInstanceResultListByApply, fxDbResourceApplyInstanceResultListByInstance, fxDbResourceApplyList, fxDbResourceDraftChangeList, fxDbResourceDraftGet, fxDbResourceDraftGetActive, fxDbResourceDraftList, fxDbResourceListAffectedInstances } from "./fx.db-resource";
import { fxFileGetById, fxFileListAll } from "./fx.file";
import { fxFilesystemFindById, fxFilesystemListAll } from "./fx.filesystem";
import { fxKeyValueGet } from "./fx.keyValue";
import { fxToolGroupGetByName, fxToolGroupListAll } from "./fx.tool-group";
import { txAccountEnsureDefaultOwner } from "./tx.account";
import { txActorDeleteConnectionById, txActorDeleteConnectionBySource, txActorDeleteDefinition, txActorDeleteInstance, txActorInsertConnection, txActorInsertDefinition, txActorInsertInstance, txActorUpdateDefinition, txActorUpdateInstanceHealth, txActorUpdateInstanceMachine, txActorUpdateInstanceStatus } from "./tx.actor";
import { txActorResourceBeginDelete, txActorResourceCreate, txActorResourceDelete, txActorResourceKeyValueCompareAndSet, txActorResourceKeyValueDelete, txActorResourceKeyValueSet, txActorResourceRemoveBinding, txActorResourceRename, txActorResourceUpdateProviderState, txActorResourceUpsertBinding } from "./tx.actor-resource";
import { txCanvasCreate, txCanvasDeleteById, txCanvasRenameById } from "./tx.canvas";
import { txDbResourceApplyCreate, txDbResourceApplyCreateFromDraft, txDbResourceApplyFinishWithDraft, txDbResourceApplyInstanceResultUpsert, txDbResourceApplyUpdate, txDbResourceDraftAppendChange, txDbResourceDraftCreate, txDbResourceDraftDiscard, txDbResourceDraftRename, txDbResourceDraftUpdateStatus } from "./tx.db-resource";
import { txFileCreate, txFileDeleteById } from "./tx.file";
import { txFilesystemCreate } from "./tx.filesystem";
import { txKeyValueAdd, txKeyValueRemove } from "./tx.keyValue";
import { txToolGroupCreate, txToolGroupRemove, txToolGroupUpdate } from "./tx.tool-group";
import { txRunMigrations } from "./tx.migrations";
import { txDefaultRunPragmas } from "./tx.pragma";
import { Database } from "./turso-native";

type TCanvasCreateArgs = Omit<TCanvas, "created_at">;
type TFileCreateArgs = Omit<TMediaFile, "created_at">
type TFilesystemCreateArgs = Omit<TFilesystem, "created_at" | "updated_at">;
type TActorDefinitionCreateArgs = Omit<TActorDefinition, "created_at" | "updated_at">;
type TActorDefinitionUpdateArgs = Omit<TActorDefinition, "id" | "created_at" | "updated_at">;
type TActorInstanceCreateArgs = Omit<TActorInstance, "created_at" | "updated_at" | "machine_context" | "last_error"> & { machine_context: TJson; last_error?: TActorInstance['last_error'] };
type TActorInstanceUpdateStatusArgs = Pick<TActorInstance, "id" | "status">;
type TActorInstanceUpdateHealthArgs = Pick<TActorInstance, "id" | "status" | "last_error">;
type TActorInstanceUpdateMachineArgs = Pick<TActorInstance, "id" | "machine_state"> & { machine_context: TJson };
type TActorConnectionCreateArgs = Omit<TActorConnection, "created_at" | "updated_at" | "style"> & { style: TJson };


/**
 * Interface follows same pattern.
 * args, accountId?
 * If no accountId -> no authz check -> auto pass
 */
interface IPublicMethods {
  canvas: {
    listAll(args?: { accountId?: string }): Promise<TCanvas[]>;
    findByName(args: { name: string }, scope?: { accountId?: string }): Promise<TCanvas | null>;
    findById(args: { id: string }, scope?: { accountId?: string }): Promise<TCanvas | null>;
    create(args: TCanvasCreateArgs, scope?: { accountId?: string }): Promise<TCanvas>;
    renameById(args: { id: string, name: string}, scope?: { accountId?: string }): Promise<TCanvas | null>;
    deleteById(args: { id: string }, scope?: { accountId?: string }): Promise<TCanvas[]>;
    listMembers(args: { canvasId: string }, accountId?: string): Promise<TCanvasMember[]>;
  };
  file: {
    listAll(): Promise<TMediaFile[]>;
    create(args: TFileCreateArgs): Promise<TMediaFile>;
    getById(args: { id: string }): Promise<TMediaFile | null>;
    deleteById(args: { id: string }): Promise<void>;
  };
  filesystem: {
    listAll(): Promise<TFilesystem[]>;
    findById(id: string): Promise<TFilesystem | null>;
    create(args: TFilesystemCreateArgs): Promise<TFilesystem>;
  };
  keyValue: {
    add(args: TKeyValue): Promise<TKeyValue>;
    remove(args: { name: string }): Promise<void>;
    get(args: { name: string }): Promise<TKeyValue | null>;
  };
  toolGroup: {
    listAll(): Promise<TToolGroup[]>;
    getByName(args: { name: string }): Promise<TToolGroup | null>;
    create(args: TToolGroup): Promise<TToolGroup>;
    update(args: TToolGroup & { currentName: string }): Promise<TToolGroup | null>;
    remove(args: { name: string }): Promise<TToolGroup | null>;
  };
  actor: {
    listDefinitions(): Promise<TActorDefinition[]>;
    insertDefinition(def: TActorDefinitionCreateArgs): Promise<TActorDefinition>;
    deleteDefinition(id: string): Promise<void>;
    updateDefinition(def: TActorDefinitionUpdateArgs): Promise<TActorDefinition>;
    reload(): Promise<void>;
    listInstances(filter?: { canvasId?: string }): Promise<TActorInstance[]>;
    insertInstance(instance: TActorInstanceCreateArgs): Promise<TActorInstance>;
    updateInstanceStatus(instance: TActorInstanceUpdateStatusArgs): Promise<TActorInstance>;
    updateInstanceHealth(instance: TActorInstanceUpdateHealthArgs): Promise<TActorInstance>;
    updateInstanceMachine(instance: TActorInstanceUpdateMachineArgs): Promise<TActorInstance>;
    deleteInstance(id: string): Promise<void>;
    listConnections(): Promise<TActorConnection[]>;
    insertConnection(connection: TActorConnectionCreateArgs): Promise<TActorConnection>;
    deleteConnectionById(id: string): Promise<void>;
    deleteConnectionBySource(actorId: string): Promise<void>;
  }
}

export class DbServiceTurso implements IService, IStartableService, IStoppableService, IPublicMethods {
  name = 'DbServiceTurso'
  db: Database
  #actorWriteTail: Promise<void> = Promise.resolve()

  constructor(private config: IDbConfig) {
    const experimental = this.config.databasePath === ":memory:"
      ? ["custom_types", "triggers", "index_method"]
      : ["custom_types", "triggers", "index_method", "multiprocess_wal"];

    this.db = new Database(this.config.databasePath, {
      // @ts-expect-error experimental feature list is ahead of package typings
      experimental,
    })
  }
  async start(_ctx?: Parameters<IStartableService["start"]>[0]): Promise<void> {
    await this.db.connect()
    await txDefaultRunPragmas({ db: this.db }, {})
    await txRunMigrations({ db: this.db, Bun, path }, {})
  }

  async stop(): Promise<void> {
  }

  #serializeActorWrite<T>(write: () => Promise<T>): Promise<T> {
    const result = this.#actorWriteTail.then(write, write)
    this.#actorWriteTail = result.then(
      () => undefined,
      () => undefined,
    )

    return result
  }

  account = {
    getDefaultOwner: () => fxAccountGetDefaultOwner(this, {}),
    ensureDefaultOwner: () => txAccountEnsureDefaultOwner(this, {}),
  };

  canvas = {
    listAll: (args?: { accountId?: string }) => fxCanvasListAll(this, { accountId: args?.accountId }),
    findByName: (args: { name: string }, scope?: { accountId?: string }) => fxCanvasFindByName(this, { ...args, accountId: scope?.accountId }),
    findById: (args: { id: string }, scope?: { accountId?: string }) => fxCanvasFindById(this, { ...args, accountId: scope?.accountId }),
    create: (args: TCanvasCreateArgs, scope?: { accountId?: string }) => txCanvasCreate(this, { ...args, accountId: scope?.accountId }),
    renameById: (args: { id: string, name: string }, scope?: { accountId?: string }) => txCanvasRenameById(this, { ...args, accountId: scope?.accountId }),
    deleteById: (args: { id: string }, scope?: { accountId?: string }) => txCanvasDeleteById(this, { ...args, accountId: scope?.accountId }),
    listMembers: (args: { canvasId: string }) => fxCanvasListMembers(this, args),
  };

  file = {
    listAll: () => fxFileListAll(this, {}),
    create: (args: TFileCreateArgs) => txFileCreate(this, args),
    getById: (args: { id: string }) => fxFileGetById(this, args),
    deleteById: (args: { id: string }) => txFileDeleteById(this, args),
  };

  filesystem = {
    listAll: () => fxFilesystemListAll(this, {}),
    findById: (id: string) => fxFilesystemFindById(this, { id }),
    create: (args: TFilesystemCreateArgs) => txFilesystemCreate(this, args),
  };

  keyValue = {
    add: (args: TKeyValue) => txKeyValueAdd(this, args),
    remove: (args: { name: string }) => txKeyValueRemove(this, args),
    get: (args: { name: string }) => fxKeyValueGet(this, args),
  };

  actorResource = {
    create: (args: {
      id: string;
      kind: TActorResourceKind;
      name: string;
      status?: TActorResourceStatus;
      lastError?: TJson | null;
    }) => this.#serializeActorWrite(() => txActorResourceCreate(this, args)),
    get: (args: { id: string }) => fxActorResourceGet(this, args),
    list: (args: { kind?: TActorResourceKind; status?: TActorResourceStatus } = {}) => fxActorResourceList(this, args),
    rename: (args: { id: string; name: string }) => this.#serializeActorWrite(() => txActorResourceRename(this, args)),
    updateProviderState: (args: {
      id: string;
      status?: TActorResourceStatus;
      lastError?: TJson | null;
    }) => this.#serializeActorWrite(() => txActorResourceUpdateProviderState(this, args)),
    beginDelete: (args: { id: string }) => this.#serializeActorWrite(() => txActorResourceBeginDelete(this, args)),
    delete: (args: { id: string }) => this.#serializeActorWrite(() => txActorResourceDelete(this, args)),
    listBindingsForDefinition: (args: { definitionName: string }) => fxActorResourceListBindingsForDefinition(this, args),
    listBindingsForResource: (args: { resourceId: string }) => fxActorResourceListBindingsForResource(this, args),
    listDefinitionsReferencingResource: (args: { resourceId: string }) => fxActorResourceListDefinitionsReferencingResource(this, args),
    upsertBinding: (args: {
      definitionName: string;
      slotName: string;
      resourceId: string;
      allowRead: boolean;
      allowWrite: boolean;
    }) => this.#serializeActorWrite(() => txActorResourceUpsertBinding(this, args)),
    removeBinding: (args: { definitionName: string; slotName: string }) => this.#serializeActorWrite(() => txActorResourceRemoveBinding(this, args)),
    keyValue: {
      get: (args: { resourceId: string; key: string }) => fxActorResourceKeyValueGet(this, args),
      has: (args: { resourceId: string; key: string }) => fxActorResourceKeyValueHas(this, args),
      list: (args: { resourceId: string; prefix?: string; cursor?: string; limit?: number }) => fxActorResourceKeyValueList(this, args),
      set: (args: { resourceId: string; key: string; value: TJson }) => this.#serializeActorWrite(() => txActorResourceKeyValueSet(this, args)),
      delete: (args: { resourceId: string; key: string; expectedRevision?: number }) => this.#serializeActorWrite(() => txActorResourceKeyValueDelete(this, args)),
      compareAndSet: (args: { resourceId: string; key: string; expectedRevision: number | null; value: TJson }) => this.#serializeActorWrite(() => txActorResourceKeyValueCompareAndSet(this, args)),
    },
  };

  dbResource = {
    draft: {
      create: (args: { id: string; resourceId: string; name: string }) => this.#serializeActorWrite(() => txDbResourceDraftCreate(this, args)),
      get: (args: { id: string }) => fxDbResourceDraftGet(this, args),
      getActive: (args: { resourceId: string }) => fxDbResourceDraftGetActive(this, args),
      list: (args: {
        resourceId: string;
        status?: TDbResourceDraftStatus;
        before?: { createdAt: string; id: string };
        limit?: number;
      }) => fxDbResourceDraftList(this, args),
      rename: (args: { id: string; name: string }) => this.#serializeActorWrite(() => txDbResourceDraftRename(this, args)),
      updateStatus: (args: {
        id: string;
        status: TDbResourceDraftStatus;
        expectedStatus?: TDbResourceDraftStatus;
        lastError?: TJson | null;
      }) => this.#serializeActorWrite(() => txDbResourceDraftUpdateStatus(this, args)),
      discard: (args: { id: string; lastError?: TJson | null }) => this.#serializeActorWrite(() => txDbResourceDraftDiscard(this, args)),
      change: {
        list: (args: { draftId: string }) => fxDbResourceDraftChangeList(this, args),
        append: (args: {
          draftId: string;
          sequence: number;
          kind: TDbResourceDraftChangeKind;
          operation?: TJson | null;
          sql: string;
        }) => this.#serializeActorWrite(() => txDbResourceDraftAppendChange(this, args)),
      },
    },
    apply: {
      create: (args: {
        id: string;
        resourceId: string;
        draftId?: string | null;
        sourceApplyId?: string | null;
        status?: TDbResourceApplyStatus;
      }) => this.#serializeActorWrite(() => txDbResourceApplyCreate(this, args)),
      createFromDraft: (args: { id: string; resourceId: string; draftId: string }) => (
        this.#serializeActorWrite(() => txDbResourceApplyCreateFromDraft(this, args))
      ),
      get: (args: { id: string }) => fxDbResourceApplyGet(this, args),
      list: (args: {
        resourceId: string;
        status?: TDbResourceApplyStatus;
        before?: { createdAt: string; id: string };
        limit?: number;
      }) => fxDbResourceApplyList(this, args),
      update: (args: {
        id: string;
        status: TDbResourceApplyStatus;
        expectedStatus?: TDbResourceApplyStatus;
        lastError?: TJson | null;
        backupRetained?: boolean;
      }) => this.#serializeActorWrite(() => txDbResourceApplyUpdate(this, args)),
      finishWithDraft: (args: {
        id: string;
        draftId: string;
        status: Extract<TDbResourceApplyStatus, "succeeded" | "failed" | "recovered">;
        expectedStatus?: TDbResourceApplyStatus;
        draftStatus: Extract<TDbResourceDraftStatus, "applied" | "editing" | "error">;
        lastError?: TJson | null;
        backupRetained?: boolean;
      }) => this.#serializeActorWrite(() => txDbResourceApplyFinishWithDraft(this, args)),
      instanceResult: {
        upsert: (args: {
          applyId: string;
          actorInstanceId: string;
          actorDefinitionName: string;
          wasRunning: boolean;
          status: TDbResourceApplyInstanceStatus;
          error?: TJson | null;
        }) => this.#serializeActorWrite(() => txDbResourceApplyInstanceResultUpsert(this, args)),
        listByApply: (args: { applyId: string }) => fxDbResourceApplyInstanceResultListByApply(this, args),
        listByInstance: (args: { actorInstanceId: string }) => fxDbResourceApplyInstanceResultListByInstance(this, args),
      },
    },
    listAffectedInstances: (args: { resourceId: string }) => fxDbResourceListAffectedInstances(this, args),
  };

  toolGroup = {
    listAll: () => fxToolGroupListAll(this, {}),
    getByName: (args: { name: string }) => fxToolGroupGetByName(this, args),
    create: (args: TToolGroup) => txToolGroupCreate(this, args),
    update: (args: TToolGroup & { currentName: string }) => txToolGroupUpdate(this, args),
    remove: (args: { name: string }) => txToolGroupRemove(this, args),
  };

  actor = {
    listDefinitions: () => fxActorListDefinitions(this),
    insertDefinition: (def: TActorDefinitionCreateArgs) => this.#serializeActorWrite(() => txActorInsertDefinition(this, def)),
    deleteDefinition: (name: string) => this.#serializeActorWrite(() => txActorDeleteDefinition(this, { name })),
    getDefinition: (name: string) => fxActorGetDefinition(this, {name}),
    updateDefinition: (def: TActorDefinitionUpdateArgs) => this.#serializeActorWrite(() => txActorUpdateDefinition(this, def)),
    reload: async () => {
      // TODO: i forgot what this was about
    },
    listInstances: (filter?: { canvasId?: string }) => fxActorListInstances(this, { canvasId: filter?.canvasId }),
    insertInstance: (instance: TActorInstanceCreateArgs) => this.#serializeActorWrite(() => txActorInsertInstance(this, instance)),
    updateInstanceStatus: (instance: TActorInstanceUpdateStatusArgs) => this.#serializeActorWrite(() => txActorUpdateInstanceStatus(this, instance)),
    updateInstanceHealth: (instance: TActorInstanceUpdateHealthArgs) => this.#serializeActorWrite(() => txActorUpdateInstanceHealth(this, instance)),
    updateInstanceMachine: (instance: TActorInstanceUpdateMachineArgs) => this.#serializeActorWrite(() => txActorUpdateInstanceMachine(this, instance)),
    getInstanceByElementId: (elementId: string) => fxActorGetInstanceByElementId(this, {elementId}),
    getInstanceById: (instanceId: string) => fxActorGetInstanceById(this, {instanceId}),
    deleteInstance: (id: string) => this.#serializeActorWrite(() => txActorDeleteInstance(this, { id })),
    listConnections: () => fxActorListConnections(this),
    insertConnection: (connection: TActorConnectionCreateArgs) => this.#serializeActorWrite(() => txActorInsertConnection(this, connection)),
    deleteConnectionById: (id: string) => this.#serializeActorWrite(() => txActorDeleteConnectionById(this, { id })),
    deleteConnectionBySource: (actorId: string) => this.#serializeActorWrite(() => txActorDeleteConnectionBySource(this, { actorId })),
  };
}
