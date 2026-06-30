import { describe, expect, mock, test } from 'bun:test';
import { createCliHooks } from '../src/hooks';
import { createPtyPlugin } from '../src/plugins/pty/PtyPlugin';
import type { ICliConfig } from '../src/config';
import type { IPtyService } from '@vibecanvas/service-pty/IPtyService';

type TMockSocket = WebSocket & {
  data?: {
    path: string;
    query: string;
    requestId: string;
  };
  readyState: number;
  send: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
};

function createConfig(overrides?: Partial<ICliConfig>): ICliConfig {
  return {
    cwd: process.cwd(),
    dev: true,
    compiled: false,
    version: '0.0.0',
    command: 'serve',
    rawArgv: ['bun', 'run'],
    argv: [],
    port: 3000,
    dataPath: '/tmp/vibecanvas-data',
    dbPath: '/tmp/vibecanvas.turso'  ,
    configPath: '/tmp/vibecanvas.json',
    cachePath: '/tmp/vibecanvas-cache',
    helpRequested: false,
    versionRequested: false,
    ...overrides,
  };
}

function createSocket(path: string, query = ''): TMockSocket {
  return {
    data: {
      path,
      query,
      requestId: 'request-1',
    },
    readyState: WebSocket.OPEN,
    send: mock(() => undefined),
    close: mock(() => undefined),
  } as unknown as TMockSocket;
}

describe('createPtyPlugin', () => {
  test('claims native PTY websocket upgrade paths', async () => {
    const hooks = createCliHooks();
    const plugin = createPtyPlugin();
    const requirePty = mock(() => ({ name: 'pty', attach: mock(() => null) }) satisfies Partial<IPtyService>);

    await plugin.apply({
      hooks,
      config: createConfig(),
      services: { require: requirePty },
    } as any);

    const claim = hooks.wsUpgrade.call(new Request('http://localhost/api/pty/abc/connect'));
    const ignore = hooks.wsUpgrade.call(new Request('http://localhost/api'));

    expect(claim).toBe(true);
    expect(ignore).toBe(false);
  });

  test('attaches PTY sockets, forwards messages, and detaches on close', async () => {
    const hooks = createCliHooks();
    const plugin = createPtyPlugin();
    const attachment = {
      send: mock(() => undefined),
      detach: mock(() => undefined),
    };
    const attach = mock((args: Parameters<IPtyService['attach']>[0]) => {
      args.send(new TextEncoder().encode('hello-from-pty'));
      return attachment;
    });

    await plugin.apply({
      hooks,
      config: createConfig(),
      services: {
        require: mock(() => ({ name: 'pty', attach })),
      },
    } as any);

    const socket = createSocket('/api/pty/pty-1/connect', '?workingDirectory=%2Ftmp%2Fdemo&cursor=12');
    hooks.wsOpen.call(socket as unknown as WebSocket);

    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0]?.[0]).toMatchObject({
      workingDirectory: '/tmp/demo',
      ptyID: 'pty-1',
      cursor: 12,
    });
    expect(socket.send).toHaveBeenCalledTimes(1);

    hooks.wsMessage.call(socket as unknown as WebSocket, 'ls -la\n');
    expect(attachment.send).toHaveBeenCalledWith('ls -la\n');

    hooks.wsClose.call(socket as unknown as WebSocket);
    expect(attachment.detach).toHaveBeenCalledTimes(1);
  });

  test('closes the socket when workingDirectory is missing', async () => {
    const hooks = createCliHooks();
    const plugin = createPtyPlugin();
    const attach = mock(() => null);

    await plugin.apply({
      hooks,
      config: createConfig(),
      services: {
        require: mock(() => ({ name: 'pty', attach })),
      },
    } as any);

    const socket = createSocket('/api/pty/pty-1/connect');
    hooks.wsOpen.call(socket as unknown as WebSocket);

    expect(attach).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledWith(1008, 'Missing workingDirectory');
  });

  test('is inert outside serve mode', async () => {
    const hooks = createCliHooks();
    const plugin = createPtyPlugin();
    const requirePty = mock(() => {
      throw new Error('should not require pty');
    });

    await plugin.apply({
      hooks,
      config: createConfig({ command: 'upgrade' }),
      services: { require: requirePty },
    } as any);

    const claim = hooks.wsUpgrade.call(new Request('http://localhost/api/pty/abc/connect'));
    expect(claim).toBe(false);
    expect(requirePty).not.toHaveBeenCalled();
  });
});
