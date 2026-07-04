import { describe, expect, test } from 'bun:test';
import { txAppendActorCandidateApprovalRecord } from '../src/core/tx.session-candidate';
import { fnCreateWidgetWizardPhaseTools, fnGetWidgetWizardPhase } from '../src/tools/fn.phase-tools';
import { createFakeSessionManager, makeTempDir, sampleCandidate } from './tool.test-helpers';

describe('fnCreateWidgetWizardPhaseTools', () => {
  test('exposes only phase-appropriate tools', async () => {
    const cwd = await makeTempDir();
    const finalWidgetsDir = await makeTempDir();
    const sessionManager = createFakeSessionManager();

    const phaseOne = fnCreateWidgetWizardPhaseTools({ phase: 'actor-candidate', cwd, finalWidgetsDir, sessionManager });
    expect(phaseOne.builtInTools).toEqual([]);
    expect(phaseOne.customTools.map((tool) => tool.name).sort()).toEqual([
      'vc_approve_actor_candidate',
      'vc_set_actor_candidate',
    ]);

    const phaseTwo = fnCreateWidgetWizardPhaseTools({ phase: 'implementation', cwd, finalWidgetsDir, sessionManager });
    expect(phaseTwo.builtInTools.sort()).toEqual(['edit', 'grep', 'read']);
    expect(phaseTwo.builtInTools).not.toContain('bash');
    expect(phaseTwo.customTools.map((tool) => tool.name).sort()).toEqual([
      'vc_publish_widget',
      'vc_validate_widget_files',
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

    expect(fnGetWidgetWizardPhase(sessionManager)).toBe('actor-candidate');

    txAppendActorCandidateApprovalRecord({ sessionManager }, {
      candidateRevision: 1,
      manifest,
      files: ['vibecanvas.json'],
      approvedAt: new Date().toISOString(),
    });

    expect(fnGetWidgetWizardPhase(sessionManager)).toBe('implementation');
    const tools = fnCreateWidgetWizardPhaseTools({ cwd, finalWidgetsDir, sessionManager });
    expect(tools.builtInTools.sort()).toEqual(['edit', 'grep', 'read']);
  });
});
