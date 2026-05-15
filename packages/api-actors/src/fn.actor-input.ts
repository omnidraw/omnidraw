import type { TActorConnection, TActorDefinition, TActorInstance, TActorRevision, TCreateActorInstanceInput, TRegisterActorRevisionInput } from './contract';

export function fnNormalizeJsonRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return value ?? {};
}

export function fnToJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function fnToStringArrayOrNull(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === 'string');
}

export function fnGetInitialMachineState(args: {
  input: Pick<TCreateActorInstanceInput, 'machineState'>;
  revision: Pick<TActorRevision, 'machine_config'>;
}): string {
  if (args.input.machineState) return args.input.machineState;
  const initialState = args.revision.machine_config.initialState;
  return typeof initialState === 'string' && initialState.length > 0 ? initialState : 'idle';
}

export function fnGetInitialMachineContext(args: {
  input: Pick<TCreateActorInstanceInput, 'machineContext'>;
  revision: Pick<TActorRevision, 'machine_config'>;
}): Record<string, unknown> {
  if (args.input.machineContext) return args.input.machineContext;
  const initialContext = args.revision.machine_config.initialContext;
  return initialContext && typeof initialContext === 'object' && !Array.isArray(initialContext)
    ? initialContext as Record<string, unknown>
    : {};
}

export function fnToActorDefinition(row: TActorDefinition): TActorDefinition {
  return row;
}

export function fnToActorRevision(row: Omit<TActorRevision, 'machine_schema' | 'machine_config' | 'contract_schema' | 'output_schema' | 'server_manifest' | 'ui_manifest'> & {
  machine_schema: unknown;
  machine_config: unknown;
  contract_schema: unknown;
  output_schema: unknown;
  server_manifest: unknown;
  ui_manifest: unknown;
}): TActorRevision {
  return {
    ...row,
    machine_schema: fnToJsonRecord(row.machine_schema),
    machine_config: fnToJsonRecord(row.machine_config),
    contract_schema: fnToJsonRecord(row.contract_schema),
    output_schema: fnToJsonRecord(row.output_schema),
    server_manifest: fnToJsonRecord(row.server_manifest),
    ui_manifest: fnToJsonRecord(row.ui_manifest),
  };
}

export function fnToActorInstance(row: Omit<TActorInstance, 'machine_context'> & { machine_context: unknown }): TActorInstance {
  return {
    ...row,
    machine_context: fnToJsonRecord(row.machine_context),
  };
}

export function fnToActorConnection(row: Omit<TActorConnection, 'event_name_whitelist' | 'style'> & { event_name_whitelist: unknown; style: unknown }): TActorConnection {
  return {
    ...row,
    event_name_whitelist: fnToStringArrayOrNull(row.event_name_whitelist),
    style: fnToJsonRecord(row.style),
  };
}

export function fnNormalizeRegisterActorRevisionInput(input: TRegisterActorRevisionInput) {
  return {
    ...input,
    description: input.description ?? null,
    parentRevisionId: input.parentRevisionId ?? null,
    machineSchema: fnNormalizeJsonRecord(input.machineSchema),
    contractSchema: fnNormalizeJsonRecord(input.contractSchema),
    outputSchema: fnNormalizeJsonRecord(input.outputSchema),
    serverManifest: fnNormalizeJsonRecord(input.serverManifest),
    uiManifest: fnNormalizeJsonRecord(input.uiManifest),
    serverBundleFileId: input.serverBundleFileId ?? null,
    uiBundleFileId: input.uiBundleFileId ?? null,
    sourceArchiveFileId: input.sourceArchiveFileId ?? null,
  };
}
