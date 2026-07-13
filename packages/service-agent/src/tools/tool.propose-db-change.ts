import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { fxLatestWidgetResourceSelectionRecord } from '../core/fx.session-candidate';
import { txAppendWidgetDbChangeProposalRecord } from '../core/tx.session-candidate';
import { fnToolError, fnToolSuccess } from './fn.result';
import type { TActorServiceReloader, TCandidateSessionManager, TToolDefinition } from './types';

export type TCreateProposeDbChangeToolArgs = {
  actorService?: TActorServiceReloader;
  sessionManager: TCandidateSessionManager;
  createId?: () => string;
  now?: () => string;
};

export function createProposeDbChangeTool(args: TCreateProposeDbChangeToolArgs): TToolDefinition {
  return defineTool({
    name: 'vc_propose_db_change',
    label: 'Propose Database Change',
    description: 'Propose SQL for an explicitly @mentioned database. This tool never executes SQL. A visible user approval with a risk checkbox is required before Vibecanvas creates and applies a coordinated draft.',
    parameters: Type.Object({
      resourceId: Type.String({
        minLength: 1,
        maxLength: 128,
        description: 'ID of a database explicitly selected by the user.',
      }),
      sql: Type.String({
        minLength: 1,
        maxLength: 1_048_576,
        description: 'SQLite-compatible schema or data change SQL to propose. It is not executed by this tool.',
      }),
      reason: Type.String({
        minLength: 1,
        maxLength: 2_000,
        description: 'Plain-language reason the actor needs this database change.',
      }),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params: any) {
      const selected = fxLatestWidgetResourceSelectionRecord({ sessionManager: args.sessionManager }, {});
      const resourceSelection = selected?.resources.find((resource) => resource.id === params.resourceId && resource.kind === 'db');
      if (!resourceSelection) {
        return fnToolError('Database changes may only be proposed for a database explicitly selected by the user with an @mention.', { proposed: false });
      }
      const resource = await args.actorService?.getResource?.(resourceSelection.id);
      if (!resource || resource.kind !== 'db' || resource.status !== 'ready') {
        return fnToolError('The selected database is missing or not ready. No SQL was executed.', { proposed: false });
      }

      const proposal = txAppendWidgetDbChangeProposalRecord({ sessionManager: args.sessionManager }, {
        id: (args.createId ?? (() => crypto.randomUUID()))(),
        resourceId: resource.id,
        resourceName: resource.name,
        sql: String(params.sql),
        reason: String(params.reason),
        status: 'pending',
        proposedAt: (args.now ?? (() => new Date().toISOString()))(),
      });

      return fnToolSuccess(
        `Proposed a database change for '${resource.name}'. No SQL was executed. The user must review the exact SQL and approve it with the visible risk checkbox.`,
        { kind: 'db-change-proposal', proposed: true, proposal },
      );
    },
  }) as TToolDefinition;
}
