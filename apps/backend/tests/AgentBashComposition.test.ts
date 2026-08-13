import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fnResolveOmnidrawHome } from '#backend/shell/config/fn.resolve-omnidraw-home';
import type { ICliConfig } from '../src/shell/cli/config';
import { layerLiveMechanics } from '../src/shell/runtime/layer.live-mechanics';
import {
  LiveAgent,
  LiveCanvas,
  LiveDatabase,
} from '../src/shell/runtime/service.live-mechanics';
import type { TAgentBashProcessDetails } from '../src/shell/agent/AgentBashCapability';
import type { AgentService } from '../src/shell/agent/AgentService';
import { Effect, ManagedRuntime } from 'effect';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('production Agent Bash composition', () => {
  test('provides Bun PTY Bash through the source-run AgentService registry', async () => {
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
      version: '0.0.0-test',
      command: 'serve',
      rawArgv: ['omnidraw', 'serve'],
      argv: [],
      port: 0,
      home,
      helpRequested: false,
      versionRequested: false,
    };
    const runtime = ManagedRuntime.make(layerLiveMechanics({ config }));
    const canvasId = '11111111-1111-4111-8111-111111111111';
    const widgetId = '22222222-2222-4222-8222-222222222222';
    const chatId = '33333333-3333-4333-8333-333333333333';
    const { agent, canvasService, database } = await runtime.runPromise(
      Effect.gen(function*() {
        return {
          agent: (yield* LiveAgent) as AgentService,
          canvasService: yield* LiveCanvas,
          database: yield* LiveDatabase,
        };
      }),
    );
    await database.canvas.create({ id: canvasId, name: 'Bash canvas' });
    await canvasService.execute({
      commandId: 'place-ai-chat',
      canvasId,
      baseRevision: 0,
      operations: [{
        type: 'insert',
        item: {
          id: widgetId,
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
              kind: 'ai-chat',
              payload: { sessionId: chatId },
            },
          },
        },
      }],
      preconditions: [{ type: 'item-absent', itemId: widgetId }],
    });
    try {
      await agent.connectChat(
        widgetId,
        chatId,
        canvasId,
      );
      const session = agent.sessionMap[widgetId]?.[chatId]?.session;
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
      expect(details.cwd).toContain(chatId);
    } finally {
      await runtime.dispose();
    }
  });
});
