import type { TJsonSchema } from "./schema";

/** JSON Schema used to validate actor input and output payloads. */
type TVibecanvasActorSchema = TJsonSchema;

/**
 * Describes one input port that this widget actor can receive messages on.
 *
 * @template TPayload Payload type expected by the input handler.
 */
type TVibecanvasActorInputDefinition<TPayload = unknown> = {
  /** Human-readable label shown in Vibecanvas connection UI. */
  label?: string;
  /** JSON Schema for payloads accepted by this input port. */
  schema?: TVibecanvasActorSchema;
  /** Called when another widget sends a message to this input port. */
  handle?: (payload: TPayload) => void | Promise<void>;
};

/**
 * Describes one output port this widget actor can emit messages from.
 *
 * Use either a JSON Schema directly or an object with a label and schema.
 */
type TVibecanvasActorOutputDefinition =
  | TVibecanvasActorSchema
  | {
    /** Human-readable label shown in Vibecanvas connection UI. */
    label?: string;
    /** JSON Schema for payloads emitted by this output port. */
    schema?: TVibecanvasActorSchema;
  };

/** Declares this widget instance as a connectable actor. */
type TVibecanvasActorDefinition = {
  /** Human-readable actor name shown in development/debug UI. */
  name?: string;
  /** Input ports this widget can receive messages on. */
  inputs?: Record<string, TVibecanvasActorInputDefinition>;
  /** Output ports this widget can emit messages from. */
  outputs?: Record<string, TVibecanvasActorOutputDefinition>;
};

/** Handles a message delivered to an actor input port. */
type TVibecanvasActorHandler<TPayload = unknown> = (payload: TPayload) => void | Promise<void>;

/** Message emitted by a widget actor output port. */
type TVibecanvasActorOutputMessage = {
  /** Output port name. */
  output: string;
  /** JSON-serializable payload. */
  payload?: unknown;
};

/** Host callbacks used by Vibecanvas to observe a widget actor. */
type TVibecanvasActorRuntimePortal = {
  /** Called whenever defineActor() updates metadata. */
  onDefinition?: (definition: TVibecanvasActorDefinition) => void;
  /** Called whenever emitActor() emits an output message. */
  onEmit?: (message: TVibecanvasActorOutputMessage) => void;
};

/** Internal runtime wrapper used by the host and tests. */
type TVibecanvasActorRuntime = {
  /** Defines actor metadata and connectable input/output ports. */
  defineActor(definition: TVibecanvasActorDefinition): void;
  /** Registers an input handler imperatively. */
  onActor<TPayload = unknown>(input: string, handler: TVibecanvasActorHandler<TPayload>): () => void;
  /** Emits a message from an output port. */
  emitActor(output: string, payload?: unknown): void;
  /** Delivers a host-routed message to an input port. */
  deliverActor(input: string, payload?: unknown): Promise<number>;
  /** Returns the current actor definition. */
  getActorDefinition(): TVibecanvasActorDefinition | null;
};

function createActorRuntime(portal: TVibecanvasActorRuntimePortal = {}): TVibecanvasActorRuntime {
  let definition: TVibecanvasActorDefinition | null = null;
  const handlers = new Map<string, Set<TVibecanvasActorHandler>>();

  function defineActor(nextDefinition: TVibecanvasActorDefinition) {
    definition = nextDefinition;
    portal.onDefinition?.(nextDefinition);

    Object.entries(nextDefinition.inputs ?? {}).forEach(([input, inputDefinition]) => {
      if (!inputDefinition.handle) return;
      const inputHandlers = handlers.get(input) ?? new Set<TVibecanvasActorHandler>();
      inputHandlers.add(inputDefinition.handle);
      handlers.set(input, inputHandlers);
    });
  }

  function onActor<TPayload = unknown>(input: string, handler: TVibecanvasActorHandler<TPayload>) {
    const inputHandlers = handlers.get(input) ?? new Set<TVibecanvasActorHandler>();
    inputHandlers.add(handler as TVibecanvasActorHandler);
    handlers.set(input, inputHandlers);

    return () => {
      inputHandlers.delete(handler as TVibecanvasActorHandler);
      if (inputHandlers.size === 0) {
        handlers.delete(input);
      }
    };
  }

  function emitActor(output: string, payload?: unknown) {
    portal.onEmit?.({ output, payload });
  }

  async function deliverActor(input: string, payload?: unknown) {
    const inputHandlers = [...(handlers.get(input) ?? [])];
    await Promise.all(inputHandlers.map((handler) => handler(payload)));
    return inputHandlers.length;
  }

  function getActorDefinition() {
    return definition;
  }

  return {
    defineActor,
    onActor,
    emitActor,
    deliverActor,
    getActorDefinition,
  };
}

const actorRuntime = createActorRuntime();

/**
 * Defines actor metadata and connectable input/output ports.
 *
 * Call once near the top of your widget `main.ts`.
 *
 * @example
 * defineActor({
 *   name: "Todo App",
 *   inputs: {
 *     addTodo: {
 *       schema: {
 *         type: "object",
 *         properties: { title: { type: "string" } },
 *         required: ["title"],
 *         additionalProperties: false,
 *       },
 *       handle(payload) {
 *         // update widget state
 *       },
 *     },
 *   },
 *   outputs: {
 *     todoCreated: {
 *       label: "Todo Created",
 *       schema: { type: "object" },
 *     },
 *   },
 * });
 */
function defineActor(definition: TVibecanvasActorDefinition) {
  actorRuntime.defineActor(definition);
}

/**
 * Registers an input handler imperatively.
 *
 * Prefer `defineActor({ inputs: { ... } })` for static port metadata.
 * Use `onActor()` when registering a handler conditionally.
 *
 * @returns Cleanup function that unregisters the handler.
 */
function onActor<TPayload = unknown>(input: string, handler: TVibecanvasActorHandler<TPayload>) {
  return actorRuntime.onActor(input, handler);
}

/**
 * Emits a message from an output port.
 *
 * Vibecanvas routes this payload to other connected widget actors.
 * The output name should match a key declared under `outputs`.
 */
function emitActor(output: string, payload?: unknown) {
  actorRuntime.emitActor(output, payload);
}

export { createActorRuntime, defineActor, emitActor, onActor };
export type {
  TVibecanvasActorDefinition,
  TVibecanvasActorHandler,
  TVibecanvasActorInputDefinition,
  TVibecanvasActorOutputDefinition,
  TVibecanvasActorOutputMessage,
  TVibecanvasActorRuntime,
  TVibecanvasActorRuntimePortal,
  TVibecanvasActorSchema,
};
