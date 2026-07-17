import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalCoordinator } from '../src/approval/ApprovalCoordinator';
import { AI_CHAT_TOOL_NAMES } from '../src/tools/CONSTANTS';
import { createToolRegistry } from '../src/tools/ToolRegistry';
import { WidgetWorkspace } from '../src/workspace/WidgetWorkspace';

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
    expect(registry.toolNames).not.toContain('bash');
    expect(registry.toolNames).not.toContain('write');
  });
});
