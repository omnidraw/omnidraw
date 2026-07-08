import { afterEach, describe, expect, mock, test } from 'bun:test';
import { serveWithPortFallback } from '../src/plugins/server/ServerPlugin';

describe('serveWithPortFallback', () => {
  const originalWarn = console.warn;

  afterEach(() => {
    console.warn = originalWarn;
  });

  test('keeps the preferred port when it is available', () => {
    const serve = mock((port: number) => ({ port, stop() {} }) as ReturnType<typeof Bun.serve>);

    const server = serveWithPortFallback(serve, 7496);

    expect(serve).toHaveBeenCalledTimes(1);
    expect(serve).toHaveBeenCalledWith(7496);
    expect(server.port).toBe(7496);
  });

  test('retries the next port when the preferred port is busy', () => {
    const warn = mock(() => {});
    console.warn = warn;

    const serve = mock((port: number) => {
      if (port === 7496) throw new Error('busy');
      return { port, stop() {} } as ReturnType<typeof Bun.serve>;
    });

    const server = serveWithPortFallback(serve, 7496);

    expect(serve).toHaveBeenCalledTimes(2);
    expect(serve.mock.calls.map(([port]) => port)).toEqual([7496, 7497]);
    expect(server.port).toBe(7497);
    expect(warn).toHaveBeenCalledWith('[Server] Port 7496 is busy, using 7497');
  });

  test('retries from the dev default port when it is busy', () => {
    const warn = mock(() => {});
    console.warn = warn;

    const serve = mock((port: number) => {
      if (port === 3000) throw new Error('busy');
      return { port, stop() {} } as ReturnType<typeof Bun.serve>;
    });

    const server = serveWithPortFallback(serve, 3000);

    expect(serve).toHaveBeenCalledTimes(2);
    expect(serve.mock.calls.map(([port]) => port)).toEqual([3000, 3001]);
    expect(server.port).toBe(3001);
    expect(warn).toHaveBeenCalledWith('[Server] Port 3000 is busy, using 3001');
  });
});
