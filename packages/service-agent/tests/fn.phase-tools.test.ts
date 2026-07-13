import { describe, expect, test } from 'bun:test';
import { txAppendActorCandidateApprovalRecord } from '../src/core/tx.session-candidate';
import { createWidgetWizardPhaseTools, getWidgetWizardPhase } from '../src/tools/phase-tools';
import { createFakeSessionManager, makeTempDir, sampleCandidate } from './tool.test-helpers';

describe('createWidgetWizardPhaseTools', () => {
  test('exposes only phase-appropriate tools', async () => {
    const cwd = await makeTempDir();
    const finalWidgetsDir = await makeTempDir();
    const sessionManager = createFakeSessionManager();

    const phaseOne = createWidgetWizardPhaseTools({ phase: 'actor-candidate', cwd, finalWidgetsDir, sessionManager });
    expect(phaseOne.builtInTools).toEqual([]);
    expect(phaseOne.customTools.map((tool) => tool.name).sort()).toEqual([
      'vc_approve_actor_candidate',
      'vc_inspect_resource',
      'vc_list_resources',
      'vc_propose_db_change',
      'vc_set_actor_candidate',
      'web_fetch',
    ]);

    const phaseTwo = createWidgetWizardPhaseTools({ phase: 'implementation', cwd, finalWidgetsDir, sessionManager });
    expect(phaseTwo.builtInTools.sort()).toEqual(['edit', 'grep', 'read']);
    expect(phaseTwo.builtInTools).not.toContain('bash');
    expect(phaseTwo.customTools.map((tool) => tool.name).sort()).toEqual([
      'vc_inspect_resource',
      'vc_list_resources',
      'vc_propose_db_change',
      'vc_publish_widget',
      'vc_validate_widget_files',
      'web_fetch',
    ]);
  });

  test('uses session approval records to choose implementation phase', async () => {
    const cwd = await makeTempDir();
    const finalWidgetsDir = await makeTempDir();
    const sessionManager = createFakeSessionManager();
    const manifest = {
      slug: 'counter-widget',
      name: 'Counter Widget',
      version: '1',
      description: 'A generated counter widget.',
      actor: {
        ...sampleCandidate().actor,
        relFunctionPath: './actor/functions.ts',
      },
      widget: {
        relWidgetDir: './widget',
        tool: sampleCandidate().widget.tool,
      },
    };

    expect(getWidgetWizardPhase(sessionManager)).toBe('actor-candidate');

    txAppendActorCandidateApprovalRecord({ sessionManager }, {
      candidateRevision: 1,
      manifest,
      files: ['vibecanvas.json'],
      approvedAt: new Date().toISOString(),
    });

    expect(getWidgetWizardPhase(sessionManager)).toBe('implementation');
    const tools = createWidgetWizardPhaseTools({ cwd, finalWidgetsDir, sessionManager });
    expect(tools.builtInTools.sort()).toEqual(['edit', 'grep', 'read']);
    expect(tools.customTools.map((tool) => tool.name)).toContain('web_fetch');
  });
});
