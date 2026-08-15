import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApprovalCoordinator } from '../approval/ApprovalCoordinator';
import { createWidgetWorkspaceTools } from '../tools/tool.widget-workspace';
import type {
  TWidgetDraftValidationCheck,
  TWidgetPreviewBuildCheck,
} from '../tools/types';
import { WidgetWorkspace } from '../workspace/WidgetWorkspace';
import { executeTool } from './tool.test-helpers';
import { testChatId, testWorkspaceWorld } from './service.fixture';

const roots: string[] = [];
const CHAT_ID = testChatId('widget-validate-tool');

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function createWorkspace(): Promise<WidgetWorkspace> {
  const root = await mkdtemp(join(tmpdir(), 'od-validate-tool-'));
  roots.push(root);
  const workspace = new WidgetWorkspace({
    ...testWorkspaceWorld(),
    dataPath: join(root, 'agent'),
    draftRoot: join(root, 'widgets', 'drafts'),
  });
  await workspace.init();
  await workspace.createDraft(CHAT_ID, { name: 'Hello App' }, async ({ cwd }) => {
    await mkdir(join(cwd, 'ui'), { recursive: true });
    await writeFile(join(cwd, 'omnidraw.json'), JSON.stringify({
      $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
      schemaVersion: 1,
      name: 'Hello App',
      slug: 'hello-app',
      description: 'Hello App fixture.',
      tool: { label: 'Hello App', group: null, priority: 0 },
      ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
    }));
    await writeFile(join(cwd, 'ui', 'main.ts'), 'export default 1;\n');
    return ['omnidraw.json', 'ui/main.ts'];
  });
  return workspace;
}

function createValidateTool(
  workspace: WidgetWorkspace,
  previewBuild?: TWidgetPreviewBuildCheck,
  widgetValidation?: TWidgetDraftValidationCheck,
) {
  const tools = createWidgetWorkspaceTools({
    workspace,
    chatId: CHAT_ID,
    authorize: async () => true,
    ...(previewBuild === undefined ? {} : { previewBuild }),
    ...(widgetValidation === undefined ? {} : { widgetValidation }),
  });
  return tools.find((tool) => tool.name === 'od_widget_validate')!;
}

describe('od_widget_validate preview execution', () => {
  test('reports not-run only when the host has no preview build authority', async () => {
    const workspace = await createWorkspace();
    const result = await executeTool(createValidateTool(workspace), { name: 'Hello App' });

    expect(result.isError).not.toBe(true);
    expect(result.details).toMatchObject({
      name: 'Hello App',
      ok: true,
      draft: true,
      source: 'draft',
      acceptedArtifactBuild: 'not-run',
      livePreviewRuntime: 'not_exercised',
      resources: 'not_exercised',
    });
    expect(result.content[0]?.text).toContain('Accepted artifact build was not run');
    expect(result.content[0]?.text).toContain('live Preview runtime and resources were not exercised');
  });

  test('reports a passed preview build through the host build pipeline', async () => {
    const workspace = await createWorkspace();
    const builds: string[] = [];
    const result = await executeTool(createValidateTool(workspace, async ({ slug }) => {
      builds.push(slug);
      return { ok: true, errors: [] };
    }), { name: 'Hello App' });

    expect(builds).toEqual(['hello-app']);
    expect(result.details).toMatchObject({
      ok: true,
      validationScope: 'source_and_accepted_artifact',
      acceptedArtifactBuild: 'passed',
      livePreviewRuntime: 'not_exercised',
    });
    expect(result.content[0]?.text).toContain('accepted artifact build passed');
    expect(result.content[0]?.text).toContain('Live Preview runtime and resources were not exercised');
  });

  test('fails validation when the real preview build fails', async () => {
    const workspace = await createWorkspace();
    const result = await executeTool(createValidateTool(workspace, async () => ({
      ok: false,
      errors: ['vite build failed: missing default export'],
    })), { name: 'Hello App' });

    expect(result.details).toMatchObject({ ok: false, acceptedArtifactBuild: 'failed' });
    expect(result.details.errors).toContain('vite build failed: missing default export');
    expect(result.content[0]?.text).toContain('accepted artifact build failed');
  });

  test('skips the preview build when construction lint already failed', async () => {
    const workspace = await createWorkspace();
    const draft = await workspace.getDraft('Hello App');
    await rm(join(draft!.draftPath, 'ui', 'main.ts'));
    const builds: string[] = [];
    const result = await executeTool(createValidateTool(workspace, async ({ slug }) => {
      builds.push(slug);
      return { ok: true, errors: [] };
    }), { name: 'Hello App' });

    expect(builds).toEqual([]);
    expect(result.details).toMatchObject({ ok: false, acceptedArtifactBuild: 'not-run' });
  });

  test('uses the shared host validation capability when the live app supplies it', async () => {
    const workspace = await createWorkspace();
    const calls: string[] = [];
    const result = await executeTool(createValidateTool(
      workspace,
      async () => {
        throw new Error('legacy build adapter must not run');
      },
      async ({ slug }) => {
        calls.push(slug);
        return {
          ok: false,
          widgetKey: slug,
          displayName: 'Hello App',
          capturedDraftDigestSha256: 'a'.repeat(64),
          executableInputDigestSha256: null,
          acceptedGeneration: null,
          buildIdentity: null,
          sourceValidation: {
            status: 'passed',
            diagnostics: [],
            files: ['omnidraw.json', 'ui/main.ts'],
            filesTruncated: false,
          },
          acceptedArtifactBuild: {
            status: 'failed',
            diagnostics: [{
              code: 'BUILD_IMPORT_FAILED',
              message: 'Accepted host build failed.',
              path: null,
            }],
          },
          livePreviewRuntime: 'not_exercised',
          resources: 'not_exercised',
        };
      },
    ), { name: 'Hello App' });

    expect(calls).toEqual(['hello-app']);
    expect(result.details).toMatchObject({
      ok: false,
      widgetKey: 'hello-app',
      acceptedArtifactBuild: 'failed',
      errors: ['[BUILD_IMPORT_FAILED] Accepted host build failed.'],
      livePreviewRuntime: 'not_exercised',
      resources: 'not_exercised',
    });
  });

  test('preserves source diagnostic code and safe location for AI repair', async () => {
    const workspace = await createWorkspace();
    const result = await executeTool(createValidateTool(
      workspace,
      undefined,
      async ({ slug }) => ({
        ok: false,
        widgetKey: slug,
        displayName: 'Hello App',
        capturedDraftDigestSha256: 'a'.repeat(64),
        executableInputDigestSha256: null,
        acceptedGeneration: null,
        buildIdentity: null,
        sourceValidation: {
          status: 'failed',
          diagnostics: [{
            code: 'SOURCE_DOM_EVENT_UNSUPPORTED',
            message: 'Line 17, column 1: pagehide is unsupported; rely on host disposal.',
            path: 'ui/main.ts',
          }],
          files: ['omnidraw.json', 'ui/main.ts'],
          filesTruncated: false,
        },
        acceptedArtifactBuild: { status: 'not_run', diagnostics: [] },
        livePreviewRuntime: 'not_exercised',
        resources: 'not_exercised',
      }),
    ), { name: 'Hello App' });

    expect(result.details).toMatchObject({
      ok: false,
      acceptedArtifactBuild: 'not-run',
      errors: [
        '[SOURCE_DOM_EVENT_UNSUPPORTED] ui/main.ts: Line 17, column 1: pagehide is unsupported; rely on host disposal.',
      ],
    });
    expect(result.content[0]?.text).toContain('construction is invalid');
  });
});
