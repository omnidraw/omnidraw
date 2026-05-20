import type { TActorConnection, TActorDefinition, TActorInstance, TActorListItem, TCreateActorInstanceInput } from './contract';

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

export function fnToJsonRecordMap(value: unknown): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(fnToJsonRecord(value)).map(([key, item]) => [key, fnToJsonRecord(item)]),
  );
}

export function fnToActorDefinitionStates(value: unknown): TActorDefinition['actor']['states'] {
  return Object.fromEntries(
    Object.entries(fnToJsonRecord(value)).map(([stateName, stateValue]) => {
      const state = fnToJsonRecord(stateValue);
      const on = Object.fromEntries(
        Object.entries(fnToJsonRecord(state.on)).flatMap(([eventName, transitionValue]) => {
          const transition = fnToJsonRecord(transitionValue);
          return typeof transition.target === 'string'
            ? [[eventName, {
              target: transition.target,
              guard: typeof transition.guard === 'string' ? transition.guard : undefined,
              actions: Array.isArray(transition.actions) ? transition.actions.filter((item): item is string => typeof item === 'string') : undefined,
            }]]
            : [];
        }),
      );

      return [stateName, {
        entry: Array.isArray(state.entry) ? state.entry.filter((item): item is string => typeof item === 'string') : undefined,
        exit: Array.isArray(state.exit) ? state.exit.filter((item): item is string => typeof item === 'string') : undefined,
        on: Object.keys(on).length > 0 ? on : undefined,
      }];
    }),
  );
}

export function fnGetInitialMachineState(args: {
  input: Pick<TCreateActorInstanceInput, 'machineState'>;
  definition: Pick<TActorDefinition, 'actor'>;
}): string {
  if (args.input.machineState) return args.input.machineState;
  return args.definition.actor.initialState.length > 0 ? args.definition.actor.initialState : 'idle';
}

export function fnGetInitialMachineContext(args: {
  input: Pick<TCreateActorInstanceInput, 'machineContext'>;
  definition: Pick<TActorDefinition, 'actor'>;
}): Record<string, unknown> {
  if (args.input.machineContext) return args.input.machineContext;
  const initialContext = args.definition.actor.initialContext;
  return initialContext && typeof initialContext === 'object' && !Array.isArray(initialContext)
    ? initialContext as Record<string, unknown>
    : {};
}

type TActorDefinitionRow = {
  id: string;
  name: string;
  slug: string;
  version: number;
  description: string | null;
  functions_path: string;
  machine_config: unknown;
  input_schema: unknown;
  output_schema: unknown;
  widget_config: unknown;
  created_at: Date;
  updated_at: Date;
};

export function fnActorDefinitionTool(args: Pick<TActorDefinitionRow, 'name' | 'widget_config'>): TActorListItem['tool'] {
  const widget = fnToJsonRecord(args.widget_config);
  const tool = fnToJsonRecord(widget.tool);
  const behavior = fnToJsonRecord(tool.behavior);
  const mode = behavior.mode;

  return {
    label: typeof tool.label === 'string' ? tool.label : args.name,
    icon: typeof tool.icon === 'string' ? tool.icon : undefined,
    shortcuts: Array.isArray(tool.shortcuts) ? tool.shortcuts.filter((item): item is string => typeof item === 'string') : undefined,
    group: typeof tool.group === 'string' ? tool.group : undefined,
    priority: typeof tool.priority === 'number' ? tool.priority : undefined,
    behavior: behavior.type === 'mode' && (mode === 'draw-create' || mode === 'click-create' || mode === 'select' || mode === 'hand')
      ? { type: 'mode', mode }
      : behavior.type === 'action'
        ? { type: 'action' }
        : behavior.type === 'modal'
          ? { type: 'modal' }
          : { type: 'mode', mode: 'draw-create' },
  };
}

export function fnToActorListItem(row: TActorDefinitionRow): TActorListItem {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    version: row.version,
    description: row.description,
    tool: fnActorDefinitionTool(row),
  };
}

export function fnToActorDefinition(row: TActorDefinitionRow): TActorDefinition {
  const machineConfig = fnToJsonRecord(row.machine_config);
  const initialState = machineConfig.initialState;

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    version: row.version,
    description: row.description,
    actor: {
      functionsPath: row.functions_path,
      initialState: typeof initialState === 'string' && initialState.length > 0 ? initialState : 'idle',
      initialContext: machineConfig.initialContext,
      states: fnToActorDefinitionStates(machineConfig.states),
      inputSchema: fnToJsonRecordMap(row.input_schema),
      outputSchema: fnToJsonRecordMap(row.output_schema),
    },
    widget: {
      tool: fnActorDefinitionTool(row),
      sourceFiles: {},
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function fnWithActorDefinitionSourceFiles(args: { definition: TActorDefinition; sourceFiles: Record<string, string> }): TActorDefinition {
  return {
    ...args.definition,
    widget: {
      ...args.definition.widget,
      sourceFiles: args.sourceFiles,
    },
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
