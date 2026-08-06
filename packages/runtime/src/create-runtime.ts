import type { IPlugin, IPluginContext, IService, IServiceContext, IServiceMap, IServiceRegistration, IServiceRegistry } from './interface';

type TSortable = { name: string; after?: string[] };

export function topoSort<T extends TSortable>(items: T[]): T[] {
  const byName = new Map<string, T>();
  for (const item of items) {
    if (byName.has(item.name)) throw new Error(`Duplicate name: "${item.name}"`);
    byName.set(item.name, item);
  }

  const sorted: T[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(item: T) {
    if (visited.has(item.name)) return;
    if (visiting.has(item.name)) throw new Error(`Circular dependency: "${item.name}"`);

    visiting.add(item.name);
    for (const rawDep of item.after ?? []) {
      const optional = rawDep.endsWith('?');
      const depName = optional ? rawDep.slice(0, -1) : rawDep;
      const dep = byName.get(depName);

      if (!dep && !optional) throw new Error(`Missing dependency: "${depName}" required by "${item.name}"`);
      if (dep) visit(dep);
    }
    visiting.delete(item.name);
    visited.add(item.name);
    sorted.push(item);
  }

  for (const item of items) visit(item);
  return sorted;
}

export function createServiceRegistry(): IServiceRegistry {
  const store = new Map<string, IService>();
  const registrations = new Map<string, IServiceRegistration>();

  return {
    getStore() {
      return store;
    },
    getRegistrations() {
      return [...registrations.values()];
    },
    provide<K extends keyof IServiceMap>(name: K, startOrder: number, impl: IServiceMap[K]) {
      const registration: IServiceRegistration = {
        name: name as string,
        startOrder,
        service: impl as IService,
      };

      store.set(name as string, impl as IService);
      registrations.set(name as string, registration);
    },
    get<K extends keyof IServiceMap>(name: K): IServiceMap[K] | undefined {
      return store.get(name as string) as IServiceMap[K] | undefined;
    },
    require<K extends keyof IServiceMap>(name: K): IServiceMap[K] {
      const impl = store.get(name as string);
      if (impl === undefined) throw new Error(`Service "${String(name)}" not provided`);
      return impl as IServiceMap[K];
    },
  };
}

export type IRuntime<THooks extends object = object> = {
  boot(): Promise<void>;
  shutdown(): Promise<void>;
  services: IServiceRegistry;
  hooks: THooks;
};

type TRuntimeOptions<THooks extends object, TConfig extends object> = {
  plugins: IPlugin<any, THooks, TConfig>[];
  config: TConfig;
  hooks: THooks;
  services?: IServiceRegistry;
  boot?: (ctx: IPluginContext<IServiceMap, THooks, TConfig>) => Promise<void>;
  shutdown?: (ctx: IPluginContext<IServiceMap, THooks, TConfig>) => Promise<void>;
};

export function createRuntime<THooks extends object, TConfig extends object>({
  plugins,
  config,
  hooks,
  services = createServiceRegistry(),
  boot,
  shutdown,
}: TRuntimeOptions<THooks, TConfig>): IRuntime<THooks> {
  const sorted = topoSort(plugins);
  const ctx: IPluginContext<IServiceMap, THooks, TConfig> = { hooks, services, config };
  const startedRegistrations: IServiceRegistration[] = [];
  let pluginsApplied = false;
  let bootCallbackEntered = false;
  let shutdownCallbackCompleted = false;
  let state: 'idle' | 'booting' | 'running' | 'stopping' | 'stopped' | 'failed' = 'idle';
  let shutdownPromise: Promise<void> | null = null;

  const stopStartedServices = async (): Promise<unknown[]> => {
    const failures: unknown[] = [];
    for (let index = startedRegistrations.length - 1; index >= 0; index -= 1) {
      const registration = startedRegistrations[index]!;
      const stop = 'stop' in registration.service
        ? registration.service.stop
        : undefined;
      try {
        if (typeof stop === 'function') {
          await (stop as () => void | Promise<void>).call(registration.service);
        }
        startedRegistrations.splice(index, 1);
      } catch (error) {
        failures.push(error);
      }
    }
    return failures;
  };

  const runShutdownCallback = async (): Promise<unknown | null> => {
    if (!bootCallbackEntered || shutdownCallbackCompleted || !shutdown) return null;
    try {
      await shutdown(ctx);
      shutdownCallbackCompleted = true;
      return null;
    } catch (error) {
      return error;
    }
  };

  return {
    async boot() {
      if (state !== 'idle') {
        throw new Error(`Runtime cannot boot from state '${state}'.`);
      }
      state = 'booting';
      try {
        for (const plugin of sorted) await plugin.apply(ctx);
        pluginsApplied = true;

        const registrations = services
          .getRegistrations()
          .sort((a, b) => a.startOrder - b.startOrder || a.name.localeCompare(b.name));

        for (const registration of registrations) {
          const { service } = registration;
          startedRegistrations.push(registration);
          const start = service && 'start' in service ? service.start : undefined;
          if (typeof start === 'function') {
            await (start as (ctx: IServiceContext<THooks, TConfig>) => void | Promise<void>)
              .call(service, { config, hooks });
          }
        }

        bootCallbackEntered = true;
        await boot?.(ctx);
        state = 'running';
      } catch (error) {
        const failures: unknown[] = [error];
        const shutdownFailure = await runShutdownCallback();
        if (shutdownFailure !== null) failures.push(shutdownFailure);
        failures.push(...await stopStartedServices());
        state = 'failed';
        if (failures.length === 1) throw error;
        throw new AggregateError(failures, 'Runtime boot and cleanup failed.');
      }
    },
    shutdown() {
      if (state === 'stopped') return Promise.resolve();
      if (state === 'idle') {
        state = 'stopped';
        return Promise.resolve();
      }
      // A second concurrent/overlapping shutdown call (e.g. SIGINT then a
      // SIGTERM escalation) joins the in-flight shutdown instead of
      // throwing on an already-'stopping' state.
      if (state === 'stopping' && shutdownPromise) return shutdownPromise;
      if (state === 'booting') {
        return Promise.reject(new Error(`Runtime cannot shutdown from state '${state}'.`));
      }
      state = 'stopping';

      shutdownPromise = (async () => {
        const failures: unknown[] = [];
        if (pluginsApplied) {
          const shutdownFailure = await runShutdownCallback();
          if (shutdownFailure !== null) failures.push(shutdownFailure);
        }
        failures.push(...await stopStartedServices());

        if (failures.length > 0) {
          state = 'failed';
          throw failures[0];
        }
        if (startedRegistrations.length > 0 || !shutdownCallbackCompleted && bootCallbackEntered && shutdown) {
          state = 'failed';
          throw new Error('Runtime shutdown did not release every started lifecycle.');
        }
        state = 'stopped';
      })();
      return shutdownPromise;
    },
    services,
    hooks,
  };
}
