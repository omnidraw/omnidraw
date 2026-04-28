import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
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
 * Describes one output port this widget actor can send messages from.
 *
 * Use either a JSON Schema directly or an object with a label and schema.
 */
type TVibecanvasActorOutputDefinition =
  | TVibecanvasActorSchema
  | {
    /** Human-readable label shown in Vibecanvas connection UI. */
    label?: string;
    /** JSON Schema for payloads sent by this output port. */
    schema?: TVibecanvasActorSchema;
  };

/** Declares this widget instance as a connectable actor. */
type TVibecanvasActorDefinition = {
  /** Human-readable actor name shown in development/debug UI. */
  name?: string;
  /** Input ports this widget can receive messages on. */
  inputs?: Record<string, TVibecanvasActorInputDefinition>;
  /** Output ports this widget can send messages from. */
  outputs?: Record<string, TVibecanvasActorOutputDefinition>;
};

/** Handles a message delivered to an actor input port. */
type TVibecanvasActorHandler<TPayload = unknown> = (payload: TPayload) => void | Promise<void>;

/** Message sent by a widget actor output port. */
type TVibecanvasActorOutputMessage = {
  /** Output port name. */
  output: string;
  /** JSON-serializable payload. */
  payload?: unknown;
};

/** Actor instance returned by defineActor(). */
type TVibecanvasActor = {
  /** Registers an input handler imperatively. */
  receive<TPayload = unknown>(input: string, handler: TVibecanvasActorHandler<TPayload>): () => void;
  /** Sends a message from an output port to the Vibecanvas host router. */
  send(output: string, payload?: unknown): void;
};

/** Host callbacks used by Vibecanvas to observe a widget actor. */
type TVibecanvasActorRuntimePortal = {
  /** Called whenever defineActor() updates metadata. */
  onDefinition?: (definition: TVibecanvasActorDefinition) => void;
  /** Called whenever actor.send() sends an output message. */
  onSend?: (message: TVibecanvasActorOutputMessage) => void;
};

/** Internal runtime wrapper used by the host and tests. */
type TVibecanvasActorRuntime = {
  /** Defines actor metadata and connectable input/output ports, then returns the actor instance. */
  defineActor(definition: TVibecanvasActorDefinition): TVibecanvasActor;
  /** Delivers a host-routed message to an input port. */
  deliverActor(input: string, payload?: unknown): Promise<number>;
  /** Returns the current actor definition. */
  getActorDefinition(): TVibecanvasActorDefinition | null;
};

const ajv = new Ajv({ allErrors: true, strict: false });

function formatValidationErrors(errors: ErrorObject[] | null | undefined) {
  if (!errors || errors.length === 0) return "payload did not match schema";

  return errors.map((error) => {
    const path = error.instancePath || "/";
    return `${path} ${error.message ?? "is invalid"}`;
  }).join("; ");
}

function isOutputSchemaObject(value: unknown): value is { schema?: TVibecanvasActorSchema } {
  return typeof value === "object" && value !== null && "schema" in value;
}

function compileSchema(schema: TVibecanvasActorSchema | undefined): ValidateFunction | null {
  if (schema === undefined) return null;
  return ajv.compile(schema);
}

function getOutputSchema(definition: TVibecanvasActorOutputDefinition | undefined): TVibecanvasActorSchema | undefined {
  if (definition === undefined) return undefined;
  if (isOutputSchemaObject(definition)) return definition.schema;
  return definition;
}

function createActorRuntime(portal: TVibecanvasActorRuntimePortal = {}): TVibecanvasActorRuntime {
  let definition: TVibecanvasActorDefinition | null = null;
  const handlers = new Map<string, Set<TVibecanvasActorHandler>>();
  const inputValidators = new Map<string, ValidateFunction>();
  const outputValidators = new Map<string, ValidateFunction>();

  function receive<TPayload = unknown>(input: string, handler: TVibecanvasActorHandler<TPayload>) {
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

  function send(output: string, payload?: unknown) {
    const validate = outputValidators.get(output);
    if (validate && !validate(payload)) {
      throw new Error(`Actor output "${output}" schema mismatch: ${formatValidationErrors(validate.errors)}`);
    }

    portal.onSend?.({ output, payload });
  }

  const actor: TVibecanvasActor = {
    receive,
    send,
  };

  function defineActor(nextDefinition: TVibecanvasActorDefinition) {
    definition = nextDefinition;
    inputValidators.clear();
    outputValidators.clear();
    portal.onDefinition?.(nextDefinition);

    Object.entries(nextDefinition.inputs ?? {}).forEach(([input, inputDefinition]) => {
      const validate = compileSchema(inputDefinition.schema);
      if (validate) inputValidators.set(input, validate);
      if (!inputDefinition.handle) return;
      receive(input, inputDefinition.handle);
    });

    Object.entries(nextDefinition.outputs ?? {}).forEach(([output, outputDefinition]) => {
      const validate = compileSchema(getOutputSchema(outputDefinition));
      if (validate) outputValidators.set(output, validate);
    });

    return actor;
  }

  async function deliverActor(input: string, payload?: unknown) {
    const validate = inputValidators.get(input);
    if (validate && !validate(payload)) {
      return 0;
    }

    const inputHandlers = [...(handlers.get(input) ?? [])];
    await Promise.all(inputHandlers.map((handler) => handler(payload)));
    return inputHandlers.length;
  }

  function getActorDefinition() {
    return definition;
  }

  return {
    defineActor,
    deliverActor,
    getActorDefinition,
  };
}

const actorRuntime = createActorRuntime();

/**
 * Defines actor metadata and connectable input/output ports, then returns the actor instance.
 *
 * Call once near the top of your widget `main.ts`.
 *
 * @example
 * const actor = defineActor({
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
 *
 * actor.send("todoCreated", { title: "Ship it" });
 */
function defineActor(definition: TVibecanvasActorDefinition) {
  return actorRuntime.defineActor(definition);
}

export { createActorRuntime, defineActor };
export type {
  TVibecanvasActor,
  TVibecanvasActorDefinition,
  TVibecanvasActorHandler,
  TVibecanvasActorInputDefinition,
  TVibecanvasActorOutputDefinition,
  TVibecanvasActorOutputMessage,
  TVibecanvasActorRuntime,
  TVibecanvasActorRuntimePortal,
  TVibecanvasActorSchema,
};
