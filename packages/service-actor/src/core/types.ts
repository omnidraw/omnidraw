import type { ActorDb } from '@vibecanvas/service-db/ActorDb';
import type { TActorConnection, TActorDefinition, TActorInbox, TActorInstance, TActorOutput as TActorOutputRow } from '@vibecanvas/service-db/model';
import type { TWorkflowJson } from '@vibecanvas/service-workflow';

export type TActorDb = ActorDb;

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

export type TActorDefinitionRow = TActorDefinition;
export type TActorInstanceRow = TActorInstance;
export type TActorConnectionRow = TActorConnection;
export type TActorInboxRow = TActorInbox;
export type { TActorOutputRow };

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
