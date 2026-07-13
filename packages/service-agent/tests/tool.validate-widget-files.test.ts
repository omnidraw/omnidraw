import { describe, expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApproveActorCandidateTool } from '../src/tools/tool.approve-actor-candidate';
import { createSetActorCandidateTool } from '../src/tools/tool.set-actor-candidate';
import { createValidateWidgetFilesTool } from '../src/tools/tool.validate-widget-files';
import { createFakeSessionManager, executeTool, makeTempDir, sampleCandidate } from './tool.test-helpers';

describe('vc_validate_widget_files', () => {
  test('checks generated scaffold', async () => {
    const cwd = await makeTempDir();
    const sessionManager = createFakeSessionManager();
    await executeTool(createSetActorCandidateTool({ cwd, sessionManager }), { candidate: sampleCandidate() });
    await executeTool(createApproveActorCandidateTool({
      cwd,
      sessionManager,
      npmInstall: async () => ({ status: 'skipped', reason: 'test' }),
    }), { revision: 1 });

    const result = await executeTool(createValidateWidgetFilesTool({ cwd }));

    expect(result.isError).toBeUndefined();
    expect(result.details.ok).toBe(true);
    expect(result.details.files).toContain('widget/main.ts');
  });

  test('reports manifest-defined missing required files', async () => {
    const cwd = await makeTempDir();
    await writeFile(join(cwd, 'vibecanvas.json'), JSON.stringify({
      slug: 'custom-counter',
      name: 'Custom Counter',
      actor: {
        relFunctionPath: './src/actor-functions.ts',
        initialState: 'ready',
        initialData: {},
        states: { ready: { on: {} } },
        inputMsgSchema: {},
        outputMsgSchema: {},
      },
      widget: {
        relWidgetDir: './src/widget-ui',
        tool: { label: 'Custom Counter', behavior: { type: 'action' } },
      },
    }), 'utf8');

    const result = await executeTool(createValidateWidgetFilesTool({ cwd }));

    expect(result.details.ok).toBe(false);
    expect(result.details.errors).toContain('Missing src/actor-functions.ts');
    expect(result.details.errors).toContain('Missing src/widget-ui/main.ts');
  });

  test('revalidates resource declarations from the complete draft manifest', async () => {
    const cwd = await makeTempDir();
    const sessionManager = createFakeSessionManager();
    await executeTool(createSetActorCandidateTool({ cwd, sessionManager }), { candidate: sampleCandidate() });
    await executeTool(createApproveActorCandidateTool({
      cwd,
      sessionManager,
      npmInstall: async () => ({ status: 'skipped', reason: 'test' }),
    }), { revision: 1 });
    const manifestPath = join(cwd, 'vibecanvas.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.actor.resources = {
      notes: {
        kind: 'db',
        required: true,
        scope: ['read'],
        operations: {
          broken: { effect: 'read', sql: 'SELECT 1; SELECT 2', result: 'rows' },
        },
      },
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const result = await executeTool(createValidateWidgetFilesTool({ cwd }));

    expect(result.details.ok).toBe(false);
    expect(result.details.errors.some((error: string) => error.includes('actor.resources.notes.operations.broken.sql'))).toBe(true);
  });
});
