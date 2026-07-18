import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalCoordinator } from '../src/approval/ApprovalCoordinator';
import { AI_CHAT_TOOL_NAMES } from '../src/tools/CONSTANTS';
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
    const workspace = new WidgetWorkspace({ dataPath: join(root, 'data'), configPath: join(root, 'config') });
    await workspace.init();
    const cwd = await workspace.ensureChat('chat-a');
    const registry = createToolRegistry({
      chatId: 'chat-a',
      cwd,
      authorization: {},
      workspace,
      approvals: new ApprovalCoordinator(),
    });
    expect(registry.toolNames).toEqual([...AI_CHAT_TOOL_NAMES]);
    expect(registry.customTools.map((tool) => tool.name)).toEqual([...AI_CHAT_TOOL_NAMES]);
    expect(registry.toolNames).not.toContain('vc_publish_widget');
    expect(registry.toolNames).not.toContain('vc_approve_actor_candidate');
    expect(registry.toolNames).toContain('bash');
    expect(registry.toolNames).not.toContain('write');
    expect(registry.toolNames).toHaveLength(16);

    const bash = registry.customTools.find((tool) => tool.name === 'bash')!;
    const bashResult = await executeTool(bash, { command: 'pwd' });
    expect(bashResult.content[0]?.text.trim()).toBe(await realpath(cwd));

    const deniedRegistry = createToolRegistry({
      chatId: 'chat-a',
      cwd,
      authorization: {},
      authorize: ({ toolName }) => toolName !== 'bash',
      workspace,
      approvals: new ApprovalCoordinator(),
    });
    const denied = await executeTool(deniedRegistry.customTools.find((tool) => tool.name === 'bash')!, { command: 'pwd' });
    expect(denied.isError).toBe(true);
    expect(denied.content[0]?.text).toContain('TOOL_NOT_AUTHORIZED');
  });
});
