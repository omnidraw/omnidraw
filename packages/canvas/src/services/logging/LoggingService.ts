import type { IService } from "@vibecanvas/runtime";
import { SyncHook } from "@vibecanvas/tapable";

export type TDebugLevel = 1 | 2 | 3;
export type TDebugTargetKind = "plugin" | "service";

export type TLoggingTarget = {
  kind: TDebugTargetKind;
  name: string;
};

export type TLoggingLogArgs = TLoggingTarget & {
  level: TDebugLevel;
  event: string;
  payload?: unknown;
};

export type TLoggingServiceArgs = {
  storage?: Pick<Storage, "getItem"> | null;
  console?: Pick<Console, "debug" | "warn" | "error">;
};

export interface TLoggingServiceHooks {
  configReload: SyncHook<[]>;
}

const DISABLED_LEVEL = 0;

/**
 * Canvas debug logger.
 * Reads per-target localStorage keys and keeps disabled checks cheap.
 */
export class LoggingService implements IService<TLoggingServiceHooks> {
  readonly name = "logging";
  readonly hooks: TLoggingServiceHooks = {
    configReload: new SyncHook(),
  };

  readonly storage: Pick<Storage, "getItem"> | null;
  readonly console: Pick<Console, "debug" | "warn" | "error">;

  #levelCache = new Map<string, TDebugLevel | typeof DISABLED_LEVEL>();
  #sequence = 0;

  constructor(args: TLoggingServiceArgs = {}) {
    this.storage = args.storage ?? getDefaultStorage();
    this.console = args.console ?? console;
  }

  getStorageKey(target: TLoggingTarget) {
    return `vibecanvas:debug:${target.kind}:${target.name}`;
  }

  getLevel(target: TLoggingTarget): TDebugLevel | typeof DISABLED_LEVEL {
    const key = this.getStorageKey(target);
    const cachedLevel = this.#levelCache.get(key);
    if (cachedLevel !== undefined) {
      return cachedLevel;
    }

    const level = parseDebugLevel(this.#readStorageValue(key));
    this.#levelCache.set(key, level);
    return level;
  }

  isEnabled(args: TLoggingTarget & { level?: TDebugLevel }) {
    const configuredLevel = this.getLevel(args);
    if (configuredLevel === DISABLED_LEVEL) {
      return false;
    }

    if (args.level === undefined) {
      return true;
    }

    return configuredLevel >= args.level;
  }

  log(args: TLoggingLogArgs) {
    if (!this.isEnabled(args)) {
      return;
    }

    this.console.debug(this.#formatPrefix(args), this.#createMeta(args), args.payload);
  }

  warn(args: TLoggingLogArgs) {
    if (!this.isEnabled(args)) {
      return;
    }

    this.console.warn(this.#formatPrefix(args), this.#createMeta(args), args.payload);
  }

  error(args: TLoggingLogArgs) {
    if (!this.isEnabled(args)) {
      return;
    }

    this.console.error(this.#formatPrefix(args), this.#createMeta(args), args.payload);
  }

  reloadConfig() {
    this.#levelCache.clear();
    this.hooks.configReload.call();
  }

  #readStorageValue(key: string) {
    if (this.storage === null) {
      return null;
    }

    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  #formatPrefix(args: TLoggingLogArgs) {
    return `[vibecanvas][${args.kind}:${args.name}][L${args.level}] ${args.event}`;
  }

  #createMeta(args: TLoggingLogArgs) {
    this.#sequence += 1;

    return {
      seq: this.#sequence,
      configuredLevel: this.getLevel(args),
      key: this.getStorageKey(args),
      target: `${args.kind}:${args.name}`,
      event: args.event,
      level: args.level,
      timestamp: new Date().toISOString(),
    };
  }
}

function getDefaultStorage(): Pick<Storage, "getItem"> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function parseDebugLevel(value: string | null): TDebugLevel | typeof DISABLED_LEVEL {
  if (value === null) {
    return DISABLED_LEVEL;
  }

  const normalizedValue = value.trim().toLowerCase();
  if (normalizedValue === "" || normalizedValue === "0" || normalizedValue === "false" || normalizedValue === "off") {
    return DISABLED_LEVEL;
  }

  if (normalizedValue === "true") {
    return 1;
  }

  if (normalizedValue === "1" || normalizedValue === "2" || normalizedValue === "3") {
    return Number(normalizedValue) as TDebugLevel;
  }

  return DISABLED_LEVEL;
}
