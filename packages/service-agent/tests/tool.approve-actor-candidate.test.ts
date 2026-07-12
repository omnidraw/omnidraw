import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApproveActorCandidateTool } from '../src/tools/tool.approve-actor-candidate';
import { createSetActorCandidateTool } from '../src/tools/tool.set-actor-candidate';
import type { TToolEvent } from '../src/tools/types';
import { createFakeSessionManager, executeTool, makeTempDir, sampleCandidate } from './tool.test-helpers';

describe('vc_approve_actor_candidate', () => {
  test('writes deterministic scaffold and emits widgetupdate', async () => {
    const cwd = await makeTempDir();
    const events: TToolEvent[] = [];
    const sessionManager = createFakeSessionManager();
    let npmInstallCwd: string | undefined;
    const base = sampleCandidate();
    const resources = {
      preferences: { kind: 'kv' as const, required: true, scope: ['read', 'write'] as ('read' | 'write')[] },
      credentials: { kind: 'secretStore' as const, required: false, scope: ['read'] as ('read' | 'write')[] },
    };
    await executeTool(createSetActorCandidateTool({ cwd, sessionManager }), {
      candidate: sampleCandidate({ actor: { ...base.actor, resources } }),
    });

    const result = await executeTool(createApproveActorCandidateTool({
      cwd,
      sessionManager,
      onEvent: (event) => { events.push(event) },
      npmInstall: async (installCwd) => {
        npmInstallCwd = installCwd;
        return { status: 'success', stdout: '', stderr: '' };
      },
    }), { revision: 1 });

    expect(result.isError).toBeUndefined();
    expect(result.details.files).toContain('vibecanvas.json');
    expect(result.details.files).toContain('package.json');
    expect(result.details.files).toContain('package-lock.json');
    expect(result.details.files).toContain('actor/functions.ts');
    expect(result.details.files).toContain('actor/tx.increment.ts');
    expect(result.details.nextPhase).toBe('implementation');
    expect(events.some((event) => event.type === 'widgetupdate')).toBe(true);
    expect(npmInstallCwd).toBe(cwd);
    expect(result.details.npmInstall.status).toBe('success');
    expect(sessionManager.entries.at(-1)).toMatchObject({
      type: 'custom',
      customType: 'vibecanvas.actorCandidateApproved',
      data: { candidateRevision: 1 },
    });

    const manifest = JSON.parse(await readFile(join(cwd, 'vibecanvas.json'), 'utf8'));
    expect(manifest.name).toBe('Counter Widget');
    expect(manifest.actor.resources).toEqual(resources);
    const packageJson = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf8'));
    expect(packageJson.dependencies).toHaveProperty('@arrow-js/core');
    expect(packageJson.dependencies).toHaveProperty('@vibecanvas/sdk');

    const registry = await readFile(join(cwd, 'actor', 'functions.ts'), 'utf8');
    expect(registry).toContain('"tx.increment"');
    const actorTypes = await readFile(join(cwd, 'actor', 'types.ts'), 'utf8');
    expect(actorTypes).toContain('export type TActorResourceSlot = "preferences" | "credentials";');
    const txStub = await readFile(join(cwd, 'actor', 'tx.increment.ts'), 'utf8');
    expect(txStub).toContain('import type { TTxArgs, TTxPortal } from "@vibecanvas/sdk/actor";');
  });

  test('scaffolds lifecycle, activity, and error-handler functions', async () => {
    const cwd = await makeTempDir();
    const sessionManager = createFakeSessionManager();
    const base = sampleCandidate();
    const candidate = sampleCandidate({
      actor: {
        ...base.actor,
        states: {
          ready: {
            onEnter: ['fx.load'],
            onExit: ['tx.cleanup'],
            onError: { func: ['tx.recoverState'], recover: 'stay' },
            activity: {
              everyMs: 1000,
              runImmediately: true,
              func: ['fx.poll'],
              onError: { func: ['tx.recoverActivity'], recover: 'stay' },
            },
            on: {
              'in.increment': {
                func: ['tx.increment'],
                targetState: 'ready',
                onError: { func: ['tx.recoverTransition'], recover: 'stay' },
              },
            },
          },
          error: base.actor.states.error,
        },
      },
    });
    await executeTool(createSetActorCandidateTool({ cwd, sessionManager }), { candidate });

    const result = await executeTool(createApproveActorCandidateTool({
      cwd,
      sessionManager,
      npmInstall: async () => ({ status: 'skipped', reason: 'test' }),
    }), { revision: 1 });

    expect(result.isError).toBeUndefined();
    expect(result.details.files).toEqual(expect.arrayContaining([
      'actor/fx.load.ts',
      'actor/tx.cleanup.ts',
      'actor/tx.recoverState.ts',
      'actor/fx.poll.ts',
      'actor/tx.recoverActivity.ts',
      'actor/tx.recoverTransition.ts',
    ]));
    const registry = await readFile(join(cwd, 'actor', 'functions.ts'), 'utf8');
    expect(registry).toContain('"fx.poll"');
    expect(registry).toContain('"tx.recoverTransition"');
  });
});
