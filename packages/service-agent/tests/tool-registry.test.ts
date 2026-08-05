import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZWidgetManifestV1 } from '@omnidraw/widget-contract';
import { ApprovalCoordinator } from '../src/approval/ApprovalCoordinator';
import { AI_CHAT_TOOL_NAMES } from '../src/tools/CONSTANTS';
import { fnIsStructuredToolErrorDetails } from '../src/tools/fn.result';
import { createToolRegistry } from '../src/tools/ToolRegistry';
import { WidgetWorkspace } from '../src/workspace/WidgetWorkspace';
import { executeTool } from './tool.test-helpers';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('AI Chat tool registry', () => {
  test('registers the exact phase-free tool set in stable order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-tool-registry-'));
    roots.push(root);
    await mkdir(join(root, 'config', 'widgets'), { recursive: true });
    const workspace = new WidgetWorkspace({ dataPath: join(root, 'data'), draftRoot: join(root, 'widgets', 'drafts') });
    await workspace.init();
    const cwd = await workspace.ensureChat('chat-a');
    const registry = createToolRegistry({
      chatId: 'chat-a',
      cwd,
      workspace,
      approvals: new ApprovalCoordinator(),
    });
    expect(registry.toolNames).toEqual([...AI_CHAT_TOOL_NAMES]);
    expect(registry.customTools.map((tool) => tool.name)).toEqual([...AI_CHAT_TOOL_NAMES]);
    expect(registry.toolNames).not.toContain('od_publish_widget');
    expect(registry.toolNames).not.toContain('od_approve_actor_candidate');
    expect(registry.toolNames).toContain('bash');
    expect(registry.toolNames).not.toContain('vc_widget_preview_status');
    expect(registry.toolNames).not.toContain('vc_widget_preview_wait');
    expect(registry.toolNames).not.toContain('vc_widget_preview_test');
    expect(registry.toolNames).not.toContain('write');
    expect(registry.toolNames).toHaveLength(16);

    const bash = registry.customTools.find((tool) => tool.name === 'bash')!;
    const unavailable = await executeTool(bash, { command: 'pwd' });
    expect(unavailable.isError).toBe(true);
    expect(unavailable.content[0]?.text).toContain('BASH_RUNTIME_UNAVAILABLE');

    const bashRuns: unknown[] = [];
    const injectedRegistry = createToolRegistry({
      chatId: 'chat-a',
      cwd,
      workspace,
      approvals: new ApprovalCoordinator(),
      bashCapability: {
        run: async (call) => {
          bashRuns.push(call);
          return { content: [{ type: 'text', text: 'host runner invoked' }], details: undefined };
        },
      },
    });
    const injected = await executeTool(injectedRegistry.customTools.find((tool) => tool.name === 'bash')!, {
      command: 'pwd',
      timeout: 12,
    });
    expect(injected.content[0]?.text).toBe('host runner invoked');
    expect(bashRuns).toHaveLength(1);
    expect(bashRuns[0]).toMatchObject({
      toolCallId: 'tool-call',
      command: 'pwd',
      cwd,
      timeoutSeconds: 12,
    });

    const deniedRegistry = createToolRegistry({
      chatId: 'chat-a',
      cwd,
      authorize: ({ toolName }) => toolName !== 'bash',
      workspace,
      approvals: new ApprovalCoordinator(),
      bashCapability: {
        run: async (call) => {
          bashRuns.push(call);
          return { content: [{ type: 'text', text: 'must not run' }], details: undefined };
        },
      },
    });
    const denied = await executeTool(deniedRegistry.customTools.find((tool) => tool.name === 'bash')!, { command: 'pwd' });
    expect(denied.isError).toBe(true);
    expect(denied.content[0]?.text).toContain('TOOL_NOT_AUTHORIZED');
    expect(bashRuns).toHaveLength(1);
  });

  test('does not rewrite unsupported private-target draft source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-capsule-api-groups-migration-'));
    roots.push(root);
    const workspace = new WidgetWorkspace({ dataPath: join(root, 'data'), draftRoot: join(root, 'widgets', 'drafts') });
    await workspace.init();

    const created = await workspace.createDraft(
      'chat-a',
      { name: 'Migrated WebGL' },
      async ({ cwd }) => {
        await mkdir(join(cwd, 'ui'), { recursive: true });
        await writeFile(join(cwd, 'ui', 'main.ts'), 'document.body.append(document.createElement("canvas"));\n', 'utf8');
        await writeFile(join(cwd, 'omnidraw.json'), `${JSON.stringify({
          schemaVersion: 1,
          name: 'Migrated WebGL',
          slug: 'migrated-webgl',
          ui: {
            runtime: 'capsule',
            entry: 'ui/main.ts',
            target: {
              runtimeAbi: 'quickjs-release-sync-v1',
              domProfile: 'dom-core-v2',
              featureProfiles: [
                'artifact-resources-v1',
                'canvas-webgl-v1',
                'shadow-browser-css-v1',
              ],
            },
          },
        }, null, 2)}\n`, 'utf8');
        return ['omnidraw.json', 'ui/main.ts'];
      },
    );

    const manifest = JSON.parse(await readFile(
      join(created.mount.targetPath, 'omnidraw.json'),
      'utf8',
    ));
    expect(manifest.ui).toHaveProperty('target');
    expect(ZWidgetManifestV1.safeParse(manifest).success).toBe(false);
    const first = await workspace.getDraft('Migrated WebGL');
    const second = await workspace.getDraft('Migrated WebGL');
    expect(first?.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(second?.revision).toBe(first?.revision);
  });

  test('fences one mounted draft once after multi-file and failed Bash mutations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-tool-registry-bash-fence-'));
    roots.push(root);
    const workspace = new WidgetWorkspace({ dataPath: join(root, 'data'), draftRoot: join(root, 'widgets', 'drafts') });
    await workspace.init();
    const cwd = await workspace.ensureChat('chat-a');
    await workspace.createDraft('chat-a', { name: 'Bash Clock' }, async ({ cwd: draftCwd }) => {
      await mkdir(join(draftCwd, 'ui'), { recursive: true });
      await writeFile(
        join(draftCwd, 'omnidraw.json'),
        `${JSON.stringify({
          schemaVersion: 1,
          name: 'Bash Clock',
          slug: 'bash-clock',
          description: 'Bash clock fixture.',
          tool: { label: 'Bash Clock', group: null, priority: 0 },
          ui: { runtime: 'capsule', entry: 'ui/main.ts' },
        })}\n`,
        'utf8',
      );
      await writeFile(join(draftCwd, 'ui', 'main.ts'), 'export const first = 1;\n', 'utf8');
      return ['omnidraw.json', 'ui/main.ts'];
    });
    await workspace.createDraft('chat-a', { name: 'Second Clock' }, async ({ cwd: draftCwd }) => {
      await mkdir(join(draftCwd, 'ui'), { recursive: true });
      await writeFile(
        join(draftCwd, 'omnidraw.json'),
        `${JSON.stringify({
          schemaVersion: 1,
          name: 'Second Clock',
          slug: 'second-clock',
          description: 'Second clock fixture.',
          tool: { label: 'Second Clock', group: null, priority: 0 },
          ui: { runtime: 'capsule', entry: 'ui/main.ts' },
        })}\n`,
        'utf8',
      );
      await writeFile(join(draftCwd, 'ui', 'main.ts'), 'export const second = 1;\n', 'utf8');
      return ['omnidraw.json', 'ui/main.ts'];
    });

    const changes: unknown[] = [];
    let rejectBashClockFence = false;
    const registry = createToolRegistry({
      chatId: 'chat-a',
      cwd,
      workspace,
      approvals: new ApprovalCoordinator(),
      onDraftChanged: async (change) => {
        changes.push(change);
        if (rejectBashClockFence && change.name === 'Bash Clock') {
          throw new Error('catalog invalidation rejected');
        }
      },
      bashCapability: {
        run: async ({ command }) => {
          if (command === 'multi-file') {
            await writeFile(
              join(workspace.draftRoot, 'bash-clock', 'ui', 'main.ts'),
              'export const first = 2;\n',
              'utf8',
            );
            await writeFile(
              join(workspace.draftRoot, 'bash-clock', 'ui', 'secondary.ts'),
              'export const second = 2;\n',
              'utf8',
            );
            return {
              content: [{ type: 'text', text: 'multi-file complete' }],
              details: undefined,
            };
          }
          if (command === 'tamper-mount') {
            await writeFile(
              join(workspace.draftRoot, 'bash-clock', 'ui', 'main.ts'),
              'export const first = 4;\n',
              'utf8',
            );
            await rm(join(cwd, 'widgets', 'Bash Clock'));
            return {
              content: [{ type: 'text', text: 'mount removed' }],
              details: undefined,
            };
          }
          if (command === 'multi-draft') {
            await writeFile(
              join(workspace.draftRoot, 'bash-clock', 'ui', 'main.ts'),
              'export const first = 5;\n',
              'utf8',
            );
            await writeFile(
              join(workspace.draftRoot, 'second-clock', 'ui', 'main.ts'),
              'export const second = 2;\n',
              'utf8',
            );
            return {
              content: [{ type: 'text', text: 'multi-draft complete' }],
              details: undefined,
            };
          }
          if (command.startsWith('settled:')) {
            await writeFile(
              join(workspace.draftRoot, 'bash-clock', 'ui', 'main.ts'),
              `export const settled = ${JSON.stringify(command)};\n`,
              'utf8',
            );
            return {
              content: [{ type: 'text', text: command }],
              details: undefined,
              ...(command === 'settled:truncated' ? {} : { isError: true }),
            };
          }
          await writeFile(
            join(workspace.draftRoot, 'bash-clock', 'ui', 'main.ts'),
            'export const first = 3;\n',
            'utf8',
          );
          throw new Error('runner failed after write');
        },
      },
    });
    const bash = registry.customTools.find((tool) => tool.name === 'bash')!;

    const multiFile = await executeTool(bash, { command: 'multi-file' });
    expect(multiFile.isError).not.toBe(true);
    expect(changes).toEqual([{
      name: 'Bash Clock',
      chatId: 'chat-a',
      type: 'changed',
    }]);

    const failed = await executeTool(bash, { command: 'fail-after-write' });
    expect(failed.isError).toBe(true);
    expect(failed.content[0]?.text).toContain('runner failed after write');
    expect(changes).toEqual([
      {
        name: 'Bash Clock',
        chatId: 'chat-a',
        type: 'changed',
      },
      {
        name: 'Bash Clock',
        chatId: 'chat-a',
        type: 'changed',
      },
    ]);

    for (const outcome of ['non-zero', 'timeout', 'cancelled', 'truncated']) {
      const settled = await executeTool(bash, { command: `settled:${outcome}` });
      expect(settled.content[0]?.text).toBe(`settled:${outcome}`);
      expect(fnIsStructuredToolErrorDetails(settled.details)).toBe(outcome !== 'truncated');
    }
    expect(changes).toHaveLength(6);

    const mountTamper = await executeTool(bash, { command: 'tamper-mount' });
    expect(mountTamper.isError).toBe(true);
    expect(mountTamper.content[0]?.text).toContain('changed the managed widget mount set');
    expect(changes).toHaveLength(7);
    expect(changes[6]).toEqual({
      name: 'Bash Clock',
      chatId: 'chat-a',
      type: 'changed',
    });
    expect(await workspace.inspectMounts('chat-a')).toEqual([
      expect.objectContaining({ name: 'Bash Clock' }),
      expect.objectContaining({ name: 'Second Clock' }),
    ]);

    rejectBashClockFence = true;
    const partialFenceFailure = await executeTool(bash, { command: 'multi-draft' });
    expect(partialFenceFailure.isError).toBe(true);
    expect(partialFenceFailure.content[0]?.text).toContain(
      'catalog invalidation rejected',
    );
    expect(changes.slice(-2)).toEqual([
      {
        name: 'Bash Clock',
        chatId: 'chat-a',
        type: 'changed',
      },
      {
        name: 'Second Clock',
        chatId: 'chat-a',
        type: 'changed',
      },
    ]);
  });
});
