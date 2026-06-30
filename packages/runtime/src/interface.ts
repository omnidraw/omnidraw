export interface IServiceMap { }

export interface IService<THooks extends object = object> {
  readonly name: string;
  readonly hooks?: THooks
}

export interface IServiceContext<
  THooks extends object = object,
  TConfig extends object = object,
> {
  hooks: THooks;
  config: TConfig;
}

export interface IStartableService<
  THooks extends object = object,
  TConfig extends object = object,
> {
  start(ctx: IServiceContext<THooks, TConfig>): void | Promise<void>;
}

export interface IStoppableService {
  stop(): void | Promise<void>;
}

export interface IEventSource<TEvent = unknown> {
  subscribe(listener: (event: TEvent) => void): () => void;
}

export type IServiceRegistration = {
  name: string;
  startOrder: number;
  service: IService;
};

export interface IServiceRegistry {
  getStore(): Map<string, IService>;
  getRegistrations(): IServiceRegistration[];
  provide<K extends keyof IServiceMap>(name: K, startOrder: number, impl: IServiceMap[K]): void;
  get<K extends keyof IServiceMap>(name: K): IServiceMap[K] | undefined;
  require<K extends keyof IServiceMap>(name: K): IServiceMap[K];
}

export interface IPluginContext<
  TRequiredServices extends Partial<IServiceMap> = IServiceMap,
  THooks extends object = object,
  TConfig extends object = object,
> {
  hooks: THooks;
  services: Omit<IServiceRegistry, 'require'> & {
    get<K extends keyof IServiceMap>(name: K): IServiceMap[K] | undefined;
    require<K extends keyof TRequiredServices>(name: K): TRequiredServices[K];
  };
  config: TConfig;
}

export interface IPlugin<
  TRequiredServices extends Partial<IServiceMap> = {},
  THooks extends object = object,
  TConfig extends object = object,
> {
  name: string;
  after?: string[];
  apply(ctx: IPluginContext<TRequiredServices, THooks, TConfig>): void | Promise<void>;
}
