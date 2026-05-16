import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import type { TJsonSchema } from "./schema";

type TActorJson = null | boolean | number | string | TActorJson[] | { [key: string]: TActorJson };

type TVibecanvasActorHandlerArgs<TContext = Record<string, TActorJson>, TInput = Record<string, TActorJson>> = {
  state: string;
  context: TContext;
  input: TInput;
};

type TVibecanvasActorHandlerResult<TContext = Record<string, TActorJson>> = {
  state?: string;
  context?: TContext;
  outputs?: Array<{ name: string; payload?: TActorJson }>;
};

type TVibecanvasActorHandler<TContext = Record<string, TActorJson>, TInput = Record<string, TActorJson>> = (
  args: TVibecanvasActorHandlerArgs<TContext, TInput>,
) => TVibecanvasActorHandlerResult<TContext> | Promise<TVibecanvasActorHandlerResult<TContext>>;

type TVibecanvasActorOutputMessage = {
  output: string;
  payload?: unknown;
};

type TVibecanvasActorRuntimePortal = {
  onDefinition?: (definition: unknown) => void;
  onSend?: (message: TVibecanvasActorOutputMessage) => void;
};

type TVibecanvasActorDefinition<TContext = Record<string, TActorJson>> = {
  slug: string;
  name: string;
  version: string;
  description?: string;
  initialState: string;
  initialContext: TContext;
  inputSchema?: Record<string, TJsonSchema>;
  outputSchema?: Record<string, TJsonSchema>;
  on: Record<string, TVibecanvasActorHandler<TContext, Record<string, TActorJson>>>;
};

type TVibecanvasDefinedActor<TContext = Record<string, TActorJson>> = TVibecanvasActorDefinition<TContext> & {
  manifest: {
    slug: string;
    name: string;
    version: string;
    description?: string;
    inputSchema: Record<string, TJsonSchema>;
    outputSchema: Record<string, TJsonSchema>;
  };
};

const ajv = new Ajv({ allErrors: true, strict: false });

function formatValidationErrors(errors: ErrorObject[] | null | undefined) {
  if (!errors || errors.length === 0) return "payload did not match schema";
  return errors.map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`).join("; ");
}

function compileSchema(schema: TJsonSchema | undefined): ValidateFunction | null {
  if (schema === undefined) return null;
  return ajv.compile(schema);
}

function getOutputSchema(definition: unknown): TJsonSchema | undefined {
  if (!definition) return undefined;
  if (typeof definition === "object" && "schema" in definition) return (definition as { schema?: TJsonSchema }).schema;
  return definition as TJsonSchema;
}

function createActorRuntime(portal: TVibecanvasActorRuntimePortal = {}) {
  let definition: any = null;
  const handlers = new Map<string, Set<(payload?: unknown) => void | Promise<void>>>();
  const inputValidators = new Map<string, ValidateFunction>();
  const outputValidators = new Map<string, ValidateFunction>();

  function receive(input: string, handler: (payload?: unknown) => void | Promise<void>) {
    const inputHandlers = handlers.get(input) ?? new Set<(payload?: unknown) => void | Promise<void>>();
    inputHandlers.add(handler);
    handlers.set(input, inputHandlers);
    return () => {
      inputHandlers.delete(handler);
      if (inputHandlers.size === 0) handlers.delete(input);
    };
  }

  function send(output: string, payload?: unknown) {
    const validate = outputValidators.get(output);
    if (validate && !validate(payload)) {
      throw new Error(`Actor output "${output}" schema mismatch: ${formatValidationErrors(validate.errors)}`);
    }
    portal.onSend?.({ output, payload });
  }

  function defineRuntimeActor(nextDefinition: any) {
    definition = nextDefinition;
    inputValidators.clear();
    outputValidators.clear();
    portal.onDefinition?.(nextDefinition);

    Object.entries(nextDefinition.inputs ?? {}).forEach(([input, inputDefinition]) => {
      const entry = inputDefinition as { schema?: TJsonSchema; handle?: (payload?: unknown) => void | Promise<void> };
      const validate = compileSchema(entry.schema);
      if (validate) inputValidators.set(input, validate);
      if (entry.handle) receive(input, entry.handle);
    });

    Object.entries(nextDefinition.outputs ?? {}).forEach(([output, outputDefinition]) => {
      const validate = compileSchema(getOutputSchema(outputDefinition));
      if (validate) outputValidators.set(output, validate);
    });

    return { receive, send };
  }

  async function deliverActor(input: string, payload?: unknown) {
    const validate = inputValidators.get(input);
    if (validate && !validate(payload)) return 0;
    const inputHandlers = [...(handlers.get(input) ?? [])];
    await Promise.all(inputHandlers.map((handler) => handler(payload)));
    return inputHandlers.length;
  }

  return {
    defineActor: defineRuntimeActor,
    deliverActor,
    getActorDefinition: () => definition,
  };
}

function defineActor<TContext = Record<string, TActorJson>>(definition: TVibecanvasActorDefinition<TContext>): TVibecanvasDefinedActor<TContext> {
  return {
    ...definition,
    manifest: {
      slug: definition.slug,
      name: definition.name,
      version: definition.version,
      description: definition.description,
      inputSchema: definition.inputSchema ?? {},
      outputSchema: definition.outputSchema ?? {},
    },
  };
}

function normalizeActorHandlerResult<TContext>(args: {
  previousState: string;
  previousContext: TContext;
  result: TVibecanvasActorHandlerResult<TContext> | null | undefined;
}) {
  return {
    state: args.result?.state ?? args.previousState,
    context: args.result?.context ?? args.previousContext,
    outputs: args.result?.outputs ?? [],
  };
}

export { createActorRuntime, defineActor, normalizeActorHandlerResult };
export type {
  TActorJson,
  TVibecanvasActorDefinition,
  TVibecanvasActorHandler,
  TVibecanvasActorHandlerArgs,
  TVibecanvasActorHandlerResult,
  TVibecanvasActorOutputMessage,
  TVibecanvasActorRuntimePortal,
  TVibecanvasDefinedActor,
};
