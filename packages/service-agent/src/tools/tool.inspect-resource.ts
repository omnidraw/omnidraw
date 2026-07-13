import { defineTool } from '@earendil-works/pi-coding-agent';
import { fnToolError, fnToolSuccess } from './fn.result';
import type { TActorServiceReloader, TToolDefinition } from './types';

export type TCreateInspectResourceToolArgs = {
  actorService?: TActorServiceReloader;
};

export function createInspectResourceTool(args: TCreateInspectResourceToolArgs): TToolDefinition {
  return defineTool({
    name: 'vc_inspect_resource',
    label: 'Inspect Vibecanvas Resource',
    description: 'Inspect safe resource metadata. Database resources include their live schema, but never database paths, credentials, secret values, or table row data.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        resourceId: { type: 'string', minLength: 1, maxLength: 128, description: 'Resource ID returned by vc_list_resources.' },
      },
      required: ['resourceId'],
    } as any,
    async execute(_toolCallId, params: any) {
      if (!args.actorService?.getResource) {
        return fnToolError('Resource inspection is unavailable in this host.');
      }

      const resource = await args.actorService.getResource(params.resourceId);
      if (!resource) return fnToolError('Resource not found. Call vc_list_resources again.');

      const safeResource = {
        id: resource.id,
        kind: resource.kind,
        name: resource.name,
        status: resource.status,
      };

      if (resource.kind !== 'db') {
        return fnToolSuccess(
          resource.kind === 'secretStore'
            ? `Inspected secret store '${resource.name}'. Secret keys and values are intentionally hidden.`
            : `Inspected key-value resource '${resource.name}'. Stored keys and values are intentionally omitted.`,
          { resource: safeResource },
        );
      }

      if (!args.actorService.inspectDbResource) {
        return fnToolError('Database schema inspection is unavailable in this host.', { resource: safeResource });
      }
      const inspection = await args.actorService.inspectDbResource({ resourceId: resource.id, target: 'live' });
      if (!inspection) return fnToolError(`Database '${resource.name}' could not be inspected.`, { resource: safeResource });

      const schema = inspection.objects.slice(0, 64).map((object) => ({
        name: object.name,
        kind: object.kind,
        columns: object.columns.slice(0, 128).map((column) => ({
          name: column.name,
          declaredType: column.declaredType,
          nullable: column.nullable,
          defaultSql: column.defaultSql?.slice(0, 512) ?? null,
          primaryKeyOrder: column.primaryKeyOrder,
          hidden: column.hidden,
        })),
        indexes: object.indexes.slice(0, 64).map((index) => ({
          name: index.name,
          unique: index.unique,
          columns: index.columns.slice(0, 32).map((column) => column.name),
        })),
        foreignKeys: object.foreignKeys.slice(0, 64).map((foreignKey) => ({
          ...foreignKey,
          columns: foreignKey.columns.slice(0, 32),
          referencedColumns: foreignKey.referencedColumns.slice(0, 32),
        })),
        identity: object.identity,
        editable: object.editable,
        readOnlyReason: object.readOnlyReason,
      }));
      const inspectionPayload = {
        resource: safeResource,
        schema,
        truncated: inspection.objects.length > schema.length,
      };

      return fnToolSuccess(
        `Inspected live schema for database '${resource.name}'. No table rows or BLOB payloads were read.\n${JSON.stringify(inspectionPayload, null, 2)}`,
        inspectionPayload,
      );
    },
  }) as TToolDefinition;
}
