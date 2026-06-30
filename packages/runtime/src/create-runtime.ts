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

  return {
    async boot() {
      const registrations = this.services
        .getRegistrations()
        .sort((a, b) => a.startOrder - b.startOrder || a.name.localeCompare(b.name));

      for (const { service } of registrations) {
        if (service && 'start' in service) {
          await (service.start as (ctx: IServiceContext<THooks, TConfig>) => Promise<void>)({ config, hooks });
        }
      }
      for (const plugin of sorted) await plugin.apply(ctx);
      await boot?.(ctx);
    },
    async shutdown() {
      const registrations = this.services
        .getRegistrations()
        .sort((a, b) => b.startOrder - a.startOrder || a.name.localeCompare(b.name));

      let shutdownError: unknown;

      try {
        await shutdown?.(ctx);
      } catch (error) {
        shutdownError = error;
      }

      try {
        for (const { service } of registrations) {
          if (service && 'stop' in service) {
            await (service.stop as () => Promise<void>)();
          }
        }
      } catch (error) {
        throw shutdownError ?? error;
      }

      if (shutdownError) throw shutdownError;
    },
    services,
    hooks,
  };
}
