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

  test('compiles a resource-using actor against the workspace SDK contract', async () => {
    const cwd = await makeTempDir();
    const sessionManager = createFakeSessionManager();
    const base = sampleCandidate();
    const candidate = sampleCandidate({
      actor: {
        ...base.actor,
        resources: {
          database: {
            kind: 'db',
            required: true,
            scope: ['read'],
            operations: {
              listQaRows: { effect: 'read', sql: 'SELECT id, title FROM qa_rows ORDER BY id', result: 'rows' },
            },
          },
        },
        states: {
          ...base.actor.states,
          ready: {
            ...base.actor.states.ready,
            on: base.actor.states.ready?.on ?? {},
            onEnter: ['fx.loadRows'],
          },
        },
      },
    });
    await executeTool(createSetActorCandidateTool({ cwd, sessionManager }), { candidate });
    await executeTool(createApproveActorCandidateTool({
      cwd,
      sessionManager,
      npmInstall: async () => ({ status: 'skipped', reason: 'test' }),
    }), { revision: 1 });
    const actorPath = join(cwd, 'actor', 'fx.loadRows.ts');
    await writeFile(actorPath, [
      'import type { TFxArgs, TFxPortal } from "@vibecanvas/sdk/actor";',
      'type TData = { rows: Array<{ id: string; title: string }> };',
      'type TArgs = TFxArgs<TData>;',
      'export async function fxLoadRows(portal: TFxPortal, args: TArgs) {',
      '  const rows = await portal.resources.db("database").invoke<Array<{ id: bigint; title: string }>>("listQaRows", {});',
      '  await portal.setData({ ...args.data, rows: rows.map((row) => ({ id: String(row.id), title: row.title })) });',
      '  return portal.next();',
      '}',
      '',
    ].join('\n'), 'utf8');

    const valid = await executeTool(createValidateWidgetFilesTool({ cwd }));
    expect(valid.details.ok).toBe(true);

    await writeFile(actorPath, `${await readFile(actorPath, 'utf8')}\nconst invalidSdkContract: string = 123;\n`, 'utf8');
    const invalid = await executeTool(createValidateWidgetFilesTool({ cwd }));
    expect(invalid.details.ok).toBe(false);
    expect(invalid.details.errors.some((error: string) => error.includes('error TS2322'))).toBe(true);
  });
});
