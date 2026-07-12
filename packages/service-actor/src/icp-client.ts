/**
 * Used to inject for actor code run in new process to communicate with parent.
 */

import { parseArgs } from "node:util";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export type TFnPortal = {
  next: () => Promise<any>;
  emitMessage: (msg: any) => Promise<any>;
};
export type TFnArgs<D = any, M = any> = {
  data: D;
  msg: M;
};
export type TFnFunc<D = any, M = any> = (portal: TFnPortal, args: TFnArgs<D, M>) => Promise<any>;

type TResourceListOptions = {
  prefix?: string;
  cursor?: string;
  limit?: number;
};

type TKvResourceReadPortal = {
  get: <TValue = any>(key: string) => Promise<{ value: TValue; revision: number } | null>;
  has: (key: string) => Promise<boolean>;
  list: <TValue = any>(options?: TResourceListOptions) => Promise<{
    items: Array<{ key: string; value: TValue; revision: number }>;
    nextCursor?: string;
  }>;
};

type TKvResourceWritePortal = TKvResourceReadPortal & {
  set: <TValue = any>(args: { key: string; value: TValue }) => Promise<{ value: TValue; revision: number }>;
  delete: (key: string) => Promise<{ deleted: boolean }>;
  compareAndSet: <TValue = any>(args: {
    key: string;
    expectedRevision: number | null;
    value: TValue;
  }) => Promise<
    | { ok: true; entry: { value: TValue; revision: number } }
    | { ok: false; currentRevision: number | null }
  >;
};

type TSecretStoreResourceReadPortal = {
  get: (name: string) => Promise<{ value: string; revision: number } | null>;
  has: (name: string) => Promise<boolean>;
  list: (options?: TResourceListOptions) => Promise<{
    items: Array<{ name: string; revision: number; createdAt?: string; updatedAt?: string }>;
    nextCursor?: string;
  }>;
};

type TSecretStoreResourceWritePortal = TSecretStoreResourceReadPortal & {
  set: (args: { name: string; value: string }) => Promise<{ name: string; revision: number }>;
  delete: (name: string) => Promise<{ deleted: boolean }>;
  compareAndSet: (args: {
    name: string;
    expectedRevision: number | null;
    value: string;
  }) => Promise<
    | { ok: true; entry: { name: string; revision: number } }
    | { ok: false; currentRevision: number | null }
  >;
};

type TDbResourceReadPortal = {
  invoke: <TResult = any>(operation: string, parameters?: Record<string, any>) => Promise<TResult>;
  query: <TRow = Record<string, any>>(sql: string, parameters?: Record<string, any>) => Promise<TRow[]>;
};

type TDbResourceExecuteResult = {
  rowsAffected: number;
  lastInsertRowId?: bigint;
};

type TDbResourceExecuteOperation = {
  sql: string;
  parameters?: Record<string, any>;
};

type TDbResourceWritePortal = TDbResourceReadPortal & {
  execute: {
    (sql: string, parameters?: Record<string, any>): Promise<TDbResourceExecuteResult>;
    (operations: readonly TDbResourceExecuteOperation[]): Promise<readonly TDbResourceExecuteResult[]>;
  };
};

type TActorReadResources = {
  kv: (slot: string) => TKvResourceReadPortal;
  secretStore: (slot: string) => TSecretStoreResourceReadPortal;
  db: (slot: string) => TDbResourceReadPortal;
};

type TActorWriteResources = {
  kv: (slot: string) => TKvResourceWritePortal;
  secretStore: (slot: string) => TSecretStoreResourceWritePortal;
  db: (slot: string) => TDbResourceWritePortal;
};

export type TFxPortal = TFnPortal & {
  setData: (data: any) => Promise<any>;
  resources: TActorReadResources;
};
export type TFxArgs<D = any, M = any> = TFnArgs<D, M>;
export type TFxFunc<D = any, M = any> = (portal: TFxPortal, args: TFxArgs<D, M>) => Promise<any>;

export type TTxPortal = Omit<TFxPortal, "resources"> & {
  resources: TActorWriteResources;
};
export type TTxArgs<D = any, M = any> = TFnArgs<D, M>;
export type TTxFunc<D = any, M = any> = (portal: TTxPortal, args: TTxArgs<D, M>) => Promise<any>;

type TFunctionEntry =
  | { type: "fn"; func: TFnFunc }
  | { type: "fx"; func: TFxFunc }
  | { type: "tx"; func: TTxFunc };

type TParentRunMessage = {
  type: "run";
  id: number;
  func: string[];
  payload: unknown;
  data: any;
};

type TParentAckMessage = {
  type: "ack";
  id: number;
  action: "next" | "setData" | "emitMessage";
};

type TActorResourceKind = "kv" | "secretStore" | "db";

type TParentResourceResultMessage =
  | { type: "resourceResult"; callId: string; ok: true; result: unknown }
  | {
      type: "resourceResult";
      callId: string;
      ok: false;
      error: { code: string; message: string; details?: unknown };
    };

type TPendingResourceCall = {
  runId: number;
  resolve: (result: any) => void;
  reject: (error: Error) => void;
};

type TResourceCall = (
  runId: number,
  slot: string,
  kind: TActorResourceKind,
  operation: string,
  args: Record<string, unknown>,
) => Promise<any>;

class ActorResourceCallError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ActorResourceCallError";
    this.code = code;
    this.details = details;
  }
}

type TFunctionRegistry = {
  fn: { [key: string]: TFnFunc };
  fx: { [key: string]: TFxFunc };
  tx: { [key: string]: TTxFunc };
};

function serializeCloneableValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "undefined") return undefined;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol") return String(value);
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;

  if (typeof value !== "object") return String(value);

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (
    value instanceof Error ||
    ("message" in value && typeof value.message === "string" && "name" in value && typeof value.name === "string")
  ) {
    const errorLike = value as { name?: unknown; message?: unknown; stack?: unknown; code?: unknown };
    return {
      name: typeof errorLike.name === "string" ? errorLike.name : value.constructor.name,
      message: typeof errorLike.message === "string" ? errorLike.message : String(value),
      stack: typeof errorLike.stack === "string" ? errorLike.stack : undefined,
      code: typeof errorLike.code === "string" || typeof errorLike.code === "number" ? errorLike.code : undefined,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeCloneableValue(item, seen));
  }

  const record: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    try {
      record[key] = serializeCloneableValue((value as Record<string, unknown>)[key], seen);
    } catch (error) {
      record[key] = `[Unserializable: ${error instanceof Error ? error.message : String(error)}]`;
    }
  }
  return record;
}

function buildError(msg: unknown, id?: number) {
  return {
    type: "error",
    error: true,
    id,
    msg: serializeCloneableValue(msg),
  };
}

function sendIfConnected(message: Record<string, unknown>) {
  if (!process.send || process.connected === false) return;
  try {
    process.send(message);
  } catch {
    // The disconnect handler owns cancellation when the IPC channel closes mid-send.
  }
}

function findPackageRoot(startPath: string): string {
  let current = path.dirname(startPath);
  while (true) {
    if (existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return process.cwd();
    current = parent;
  }
}

function ensureSdkSubpathFallback(packageRoot: string, subpath: "actor" | "widget") {
  const sdkRoot = path.join(packageRoot, "node_modules", "@vibecanvas", "sdk");
  const distEntry = path.join(sdkRoot, "dist", `${subpath}.js`);
  if (!existsSync(distEntry)) return;

  const subpathDir = path.join(sdkRoot, subpath);
  const subpathEntry = path.join(subpathDir, "index.js");
  if (existsSync(subpathEntry)) return;

  mkdirSync(subpathDir, { recursive: true });
  writeFileSync(path.join(subpathDir, "package.json"), JSON.stringify({
    type: "module",
    main: "./index.js",
    types: "./index.d.ts",
  }, null, 2));
  writeFileSync(subpathEntry, `export * from "../dist/${subpath}.js";\n`);
  writeFileSync(path.join(subpathDir, "index.d.ts"), `export * from "../dist/${subpath}";\n`);
}

function ensureWidgetRuntimeResolution(functionPath: string) {
  const packageRoot = findPackageRoot(functionPath);
  ensureSdkSubpathFallback(packageRoot, "actor");
  ensureSdkSubpathFallback(packageRoot, "widget");
}

function validateFunctionGroup(value: unknown): value is Record<string, Function> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadFunctionRegistry(functionPath: string): TFunctionRegistry {
  ensureWidgetRuntimeResolution(functionPath);
  const mod = require(functionPath);
  const maybeFuncMap = mod.default ?? mod;

  if (typeof maybeFuncMap !== "object" || maybeFuncMap === null || Array.isArray(maybeFuncMap)) {
    throw new Error(`Actor function registry must export an object: ${functionPath}`);
  }

  const fn = "fn" in maybeFuncMap ? maybeFuncMap.fn : {};
  const fx = "fx" in maybeFuncMap ? maybeFuncMap.fx : {};
  const tx = "tx" in maybeFuncMap ? maybeFuncMap.tx : {};

  if (!validateFunctionGroup(fn) || !validateFunctionGroup(fx) || !validateFunctionGroup(tx)) {
    throw new Error("Actor function registry groups fn, fx, and tx must be objects when provided");
  }

  return {
    fn: fn as TFunctionRegistry["fn"],
    fx: fx as TFunctionRegistry["fx"],
    tx: tx as TFunctionRegistry["tx"],
  };
}

function getFn(funcMap: TFunctionRegistry, name: string): TFnFunc | null {
  return funcMap.fn[name] ?? null;
}

function getFx(funcMap: TFunctionRegistry, name: string): TFxFunc | null {
  return funcMap.fx[name] ?? null;
}

function getTx(funcMap: TFunctionRegistry, name: string): TTxFunc | null {
  return funcMap.tx[name] ?? null;
}

function validateIncomingMessage(message: unknown): TParentRunMessage | null {
  if (typeof message !== "object" || message === null) {
    process.send!(buildError("message must be object"));
    return null;
  }
  if (!("type" in message) || message.type !== "run") {
    return null;
  }
  if (!("id" in message) || typeof message.id !== "number") {
    process.send!(buildError("message.id is missing"));
    return null;
  }
  if (!("func" in message)) {
    process.send!(buildError("message.func is missing", message.id));
    return null;
  }
  if (!Array.isArray(message.func)) {
    process.send!(buildError("message.func must be string[]", message.id));
    return null;
  }
  if (!("payload" in message)) {
    process.send!(buildError("message.payload is missing", message.id));
    return null;
  }
  if (!("data" in message)) {
    process.send!(buildError("message.data is missing", message.id));
    return null;
  }

  return message as TParentRunMessage;
}

function buildFunctions(funcMap: TFunctionRegistry, func: string[]): TFunctionEntry[] | string {
  const functions: TFunctionEntry[] = [];
  let error: string | null = null;
  func.forEach((fName) => {
    const fn = getFn(funcMap, fName);
    if (fn) {
      functions.push({ type: "fn", func: fn });
      return;
    }
    const fx = getFx(funcMap, fName);
    if (fx) {
      functions.push({ type: "fx", func: fx });
      return;
    }
    const tx = getTx(funcMap, fName);
    if (tx) {
      functions.push({ type: "tx", func: tx });
      return;
    }
    error = `${fName} not registered as function`;
  });
  return error || functions;
}

function cancelledResourceCallError() {
  return new ActorResourceCallError(
    "RESOURCE_CALL_CANCELLED",
    "Actor resource call was cancelled because the IPC connection closed.",
  );
}

function createResourceCall(pendingResourceCalls: Map<string, TPendingResourceCall>): TResourceCall {
  let nextCallId = 1;

  return (runId, slot, kind, operation, args) => {
    const callId = `${runId}:${nextCallId++}`;

    const promise = new Promise<any>((resolve, reject) => {
      pendingResourceCalls.set(callId, { runId, resolve, reject });

      try {
        if (!process.send || process.connected === false) {
          throw cancelledResourceCallError();
        }
        process.send({ type: "resourceCall", id: runId, callId, slot, kind, operation, args });
      } catch {
        pendingResourceCalls.delete(callId);
        reject(cancelledResourceCallError());
      }
    });
    void promise.catch(() => undefined);
    return promise;
  };
}

function handleResourceResult(
  pendingResourceCalls: Map<string, TPendingResourceCall>,
  message: unknown,
): boolean {
  if (
    typeof message !== "object" ||
    message === null ||
    !("type" in message) ||
    message.type !== "resourceResult"
  ) {
    return false;
  }

  if (!("callId" in message) || typeof message.callId !== "string") return true;

  const pending = pendingResourceCalls.get(message.callId);
  if (!pending) return true;
  pendingResourceCalls.delete(message.callId);

  if ("ok" in message && message.ok === true) {
    pending.resolve("result" in message ? message.result : undefined);
    return true;
  }

  if (
    "ok" in message &&
    message.ok === false &&
    "error" in message &&
    typeof message.error === "object" &&
    message.error !== null &&
    "code" in message.error &&
    typeof message.error.code === "string" &&
    "message" in message.error &&
    typeof message.error.message === "string"
  ) {
    const resourceResult = message as TParentResourceResultMessage & { ok: false };
    pending.reject(new ActorResourceCallError(
      resourceResult.error.code,
      resourceResult.error.message,
      resourceResult.error.details,
    ));
    return true;
  }

  pending.reject(new ActorResourceCallError(
    "RESOURCE_PROVIDER_UNAVAILABLE",
    "Actor resource call received an invalid response.",
  ));
  return true;
}

function rejectPendingResourceCalls(pendingResourceCalls: Map<string, TPendingResourceCall>) {
  const error = cancelledResourceCallError();
  const pendingCalls = [...pendingResourceCalls.values()];
  pendingResourceCalls.clear();
  pendingCalls.forEach(({ reject }) => reject(error));
}

function rejectPendingResourceCallsForRun(
  pendingResourceCalls: Map<string, TPendingResourceCall>,
  runId: number,
) {
  const error = new ActorResourceCallError(
    "RESOURCE_CALL_CANCELLED",
    "Actor resource call was cancelled because its actor run completed.",
  );
  for (const [callId, pending] of pendingResourceCalls) {
    if (pending.runId !== runId) continue;
    pendingResourceCalls.delete(callId);
    pending.reject(error);
  }
}

function buildReadResources(call: (slot: string, kind: TActorResourceKind, operation: string, args: Record<string, unknown>) => Promise<any>): TActorReadResources {
  return {
    kv: (slot) => ({
      get: (key) => call(slot, "kv", "get", { key }),
      has: (key) => call(slot, "kv", "has", { key }),
      list: (options = {}) => call(slot, "kv", "list", options),
    }),
    secretStore: (slot) => ({
      get: (name) => call(slot, "secretStore", "get", { name }),
      has: (name) => call(slot, "secretStore", "has", { name }),
      list: (options = {}) => call(slot, "secretStore", "list", options),
    }),
    db: (slot) => ({
      invoke: (operation, parameters) => call(slot, "db", "invoke", { operation, parameters }),
      query: (sql, parameters) => call(slot, "db", "query", { sql, parameters }),
    }),
  };
}

function buildWriteResources(call: (slot: string, kind: TActorResourceKind, operation: string, args: Record<string, unknown>) => Promise<any>): TActorWriteResources {
  return {
    kv: (slot) => ({
      get: (key) => call(slot, "kv", "get", { key }),
      has: (key) => call(slot, "kv", "has", { key }),
      list: (options = {}) => call(slot, "kv", "list", options),
      set: (args) => call(slot, "kv", "set", args),
      delete: (key) => call(slot, "kv", "delete", { key }),
      compareAndSet: (args) => call(slot, "kv", "compareAndSet", args),
    }),
    secretStore: (slot) => ({
      get: (name) => call(slot, "secretStore", "get", { name }),
      has: (name) => call(slot, "secretStore", "has", { name }),
      list: (options = {}) => call(slot, "secretStore", "list", options),
      set: (args) => call(slot, "secretStore", "set", args),
      delete: (name) => call(slot, "secretStore", "delete", { name }),
      compareAndSet: (args) => call(slot, "secretStore", "compareAndSet", args),
    }),
    db: (slot) => ({
      invoke: (operation, parameters) => call(slot, "db", "invoke", { operation, parameters }),
      query: (sql, parameters) => call(slot, "db", "query", { sql, parameters }),
      execute: (sqlOrOperations: string | readonly TDbResourceExecuteOperation[], parameters?: Record<string, any>) => Array.isArray(sqlOrOperations)
        ? call(slot, "db", "execute", { operations: sqlOrOperations })
        : call(slot, "db", "execute", { sql: sqlOrOperations, parameters }),
    }),
  };
}

function waitForAck(pendingAck: Map<string, () => void>, id: number, action: TParentAckMessage["action"]) {
  return new Promise<void>((resolve) => {
    pendingAck.set(`${id}:${action}`, resolve);
  });
}

async function sendAndWaitForAck(
  pendingAck: Map<string, () => void>,
  id: number,
  action: TParentAckMessage["action"],
  message: Record<string, any>,
) {
  process.send!(message);
  await waitForAck(pendingAck, id, action);
}

function buildPortalActions(pendingAck: Map<string, () => void>, id: number, dataRef: { current: any }) {
  return {
    emitMessage: async (msg: any) => {
      await sendAndWaitForAck(pendingAck, id, "emitMessage", { type: "emitMessage", id, msg });
    },
    next: async () => {
      await sendAndWaitForAck(pendingAck, id, "next", { type: "next", id });
    },
    setData: async (data: any) => {
      dataRef.current = data;
      await sendAndWaitForAck(pendingAck, id, "setData", { type: "setData", id, data });
    },
  };
}

async function runMessage(
  funcMap: TFunctionRegistry,
  pendingAck: Map<string, () => void>,
  pendingResourceCalls: Map<string, TPendingResourceCall>,
  resourceCall: TResourceCall,
  message: TParentRunMessage,
) {
  const functions = buildFunctions(funcMap, message.func);
  if (typeof functions === "string") {
    process.send!(buildError(functions, message.id));
    return;
  }

  const functionEntries = functions;
  const dataRef = { current: message.data };
  const portalActions = buildPortalActions(pendingAck, message.id, dataRef);

  async function runFunctionAt(index: number): Promise<any> {
    const entry = functionEntries[index];
    if (!entry) return undefined;

    let didCallNext = false;
    const next = async () => {
      if (didCallNext) return undefined;
      didCallNext = true;
      await portalActions.next();
      return runFunctionAt(index + 1);
    };
    const callFromStep = (
      slot: string,
      kind: TActorResourceKind,
      operation: string,
      args: Record<string, unknown>,
    ) => {
      if (didCallNext) {
        return Promise.reject(new ActorResourceCallError(
          "RESOURCE_CALL_CANCELLED",
          "Actor resource calls cannot start after this function step calls next().",
        ));
      }
      return resourceCall(message.id, slot, kind, operation, args);
    };
    const functionArgs = { msg: message.payload, data: dataRef.current };

    if (entry.type === "fn") {
      return entry.func({
        emitMessage: portalActions.emitMessage,
        next,
      }, functionArgs);
    }

    if (entry.type === "fx") {
      return entry.func({
        emitMessage: portalActions.emitMessage,
        next,
        setData: portalActions.setData,
        resources: buildReadResources(callFromStep),
      }, functionArgs);
    }

    return entry.func({
      emitMessage: portalActions.emitMessage,
      next: async () => {
        return next();
      },
      setData: portalActions.setData,
      resources: buildWriteResources(callFromStep),
    }, functionArgs);
  }

  try {
    await runFunctionAt(0);
    sendIfConnected({ type: "done", id: message.id });
  } catch (error) {
    sendIfConnected(buildError(error, message.id));
  } finally {
    rejectPendingResourceCallsForRun(pendingResourceCalls, message.id);
  }
}

export async function runActorIpcClient(rawArgs = Bun.argv.slice(2)) {
  if (!process.send) {
    console.error("vibecanvas --icp-client must be launched by Vibecanvas via Bun.spawn({ ipc }).");
    process.exit(1);
  }

  const { values, positionals } = parseArgs({
    args: rawArgs,
    strict: true,
    allowPositionals: true,
    options: {
      "icp-client": { type: "boolean", default: false },
      debug: { type: "boolean", short: "d", default: false },
      functionPath: { type: "string" },
    },
  });

  if (!values.functionPath) {
    process.send(buildError("functionPath not set"));
    process.exit(1);
  }

  let funcMap: TFunctionRegistry;
  try {
    funcMap = loadFunctionRegistry(values.functionPath);
  } catch (error) {
    process.send(buildError(error));
    process.exit(1);
  }

  const pendingAck = new Map<string, () => void>();
  const pendingResourceCalls = new Map<string, TPendingResourceCall>();
  const resourceCall = createResourceCall(pendingResourceCalls);
  const disconnected = new Promise<void>((resolve) => {
    process.on("disconnect", () => {
      rejectPendingResourceCalls(pendingResourceCalls);
      resolve();
    });
  });

  process.stdin.resume();

  process.on("message", (message) => {
    if (handleResourceResult(pendingResourceCalls, message)) return;

    if (typeof message === "object" && message !== null && "type" in message && message.type === "ack") {
      const ack = message as TParentAckMessage;
      const key = `${ack.id}:${ack.action}`;
      const resolve = pendingAck.get(key);
      if (resolve) {
        pendingAck.delete(key);
        resolve();
      }
      return;
    }

    const valid = validateIncomingMessage(message);
    if (valid === null) return;
    void runMessage(funcMap, pendingAck, pendingResourceCalls, resourceCall, valid);
  });

  process.send({ type: "ready" });

  if (values.debug) {
    console.log("start icp client", values, positionals);
  }

  await disconnected;
}

if (import.meta.main) {
  await runActorIpcClient();
}
