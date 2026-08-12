import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fnResolveOmnidrawHome } from '@omnidraw/shared-functions/omnidraw-config/fn.resolve-omnidraw-home';
import type { ICliConfig } from '../src/config';
import { setupServices } from '../src/setup-services';
import type { TAgentBashProcessDetails } from '../src/services/AgentBashCapability';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('production Agent Bash composition', () => {
  test('provides Bun PTY Bash through an actual compiled-mode AgentService registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-agent-bash-composition-'));
    roots.push(root);
    const home = fnResolveOmnidrawHome({ join, resolve }, {
      cwd: root,
      dataDir: root,
      env: {},
      homedir: root,
    });
    const config: ICliConfig = {
      cwd: root,
      dev: false,
      compiled: true,
      version: '0.0.0-test',
      command: 'serve',
      rawArgv: ['omnidraw', 'serve'],
      argv: [],
      port: 0,
      home,
      helpRequested: false,
      versionRequested: false,
    };
    const { canvasService, services } = setupServices(config);
    const database = services.require('db');
    const resourceOwner = services.require('resourceOwner');
    const agentOwner = services.require('agent');
    const context = { config: {}, hooks: {} };

    await database.start();
    await database.canvas.create({ id: 'canvas-bash-composition', name: 'Bash canvas' });
    await canvasService.execute({
      commandId: 'place-ai-chat',
      canvasId: 'canvas-bash-composition',
      baseRevision: 0,
      operations: [{
        type: 'insert',
        item: {
          id: 'widget-bash-composition',
          parentId: null,
          orderKey: 'a',
          kind: 'widget-frame',
          transform: {
            position: { x: 0, y: 0 },
            rotation: 0,
            scale: { x: 1, y: 1 },
            skew: { x: 0, y: 0 },
            origin: { x: 0, y: 0 },
          },
          size: { width: 320, height: 480 },
          title: 'AI Chat',
          resizable: true,
          minSize: { width: 240, height: 160 },
          headerItems: [{
            type: 'button',
            id: 'settings',
            label: 'Settings',
            content: { type: 'text', text: 'Settings' },
          }],
          extensions: {
            'omnidraw:widget': {
              schemaVersion: 1,
              type: 'ui-widget',
              kind: 'ai',
              payload: { sessionId: 'chat-bash-composition' },
            },
          },
        },
      }],
      preconditions: [{ type: 'item-absent', itemId: 'widget-bash-composition' }],
    });
    await resourceOwner.start(context);
    await agentOwner.start(context);
    try {
      const agent = agentOwner;
      await agent.connectChat(
        'widget-bash-composition',
        'chat-bash-composition',
        'canvas-bash-composition',
      );
      const session = agent.sessionMap['widget-bash-composition']?.['chat-bash-composition']?.session;
      const bash = session?.getToolDefinition('bash');
      if (!bash) throw new Error('Production AgentService did not register Bash.');

      const result = await bash.execute(
        'bash-composition-call',
        { command: 'pwd' },
        undefined,
        undefined,
        {} as never,
      );
      const details = result.details as TAgentBashProcessDetails;
      expect(result.content[0]?.type).toBe('text');
      expect(result.content[0]?.type === 'text' ? result.content[0].text : '').not.toContain(
        'BASH_RUNTIME_UNAVAILABLE',
      );
      expect(details).toMatchObject({
        status: 'succeeded',
        exitCode: 0,
        terminalCreated: true,
        terminalClosed: true,
      });
      expect(details.output.trim()).toBe(await realpath(details.cwd));
      expect(details.cwd).toContain('chat-bash-composition');
    } finally {
      await agentOwner.stop();
      await resourceOwner.stop();
      await database.stop();
    }
  });
});
