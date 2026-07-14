import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { fxLatestWidgetResourceSelectionRecord } from '../core/fx.session-candidate';
import { fnToolError, fnToolSuccess } from './fn.result';
import type { TActorServiceReloader, TCandidateSessionManager, TToolDefinition } from './types';

export type TCreateQueryDbReadonlyToolArgs = {
  actorService?: TActorServiceReloader;
  sessionManager: TCandidateSessionManager;
};

export function createQueryDbReadonlyTool(args: TCreateQueryDbReadonlyToolArgs): TToolDefinition {
  return defineTool({
    name: 'vc_query_db_readonly',
    label: 'Query Database',
    description: 'Run a bounded row-producing SQL query against a database explicitly selected by the user. The host opens the live database in read-only query mode and never grants mutation approval.',
    parameters: Type.Object({
      resourceId: Type.String({
        minLength: 1,
        maxLength: 128,
        description: 'ID of a database explicitly selected by the user with an @mention.',
      }),
      sql: Type.String({
        minLength: 1,
        maxLength: 65_536,
        description: 'One bounded SQL query that returns rows. Do not submit mutation, attachment, extension, or filesystem statements.',
      }),
    }, { additionalProperties: false }),
    async execute(_toolCallId, params: any) {
      const selected = fxLatestWidgetResourceSelectionRecord({ sessionManager: args.sessionManager }, {});
      const selectedDatabase = selected?.resources.find((resource) => resource.id === params.resourceId && resource.kind === 'db');
      if (!selectedDatabase) {
        return fnToolError('Database queries require a database explicitly selected by the user with an @mention.');
      }
      if (!args.actorService?.getResource || !args.actorService.executeDbLiveSql) {
        return fnToolError('Database queries are unavailable in this host.');
      }

      const resource = await args.actorService.getResource(selectedDatabase.id);
      if (!resource || resource.kind !== 'db' || resource.status !== 'ready') {
        return fnToolError('The selected database is missing or not ready. No query was executed.');
      }

      try {
        const result = await args.actorService.executeDbLiveSql({
          resourceId: resource.id,
          sql: String(params.sql),
          approved: false,
        });
        if (result.kind !== 'rows') {
          return fnToolError('The database statement did not return rows and was not treated as a read-only query.');
        }

        const details = {
          kind: 'db-query-result',
          resource: { id: resource.id, kind: resource.kind, name: resource.name, status: resource.status },
          query: String(params.sql),
          columns: result.columns,
          rows: result.rows,
          rowCount: result.rowCount,
          returnedRowCount: result.rows.length,
          rowsAffected: result.rowsAffected,
          truncated: result.truncated,
        };
        const truncation = result.truncated ? ` Showing the first ${result.rows.length}.` : '';
        return fnToolSuccess(
          `Queried database '${resource.name}' and read ${result.rowCount} row${result.rowCount === 1 ? '' : 's'}.${truncation}\n${JSON.stringify(details, null, 2)}`,
          details,
        );
      } catch (error) {
        return fnToolError(error instanceof Error ? error.message : 'Database query failed.');
      }
    },
  }) as TToolDefinition;
}
