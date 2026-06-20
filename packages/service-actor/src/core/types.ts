export type TActorState =
  'booting' | `booting.${string}` |
  'ready' | `ready.${string}` |
  'busy' | `busy.${string}` |
  'waiting' | `waiting.${string}` |
  'error' | `error.${string}`

export type TInputMessage = `in.${string}`
export type TOutputMessage = `out.${string}`

export type TFunctionName = `fn.${string}` | `fx.${string}` | `tx.${string}`

export type TActorNonErrorState = Exclude<TActorState, 'error' | `error.${string}`>

export type TTransition = {
  func: TFunctionName[];
  allowedTargetStates: TActorNonErrorState[];
}

export type TActorStateConfig = {
  on: Partial<Record<TInputMessage, TTransition>>;
}

export type TVibecanvasActor = {
  readonly relFunctionPath: string;
  readonly initialState: TActorState;
  readonly initialData: Record<string, any>;
  readonly dataSchema?: TJsonSchema;
  readonly states: Partial<Record<TActorState, TActorStateConfig>>;
  readonly inputMsgSchema?: Record<TInputMessage, TJsonSchema>;
  readonly outputMsgSchema?: Record<TOutputMessage, TJsonSchema>;
}

export type TVibecanvasActorWidget = {
  readonly relWidgetDir: string;
  readonly tool: {
    readonly label: string;
    readonly icon?: string;
    readonly group?: string;
    readonly priority?: number;
    readonly behavior: {
      readonly type: "mode",
      readonly mode: "draw-create" | "click-create" | "select" | "hand"
    } | {
      readonly type: "action",
    } | {
      readonly type: "modal",
    }
  }
}

export type TVibecanvasJson = {
  readonly slug: string;
  readonly name: string;
  readonly url?: string;
  readonly version?: string;
  readonly description?: string;
  readonly actor: TVibecanvasActor;
  readonly widget: TVibecanvasActorWidget;
};

export type TFnPortal = {
  next: () => Promise<any>,
  emitMessage: (msg: any) => Promise<any>
}
export type TFnArgs<D = any, M = any> = {
  data: D;
  msg: M;
}
export type TFnFunc<D = any, M = any> = (portal: TFnPortal, args: TFnArgs<D, M>) => Promise<any>

export type TFxPortal = TFnPortal & {
  setData: (data: any) => Promise<any>,
}
export type TFxArgs<D = any, M = any> = TFnArgs<D, M>
export type TFxFunc<D = any, M = any> = (portal: TFxPortal, args: TFxArgs<D, M>) => Promise<any>

export type TTxPortal = TFxPortal & {}
export type TTxArgs<D = any, M = any> = TFnArgs<D, M>
export type TTxFunc<D = any, M = any> = (portal: TTxPortal, args: TTxArgs<D, M>) => Promise<any>

/** JSON Schema primitive type names supported by Vibecanvas actor ports. */
export type TJsonSchemaPrimitiveType = "null" | "boolean" | "object" | "array" | "number" | "string" | "integer";

/**
 * JSON Schema used for widget actor input/output payloads.
 *
 * Vibecanvas validates messages in the host before delivery. Guest widgets only
 * declare schemas; they do not need to bundle a validator.
 */
export type TJsonSchema = boolean | {
  $id?: string;
  $schema?: string;
  $ref?: string;
  /** Prefer `definitions` for draft-07 compatibility; `$defs` is allowed for newer drafts. */
  $defs?: Record<string, TJsonSchema>;
  /** Draft-07 reusable schema definitions. */
  definitions?: Record<string, TJsonSchema>;
  title?: string;
  description?: string;
  type?: TJsonSchemaPrimitiveType | TJsonSchemaPrimitiveType[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  examples?: unknown[];
  properties?: Record<string, TJsonSchema>;
  required?: string[];
  additionalProperties?: boolean | TJsonSchema;
  items?: TJsonSchema | TJsonSchema[];
  additionalItems?: boolean | TJsonSchema;
  prefixItems?: TJsonSchema[];
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  anyOf?: TJsonSchema[];
  oneOf?: TJsonSchema[];
  allOf?: TJsonSchema[];
  not?: TJsonSchema;
};
