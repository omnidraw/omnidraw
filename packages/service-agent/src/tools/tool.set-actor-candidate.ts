import { defineTool } from '@earendil-works/pi-coding-agent';
import { ACTOR_CANDIDATE_JSON_SCHEMA } from './CONSTANTS';
import { fnValidateCandidate } from './fn.candidate';
import { fnToolError, fnToolSuccess } from './fn.result';
import { txAppendActorCandidateRecord } from '../core/tx.session-candidate';
import type { TCandidateSessionManager, TToolDefinition, TToolEventSink } from './types';

export type TCreateSetActorCandidateToolArgs = {
  cwd: string;
  sessionManager: TCandidateSessionManager;
  onEvent?: TToolEventSink;
};

export function createSetActorCandidateTool(args: TCreateSetActorCandidateToolArgs): TToolDefinition {
  return defineTool({
    name: 'vc_set_actor_candidate',
    label: 'Set Actor Candidate',
    description: 'Create or replace the current Vibecanvas actor candidate. This validates the candidate and stores it only when valid.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        candidate: {
          ...ACTOR_CANDIDATE_JSON_SCHEMA,
          description: 'Actor candidate containing name, optional description, actor config, and widget.tool metadata.',
        },
        changeSummary: {
          type: 'string',
          description: 'Short summary of what changed in this candidate revision.',
        },
      },
      required: ['candidate'],
    } as any,
    async execute(_toolCallId, params: any) {
      const result = fnValidateCandidate(params.candidate);

      if (!result.candidate || !result.manifest || !result.validation.ok) {
        return fnToolError('Actor candidate is invalid.', { validation: result.validation });
      }

      const record = txAppendActorCandidateRecord({ sessionManager: args.sessionManager }, {
        candidate: result.candidate,
        manifest: result.manifest,
        validation: result.validation,
        updatedAt: new Date().toISOString(),
      });
      await args.onEvent?.({
        type: 'actorCandidateChanged',
        cwd: args.cwd,
        revision: record.revision,
        candidate: record.candidate,
        manifest: record.manifest,
        validation: record.validation,
      });

      return fnToolSuccess(`Actor candidate saved as revision ${record.revision}.`, {
        revision: record.revision,
        validation: record.validation,
        manifest: record.manifest,
        changeSummary: typeof params.changeSummary === 'string' ? params.changeSummary : undefined,
      });
    },
  }) as TToolDefinition;
}
