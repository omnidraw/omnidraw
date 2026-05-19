import type { TActorConnection, TActorDefinition, TActorInstance, TCreateActorInstanceInput } from './contract';

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
  definition: Pick<TActorDefinition, 'machine_config'>;
}): string {
  if (args.input.machineState) return args.input.machineState;
  const initialState = args.definition.machine_config.initialState;
  return typeof initialState === 'string' && initialState.length > 0 ? initialState : 'idle';
}

export function fnGetInitialMachineContext(args: {
  input: Pick<TCreateActorInstanceInput, 'machineContext'>;
  definition: Pick<TActorDefinition, 'machine_config'>;
}): Record<string, unknown> {
  if (args.input.machineContext) return args.input.machineContext;
  const initialContext = args.definition.machine_config.initialContext;
  return initialContext && typeof initialContext === 'object' && !Array.isArray(initialContext)
    ? initialContext as Record<string, unknown>
    : {};
}

export function fnActorDefinitionWidgetInfo(args: Pick<TActorDefinition, 'widget_id' | 'widget_dir' | 'ui_manifest'>) {
  const uiManifest = fnToJsonRecord(args.ui_manifest);
  const widget = fnToJsonRecord(uiManifest.widget);
  const frontend = fnToJsonRecord(uiManifest.frontend);
  const element = fnToJsonRecord(frontend.element);
  const actor = fnToJsonRecord(element.actor);

  return {
    widgetId: args.widget_id,
    widgetDir: args.widget_dir,
    sourceDir: typeof widget.sourceDir === 'string' ? widget.sourceDir : undefined,
    frontend,
    initialPayload: fnToJsonRecord(element.initialPayload),
    actorUiProps: fnToJsonRecord(actor.uiProps),
  };
}

export function fnToActorDefinition(row: Omit<TActorDefinition, 'machine_schema' | 'machine_config' | 'contract_schema' | 'output_schema' | 'server_manifest' | 'ui_manifest' | 'widget'> & {
  machine_schema: unknown;
  machine_config: unknown;
  contract_schema: unknown;
  output_schema: unknown;
  server_manifest: unknown;
  ui_manifest: unknown;
}): TActorDefinition {
  const definition = {
    ...row,
    machine_schema: fnToJsonRecord(row.machine_schema),
    machine_config: fnToJsonRecord(row.machine_config),
    contract_schema: fnToJsonRecord(row.contract_schema),
    output_schema: fnToJsonRecord(row.output_schema),
    server_manifest: fnToJsonRecord(row.server_manifest),
    ui_manifest: fnToJsonRecord(row.ui_manifest),
  };

  return {
    ...definition,
    widget: fnActorDefinitionWidgetInfo(definition),
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
