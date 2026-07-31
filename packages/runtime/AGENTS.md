# @omnidraw/runtime

Shared plugin runtime primitives for Omnidraw apps.

## Purpose

Use this package for the **generic runtime composition layer**:
- plugin interfaces
- service registry
- plugin ordering (`topoSort`)
- runtime assembly (`createRuntime`)

Do **not** use this package for app-specific hook bags or lifecycle semantics.

## What belongs here

- `IPlugin<TRequiredServices, THooks>`
- `IPluginContext<TRequiredServices, THooks>`
- `IServiceRegistry`
- `IServiceMap` for declaration merging
- base service capability interfaces:
  - `IService`
  - `IStartableService`
  - `IStoppableService`
  - `IManagedService`
  - `IEventSource<T>`
- `createServiceRegistry()`
- `topoSort()`
- `createRuntime()`

## What does NOT belong here

### Not hook primitives
Those belong in `@omnidraw/tapable`.

Examples that do **not** belong here:
- `SyncHook`
- `AsyncSeriesHook`
- `AsyncWaterfallHook`

### Not app-specific hook bags
These should live in the consuming app/runtime.

Examples:
- `ICliHooks`
- `ICanvasHooks`
- `createCliHooks()`
- `bootCliRuntime()`

### Not plugin implementations
Concrete plugins belong in the app or feature package.

Examples:
- `DbPlugin`
- `ApiPlugin`
- `NetworkPlugin`

## Core concepts

### Plugin
A plugin is a **wiring/composition unit**.

Plugins:
- have `name`
- may declare ordering with `after`
- use `apply(ctx)`
- register hooks
- provide services
- consume other services

Plugins are responsible for composition, not for being the service themselves.

### Service
A service is a **runtime capability**.

Services:
- may hold state
- usually expose methods
- may optionally expose lifecycle (`start` / `stop`)
- may optionally expose events (`subscribe`)

Services should **not** have plugin concepts like:
- `after`
- `apply`
- plugin ordering metadata

## Service model

Keep the base service model small and capability-based.

### Base interfaces

```ts
interface IService {
  readonly name: string
}

interface IStartableService {
  start(): void | Promise<void>
}

interface IStoppableService {
  stop(): void | Promise<void>
}

interface IManagedService extends IService, IStartableService, IStoppableService {}

interface IEventSource<TEvent = unknown> {
  subscribe(listener: (event: TEvent) => void): () => void
}
```

Not every service must implement all of these.

## Recommended usage

### 1. Define app hooks in the app

Example in `apps/cli`:

```ts
type ICliHooks = {
  boot: AsyncSeriesHook<[]>
  shutdown: AsyncSeriesHook<[]>
}
```

### 2. Define app-local plugin aliases

This makes plugin authoring much nicer.

```ts
type ICliPlugin<TRequired = {}> = IPlugin<TRequired, ICliHooks>
type IClIPluginContext<TRequired = {}> = IPluginContext<TRequired, ICliHooks>
```

### 3. Extend `IServiceMap` with declaration merging

```ts
declare module '@omnidraw/runtime' {
  interface IServiceMap {
    db: DbServiceTurso
    api: IApiService
  }
}
```

### 4. Create runtime with injected lifecycle strategy

`createRuntime()` is intentionally generic. The app provides:
- hook bag
- plugins
- config
- lifecycle behavior (`boot`, `shutdown`)

```ts
const runtime = createRuntime({
  plugins,
  hooks: createCliHooks(),
  config,
  boot: bootCliRuntime,
  shutdown: shutdownCliRuntime,
})
```

## Ordering rules

Use `after` only for plugin ordering.

Examples:
- `ApiPlugin` after `db`
- `NetworkPlugin` after `api`

Optional deps use `?`:

```ts
after: ['notification?']
```

## Design rules

1. Keep this package generic.
2. Do not hardcode CLI/server/canvas hooks here.
3. Do not put concrete services or plugins here.
4. Prefer capability interfaces over one large mandatory `IService`.
5. Services are runtime values; plugins are composition logic.
6. If a concept depends on hook primitives only, prefer `@omnidraw/tapable`.
7. If a concept depends on plugins + services + runtime assembly, it belongs here.

## Current known examples

- `@omnidraw/service-db` uses this package for service capability typing.
- `apps/cli` uses this package for generic runtime assembly and keeps CLI hooks local.

## Refactor note

We are currently in a refactor.

Canvas is moving from an old plugin-context model to a service-first runtime model.
Old canvas code had one big local context bag with things like:
- stage
- camera
- state
- capabilities
- app integrations
- hook bag

This is being split into small services and new runtime plugins.
Old code is still kept as reference during migration.
Do not assume old and new canvas systems are both final.

### New direction

Use this pattern:
- runtime hooks = broad lifecycle/app wiring
- service hooks = domain-specific events owned by a service
- services = effectful stateful interfaces
- plugins = logic and composition that call services

Examples:
- runtime hooks: `init`, `initAsync`, `destroy`
- service hooks: `camera.hooks.change`, `konva.hooks.resize`

### Principles for next agents

1. Prefer services as the main effectful interface.
2. Prefer small focused services over one giant state service.
3. Prefer service-local hooks over global app hooks when event is service-specific.
4. Keep `@omnidraw/runtime` generic. No canvas-specific hook bags here.
5. It is okay for `IService` to support optional typed hooks at interface level.
6. Runtime plugins should depend on services, not on one giant mutable context object.
7. During migration, read old canvas plugins/services for behavior, then translate behavior into the new service-first shape.

### Canvas migration shape

Current emerging canvas service split looks like:
- `konva` = stage, layers, resize
- `camera` = x/y/zoom, pan/zoom ops, camera change hook
- `theme` = theme state
- `selection` = mode, selection, focused id
- `editor` = transient editing state

More services will likely follow:
- `history`
- `crdt`
- `renderOrder`
- `hostedWidgets`
- `shapeRegistry`
- `groupRegistry`
- app integration services like `notification`, `image`, `file`, `terminal`

### Important migration warning

If you see both:
- old global runtime hook usage like `cameraChange`
- new service-local hook usage like `camera.hooks.change`

prefer the new service-local direction unless there is a strong reason not to.

Goal is boring shape:
- generic runtime here
- concrete service logic in app/package
- plugins thin
- services clear
