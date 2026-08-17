import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZWidgetManifestV1 } from '@omnidraw/sdk/contract';
import { ApprovalCoordinator } from '../approval/ApprovalCoordinator';
import { AI_CHAT_TOOL_NAMES } from '../tools/CONSTANTS';
import { createToolRegistry } from '../tools/ToolRegistry';
import { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import { testApprovalWorld, testChatId, testWorkspaceWorld } from './service.fixture';

const roots: string[] = [];
const CHAT_ID = testChatId('tool-registry-chat');
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('AI Chat tool registry', () => {
  test('registers the exact phase-free tool set in stable order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-tool-registry-'));
    roots.push(root);
    await mkdir(join(root, 'config', 'widgets'), { recursive: true });
    const workspace = new WidgetWorkspace({ ...testWorkspaceWorld(), dataPath: join(root, 'data'), draftRoot: join(root, 'widgets', 'drafts') });
    await workspace.init();
    const cwd = await workspace.ensureChat(CHAT_ID);
    const registry = createToolRegistry({
      chatId: CHAT_ID,
      cwd,
      workspace,
      approvals: new ApprovalCoordinator(testApprovalWorld()),
    });
    expect(registry.toolNames).toEqual([...AI_CHAT_TOOL_NAMES]);
    expect(registry.customTools.map((tool) => tool.name)).toEqual([...AI_CHAT_TOOL_NAMES]);
    expect(registry.toolNames).not.toContain('od_publish_widget');
    expect(registry.toolNames).not.toContain('od_republish_widget');
    expect(registry.toolNames).not.toContain('od_delete_widget');
    expect(registry.toolNames).not.toContain('od_remove_widget');
    expect(registry.toolNames).not.toContain('od_unload_widget');
    expect(registry.toolNames).not.toContain('od_approve_actor_candidate');
    expect(registry.toolNames).toContain('bash');
    expect(registry.toolNames).toContain('od_widget_load');
    expect(registry.toolNames).not.toContain('vc_widget_preview_status');
    expect(registry.toolNames).not.toContain('vc_widget_preview_wait');
    expect(registry.toolNames).not.toContain('vc_widget_preview_test');
    expect(registry.toolNames).toContain('od_widget_preview_inspect');
    expect(registry.toolNames).not.toContain('write');
    expect(registry.toolNames).toHaveLength(17);
  });

  test('does not rewrite unsupported private-target draft source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vc-capsule-api-groups-migration-'));
    roots.push(root);
    const workspace = new WidgetWorkspace({ ...testWorkspaceWorld(), dataPath: join(root, 'data'), draftRoot: join(root, 'widgets', 'drafts') });
    await workspace.init();

    const created = await workspace.createDraft(
      CHAT_ID,
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

});
