import { defineTool } from '@earendil-works/pi-coding-agent';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fnToolError, fnToolSuccess } from './fn.result';
import { fxLatestActorCandidateRecord } from '../core/fx.session-candidate';
import { txAppendActorCandidateApprovalRecord } from '../core/tx.session-candidate';
import { txWriteWidgetScaffold } from './tx.scaffold';
import type { TCandidateSessionManager, TToolDefinition, TToolEventSink } from './types';

export type TCreateApproveActorCandidateToolArgs = {
  cwd: string;
  sessionManager: TCandidateSessionManager;
  onEvent?: TToolEventSink;
};

export function createApproveActorCandidateTool(args: TCreateApproveActorCandidateToolArgs): TToolDefinition {
  return defineTool({
    name: 'vc_approve_actor_candidate',
    label: 'Approve Actor Candidate',
    description: 'Approve the current actor candidate and write the initial Vibecanvas widget scaffold into the draft folder.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        revision: {
          type: 'number',
          description: 'Candidate revision to approve. The tool refuses stale revisions.',
        },
      },
      required: ['revision'],
    } as any,
    async execute(_toolCallId, params: any) {
      const record = fxLatestActorCandidateRecord({ sessionManager: args.sessionManager });

      if (!record) {
        return fnToolError('No actor candidate exists to approve.', { record: null });
      }

      if (params.revision !== record.revision) {
        return fnToolError(`Cannot approve stale candidate revision ${params.revision}; latest is ${record.revision}.`, { latestRevision: record.revision });
      }

      if (!record.validation.ok) {
        return fnToolError('Cannot approve invalid actor candidate.', { validation: record.validation });
      }

      const files = await txWriteWidgetScaffold({ mkdir, writeFile, join }, { cwd: args.cwd, manifest: record.manifest });
      const approval = txAppendActorCandidateApprovalRecord({ sessionManager: args.sessionManager }, {
        candidateRevision: record.revision,
        manifest: record.manifest,
        files,
        approvedAt: new Date().toISOString(),
      });
      await args.onEvent?.({ type: 'widgetupdate', cwd: args.cwd, files });

      return fnToolSuccess(`Actor candidate revision ${record.revision} approved and scaffold written.`, {
        revision: record.revision,
        manifest: record.manifest,
        files,
        approval,
      });
    },
  }) as TToolDefinition;
}
