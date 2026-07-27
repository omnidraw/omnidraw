import { describe, expect, test } from 'bun:test';
import { createRuntime, createServiceRegistry, topoSort } from '../src';
import type { IPlugin } from '../src';

describe('topoSort', () => {
  test('sorts plugins based on after dependencies', () => {
    const sorted = topoSort([
      { name: 'api', after: ['db'] },
      { name: 'ui', after: ['api'] },
      { name: 'db' },
    ]);

    expect(sorted.map((item) => item.name)).toEqual(['db', 'api', 'ui']);
  });

  test('supports optional dependencies when present or absent', () => {
    const absent = topoSort([
      { name: 'feature', after: ['optional?'] },
      { name: 'base' },
    ]);
    expect(absent.map((item) => item.name)).toEqual(['feature', 'base']);

    const present = topoSort([
      { name: 'feature', after: ['optional?'] },
      { name: 'base' },
      { name: 'optional' },
    ]);
    expect(present.map((item) => item.name)).toEqual(['optional', 'feature', 'base']);
  });

  test('throws for duplicate names', () => {
    expect(() => topoSort([{ name: 'db' }, { name: 'db' }])).toThrow('Duplicate name: "db"');
  });

  test('throws for missing required dependencies', () => {
    expect(() => topoSort([{ name: 'api', after: ['db'] }])).toThrow(
      'Missing dependency: "db" required by "api"',
    );
  });

  test('throws for circular dependencies', () => {
    expect(() =>
      topoSort([
        { name: 'a', after: ['b'] },
        { name: 'b', after: ['a'] },
      ]),
    ).toThrow('Circular dependency: "a"');
  });
});

describe('createServiceRegistry', () => {
  test('provides, gets, and requires services from the same backing store', () => {
    const registry = createServiceRegistry();
    const service = { name: 'logger' } as any;

    registry.provide('logger' as never, 10, service);

    expect(registry.getStore().get('logger')).toBe(service);
    expect(registry.get('logger' as never)).toBe(service);
    expect(registry.require('logger' as never)).toBe(service);
  });

  test('returns undefined for missing get and throws for missing require', () => {
    const registry = createServiceRegistry();

    expect(registry.get('missing' as never)).toBeUndefined();
    expect(() => registry.require('missing' as never)).toThrow('Service "missing" not provided');
  });
});

describe('createRuntime', () => {
  test('applies plugins before capturing and starting services, then runs boot callback', async () => {
    const calls: string[] = [];
    const hooks = { ready: true };
    const config = { mode: 'test' };

    const plugins: IPlugin<any, typeof hooks, typeof config>[] = [
      {
        name: 'api',
        after: ['db'],
        async apply(ctx) {
          calls.push(`plugin:${this.name}`);
          expect(ctx.hooks).toBe(hooks);
          expect(ctx.config).toBe(config);
          ctx.services.provide('db' as never, 10, {
            name: 'db-service',
            start() {
              calls.push('start:db');
            },
          } as never);
        },
      },
      {
        name: 'db',
        apply(ctx) {
          calls.push(`plugin:${this.name}`);
          expect(ctx.services.get('db' as never)).toBeUndefined();
        },
      },
    ];

    const runtime = createRuntime({
      plugins,
      hooks,
      config,
      boot: async (ctx) => {
        calls.push('boot');
        expect(ctx.hooks).toBe(hooks);
        expect(ctx.config).toBe(config);
        expect(ctx.services.require('db' as never)).toMatchObject({ name: 'db-service' });
      },
    });

    expect(runtime.hooks).toBe(hooks);
    expect(runtime.services).toBeDefined();

    await runtime.boot();

    expect(calls).toEqual(['plugin:db', 'plugin:api', 'start:db', 'boot']);
  });

  test('uses provided service registry and runs shutdown callback', async () => {
    const services = createServiceRegistry();
    const calls: string[] = [];
    const hooks = {};
    const config = {};

    const runtime = createRuntime({
      plugins: [
        {
          name: 'provider',
          apply(ctx) {
            ctx.services.provide('custom' as never, 10, { name: 'custom-service' } as never);
          },
        },
      ],
      hooks,
      config,
      services,
      shutdown: async (ctx) => {
        calls.push('shutdown');
        expect(ctx.services.require('custom' as never)).toEqual({ name: 'custom-service' });
      },
    });

    expect(runtime.services).toBe(services);

    await runtime.boot();
    await runtime.shutdown();

    expect(calls).toEqual(['shutdown']);
  });

  test('runs shutdown callback before stopping services', async () => {
    const services = createServiceRegistry();
    const calls: string[] = [];

    services.provide('custom' as never, 10, {
      name: 'custom-service',
      async stop() {
        calls.push('stop');
      },
    } as never);

    const runtime = createRuntime({
      plugins: [],
      hooks: {},
      config: {},
      services,
      shutdown: async () => {
        calls.push('shutdown');
      },
    });

    await runtime.boot();
    await runtime.shutdown();

    expect(calls).toEqual(['shutdown', 'stop']);
  });

  test('still stops services if shutdown callback throws', async () => {
    const services = createServiceRegistry();
    const calls: string[] = [];

    services.provide('custom' as never, 10, {
      name: 'custom-service',
      async stop() {
        calls.push('stop');
      },
    } as never);

    const runtime = createRuntime({
      plugins: [],
      hooks: {},
      config: {},
      services,
      shutdown: async () => {
        calls.push('shutdown');
        throw new Error('shutdown failed');
      },
    });

    await runtime.boot();
    await expect(runtime.shutdown()).rejects.toThrow('shutdown failed');

    expect(calls).toEqual(['shutdown', 'stop']);
  });

  test('continues stopping lower-order services and retains the first stop error', async () => {
    const services = createServiceRegistry();
    const calls: string[] = [];
    const firstFailure = new Error('high-order stop failed');

    services.provide('high' as never, 30, {
      name: 'high',
      async stop() {
        calls.push('high');
        throw firstFailure;
      },
    } as never);
    services.provide('middle' as never, 20, {
      name: 'middle',
      async stop() {
        calls.push('middle');
      },
    } as never);
    services.provide('low' as never, 10, {
      name: 'low',
      async stop() {
        calls.push('low');
        throw new Error('low-order stop failed');
      },
    } as never);

    const runtime = createRuntime({ plugins: [], hooks: {}, config: {}, services });

    await runtime.boot();
    await expect(runtime.shutdown()).rejects.toBe(firstFailure);
    expect(calls).toEqual(['high', 'middle', 'low']);
  });

  test('retains shutdown callback error precedence while all services stop', async () => {
    const services = createServiceRegistry();
    const calls: string[] = [];
    const shutdownFailure = new Error('shutdown callback failed');

    services.provide('high' as never, 20, {
      name: 'high',
      async stop() {
        calls.push('high');
        throw new Error('service stop failed');
      },
    } as never);
    services.provide('low' as never, 10, {
      name: 'low',
      async stop() {
        calls.push('low');
      },
    } as never);

    const runtime = createRuntime({
      plugins: [],
      hooks: {},
      config: {},
      services,
      shutdown: async () => {
        calls.push('shutdown');
        throw shutdownFailure;
      },
    });

    await runtime.boot();
    await expect(runtime.shutdown()).rejects.toBe(shutdownFailure);
    expect(calls).toEqual(['shutdown', 'high', 'low']);
  });

  test('rolls back each attempted service exactly once after startup fails', async () => {
    const services = createServiceRegistry();
    const calls: string[] = [];
    const startupFailure = new Error('middle failed');

    services.provide('low' as never, 10, {
      name: 'low',
      start() {
        calls.push('start:low');
      },
      stop() {
        calls.push('stop:low');
      },
    } as never);
    services.provide('middle' as never, 20, {
      name: 'middle',
      start() {
        calls.push('start:middle');
        throw startupFailure;
      },
      stop() {
        calls.push('stop:middle');
      },
    } as never);
    services.provide('high' as never, 30, {
      name: 'high',
      start() {
        calls.push('start:high');
      },
      stop() {
        calls.push('stop:high');
      },
    } as never);

    const runtime = createRuntime({ plugins: [], hooks: {}, config: {}, services });

    await expect(runtime.boot()).rejects.toBe(startupFailure);
    expect(calls).toEqual(['start:low', 'start:middle', 'stop:middle', 'stop:low']);
    await runtime.shutdown();
    expect(calls).toEqual(['start:low', 'start:middle', 'stop:middle', 'stop:low']);
  });

  test('does not stop a service registered after the startup snapshot', async () => {
    const services = createServiceRegistry();
    const calls: string[] = [];
    const runtime = createRuntime({
      plugins: [],
      hooks: {},
      config: {},
      services,
      boot: async (ctx) => {
        ctx.services.provide('late' as never, 10, {
          name: 'late',
          stop() {
            calls.push('stop:late');
          },
        } as never);
      },
    });

    await runtime.boot();
    await runtime.shutdown();

    expect(calls).toEqual([]);
  });

  test('does not start or stop registry services when plugin application fails', async () => {
    const services = createServiceRegistry();
    const calls: string[] = [];
    services.provide('service' as never, 10, {
      name: 'service',
      start() {
        calls.push('start');
      },
      stop() {
        calls.push('stop');
      },
    } as never);
    const pluginFailure = new Error('plugin failed');
    const runtime = createRuntime({
      plugins: [{
        name: 'broken',
        apply() {
          throw pluginFailure;
        },
      }],
      hooks: {},
      config: {},
      services,
    });

    await expect(runtime.boot()).rejects.toBe(pluginFailure);
    await runtime.shutdown();
    expect(calls).toEqual([]);
  });

  test('stops each started service at most once across repeated shutdown', async () => {
    const services = createServiceRegistry();
    let stopCount = 0;
    services.provide('service' as never, 10, {
      name: 'service',
      stop() {
        stopCount += 1;
      },
    } as never);
    const runtime = createRuntime({ plugins: [], hooks: {}, config: {}, services });

    await runtime.boot();
    await runtime.shutdown();
    await runtime.shutdown();

    expect(stopCount).toBe(1);
  });

  test('runs application cleanup and stops started services when the boot callback fails', async () => {
    const services = createServiceRegistry();
    const calls: string[] = [];
    const bootFailure = new Error('application boot failed');
    services.provide('service' as never, 10, {
      name: 'service',
      start() {
        calls.push('start');
      },
      stop() {
        calls.push('stop');
      },
    } as never);
    const runtime = createRuntime({
      plugins: [],
      hooks: {},
      config: {},
      services,
      boot: async () => {
        calls.push('boot');
        throw bootFailure;
      },
      shutdown: async () => {
        calls.push('shutdown');
      },
    });

    await expect(runtime.boot()).rejects.toBe(bootFailure);
    expect(calls).toEqual(['start', 'boot', 'shutdown', 'stop']);
    await runtime.shutdown();
    expect(calls).toEqual(['start', 'boot', 'shutdown', 'stop']);
  });
});
