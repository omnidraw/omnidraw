import { describe, expect, mock, test } from 'bun:test';
import { createCliHooks } from '../src/hooks';
import { createPtyPlugin } from '../src/plugins/pty/PtyPlugin';
import type { ICliConfig } from '../src/config';
import type { IPtyService } from '@vibecanvas/service-pty/IPtyService';
import { fnResolveVibecanvasHome } from '@vibecanvas/shared-functions/vibecanvas-config/fn.resolve-vibecanvas-home';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import { join, resolve } from 'node:path';

const TEST_TENANT = Object.freeze({
  orgId: 'org-test',
  accountId: 'account-test',
  cellId: 'cell-test',
  placementEpoch: 1,
  roles: Object.freeze(['owner']),
  capabilities: Object.freeze(['pty']),
  requestId: 'request-1',
}) satisfies TTenantContext;

type TMockSocket = WebSocket & {
  data?: {
    path: string;
    query: string;
    requestId: string;
    tenant: TTenantContext;
  };
  readyState: number;
  send: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
};

function createConfig(overrides?: Partial<ICliConfig>): ICliConfig {
  const home = fnResolveVibecanvasHome({ join, resolve }, {
    cwd: '/tmp',
    dataDir: '/tmp/vibecanvas-home',
    env: {},
    homedir: '/tmp',
  });

  return {
    cwd: process.cwd(),
    dev: true,
    compiled: false,
    version: '0.0.0',
    command: 'serve',
    rawArgv: ['bun', 'run'],
    argv: [],
    port: 3000,
    home,
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
      tenant: TEST_TENANT,
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
    const attach = mock((tenant: Parameters<IPtyService['attach']>[0], args: Parameters<IPtyService['attach']>[1]) => {
      expect(tenant).toBe(TEST_TENANT);
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

    const socket = createSocket('/api/pty/pty-1/connect', '?workingDirectory=workspace%2Fdemo&cursor=12');
    hooks.wsOpen.call(socket as unknown as WebSocket);

    expect(attach).toHaveBeenCalledTimes(1);
    expect(attach.mock.calls[0]?.[1]).toMatchObject({
      workingDirectory: 'workspace/demo',
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
