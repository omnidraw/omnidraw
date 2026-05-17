import type { TDrizzleDb } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import type * as schema from '@vibecanvas/service-db/schema';
import type { TWorkflowJson } from '@vibecanvas/service-workflow';

export type TActorDb = TDrizzleDb;
export type TActorTables = typeof schema;

export type TActorJson = TWorkflowJson;
export type TActorMessageName = string;
export type TActorEffectName = string;
export type TActorMachineState = string;

export type TActorTransitionConfig = {
  readonly target: string;
  readonly guard?: string;
  readonly actions?: readonly string[];
};

export type TActorStateConfig = {
  readonly entry?: readonly string[];
  readonly exit?: readonly string[];
  readonly on?: Record<string, TActorTransitionConfig>;
};

export type TActorMachineConfig = {
  readonly initialState?: string;
  readonly initialContext?: TActorJson;
  readonly states: Record<string, TActorStateConfig>;
};

export type TActorBundleManifest = {
  readonly entrypoint?: string;
  readonly modulePath?: string;
  readonly functionsPath?: string;
  readonly functions?: {
    readonly fns?: readonly string[];
    readonly fxs?: readonly string[];
    readonly txs?: readonly string[];
  };
  readonly files?: readonly { readonly path: string; readonly hash?: string; readonly fileId?: string }[];
};

export type TActorError = {
  readonly message: string;
  readonly code?: string;
  readonly stack?: string;
  readonly details?: Record<string, TActorJson>;
};

export type TActorDefinitionRow = typeof schema.actor_definitions.$inferSelect;
export type TActorInstanceRow = typeof schema.actor_instances.$inferSelect;
export type TActorConnectionRow = typeof schema.actor_connections.$inferSelect;
export type TActorInboxRow = typeof schema.actor_inbox.$inferSelect;
export type TActorOutputRow = typeof schema.actor_outputs.$inferSelect;

export type TActorMessage = {
  readonly name: TActorMessageName;
  readonly payload: TActorJson;
};

export type TActorOutput = {
  readonly name: TActorMessageName;
  readonly payload: TActorJson;
};

export type TActorEffectArgs = {
  readonly state: TActorMachineState;
  readonly context: TActorJson;
  readonly message: TActorMessage;
};

export type TActorTransitionPlan = {
  readonly changed: boolean;
  readonly targetState: TActorMachineState;
  readonly effectArgs: TActorEffectArgs;
  readonly guard?: TActorEffectName;
  readonly effects: readonly TActorEffectName[];
};

export type TActorRows = {
  readonly instance: TActorInstanceRow;
  readonly definition: TActorDefinitionRow;
};

export type TActorSupervisorStatus = {
  readonly polling: boolean;
  readonly lastError: string | null;
};
