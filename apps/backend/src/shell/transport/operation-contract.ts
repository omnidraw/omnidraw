import { Schema } from 'effect';
import { handlers } from '#backend/shell/api/handlers';
import {
  PrivateProcedure,
  parseProcedureInput,
  parseProcedureOutput,
} from '#backend/shell/api/procedure';

/**
 * Canonical private operation inventory. Both transport envelopes and the
 * dispatcher consume these literal sets; an arbitrary string is never a wire
 * operation. Domain contracts retain their stricter per-operation Zod/Canvas
 * validation underneath this JSON-safe physical envelope.
 */
export const PRIVATE_REQUEST_PATHS = Object.freeze([
  'agent.settings.get',
  'agent.settings.approvalPolicy.update',
  'agent.auth.login',
  'agent.auth.logout',
  'agent.auth.status',
  'agent.auth.abort',
  'agent.auth.apiKey.set',
  'agent.auth.apiKey.remove',
  'agent.chat.connect',
  'agent.chat.history',
  'agent.chat.prompt',
  'agent.chat.edit',
  'agent.chat.dbChange.approve',
  'agent.chat.dbChange.reject',
  'agent.chat.approval.list',
  'agent.chat.approval.get',
  'agent.chat.approval.resolve',
  'agent.chat.cancel',
  'agent.chat.newSession',
  'agent.approval.list',
  'agent.approval.get',
  'agent.approval.resolve',
  'canvas.list',
  'canvas.get',
  'canvas.create',
  'canvas.update',
  'canvas.remove',
  'canvas.snapshot',
  'canvas.query',
  'canvas.execute',
  'file.put',
  'file.clone',
  'file.remove',
  'function.invoke',
  'resource.resources.list',
  'resource.resources.get',
  'resource.resources.create',
  'resource.resources.rename',
  'resource.resources.delete',
  'resource.resources.data',
  'resource.resources.dataSet',
  'resource.resources.dataDelete',
  'resource.resources.dataRevealSecret',
  'resource.dbResources.impact',
  'resource.dbResources.inspect',
  'resource.dbResources.executeSql',
  'resource.dbRows.list',
  'resource.dbRows.get',
  'resource.dbRows.create',
  'resource.dbRows.update',
  'resource.dbRows.delete',
  'resource.dbRows.bulk',
  'resource.dbDrafts.create',
  'resource.dbDrafts.list',
  'resource.dbDrafts.get',
  'resource.dbDrafts.active',
  'resource.dbDrafts.inspect',
  'resource.dbDrafts.change',
  'resource.dbDrafts.executeSql',
  'resource.dbDrafts.discard',
  'resource.dbApplies.preview',
  'resource.dbApplies.confirm',
  'resource.dbApplies.get',
  'resource.dbApplies.list',
  'resource.dbBackups.get',
  'resource.dbBackups.discard',
  'resource.dbBackups.previewRestore',
  'resource.dbBackups.restore',
  'resource.dbBackups.restoreStatus',
  'widget.catalog.get',
  'widget.catalog.refresh',
  'widget.catalog.files.list',
  'widget.catalog.files.read',
  'widget.config.saveDraft',
  'widget.publication.publishMetadata',
  'widget.publication.buildAndPublish',
  'widget.placement.resolve',
  'widget.preview.open',
  'widget.preview.rebuild',
  'widget.preview.rebuildDraft',
  'widget.preview.load',
  'widget.preview.close',
  'widget.preview.invoke',
  'widget.runtime.config',
  'widget.runtime.load',
  'widget.runtime.state.get',
  'widget.runtime.state.change',
] as const);

export const PRIVATE_STREAM_PATHS = Object.freeze([
  'agent.events',
  'canvas.events',
  'db.events',
  'notification.events',
  'widget.catalog.events',
  'widget.runtime.state.events',
] as const);

export type TPrivateRequestPath = typeof PRIVATE_REQUEST_PATHS[number];
export type TPrivateStreamPath = typeof PRIVATE_STREAM_PATHS[number];
export type TPrivateOperationPath = TPrivateRequestPath | TPrivateStreamPath;

export const PrivateRequestPath = Schema.Literals(PRIVATE_REQUEST_PATHS);
export const PrivateStreamPath = Schema.Literals(PRIVATE_STREAM_PATHS);
export const PrivateWireValue = Schema.Json;

export type TPrivateOperationContract = Readonly<{
  path: TPrivateOperationPath;
  stream: boolean;
  procedure: PrivateProcedure;
  decodeInput(input: unknown): unknown;
  decodeOutput(output: unknown): unknown;
}>;

function procedureAt(path: TPrivateOperationPath): PrivateProcedure {
  let value: unknown = handlers;
  for (const segment of path.split('.')) {
    if (typeof value !== 'object' || value === null || !(segment in value)) {
      throw new Error(`Missing private operation handler '${path}'.`);
    }
    value = (value as Readonly<Record<string, unknown>>)[segment];
  }
  if (!(value instanceof PrivateProcedure)) {
    throw new Error(`Private operation '${path}' is not executable.`);
  }
  return value;
}

const contracts = [...PRIVATE_REQUEST_PATHS, ...PRIVATE_STREAM_PATHS].map((path) => {
  const procedure = procedureAt(path);
  const stream = (PRIVATE_STREAM_PATHS as readonly string[]).includes(path);
  if (procedure.contract.streamOutput !== stream) {
    throw new Error(`Private operation '${path}' has the wrong stream mode.`);
  }
  return [path, Object.freeze({
    path,
    stream,
    procedure,
    decodeInput: (input: unknown) => parseProcedureInput(procedure, input),
    decodeOutput: (output: unknown) => parseProcedureOutput(procedure, output),
  })] as const;
});

export const PRIVATE_OPERATION_CONTRACTS: ReadonlyMap<
  TPrivateOperationPath,
  TPrivateOperationContract
> = new Map(contracts);

export function privateOperationContract(path: string): TPrivateOperationContract | null {
  return PRIVATE_OPERATION_CONTRACTS.get(path as TPrivateOperationPath) ?? null;
}
