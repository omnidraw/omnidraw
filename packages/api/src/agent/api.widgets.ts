import { ORPCError } from '@orpc/server';
import type { TVibecanvasToolIcon } from '@vibecanvas/service-actor/core/tool-icon';
import { ZVibecanvasToolIcon } from '@vibecanvas/service-actor/core/vibecanvasjson.zod';
import type { TJson } from '@vibecanvas/service-db/model';
import type { TWidgetCatalog, TWidgetCatalogGroup } from '@vibecanvas/service-agent/widget-management/types';
import { baseAgentOs } from './orpc';
import type { TAgentApiContext } from './types';
import { fnWidgetGroupMembers } from './fn.widget-groups';

function toCatalogGroup(group: { name: string; json: TJson | null }): TWidgetCatalogGroup {
  const icon = ZVibecanvasToolIcon.safeParse(group.json);
  return { name: group.name, icon: icon.success ? icon.data as TVibecanvasToolIcon : null };
}

async function readCatalog(context: TAgentApiContext): Promise<TWidgetCatalog> {
  const groups = (await context.db.toolGroup.listAll(context.tenant)).map(toCatalogGroup);
  return context.agent.getWidgetCatalog(groups);
}

function throwWidgetError(error: unknown): never {
  const message = error instanceof Error ? error.message : 'Widget management operation failed.';
  if (message.startsWith('STALE_REVISION:')) throw new ORPCError('CONFLICT', { message });
  if (message.startsWith('UNSAFE_PATH:')) throw new ORPCError('BAD_REQUEST', { message });
  if (message.startsWith('PAYLOAD_LIMIT:')) throw new ORPCError('PAYLOAD_TOO_LARGE', { message });
  if (message.startsWith('INVALID_MANIFEST:')) throw new ORPCError('BAD_REQUEST', { message });
  if (message.startsWith('NAME_IN_USE:')) throw new ORPCError('CONFLICT', { message });
  if (message.startsWith('OPERATION_UNAVAILABLE:')) throw new ORPCError('SERVICE_UNAVAILABLE', { message });
  throw new ORPCError('INTERNAL_SERVER_ERROR', { message: 'Widget management operation failed.' });
}

export const apiWidgetsCatalog = baseAgentOs.widgets.catalog.handler(async ({ context }) => readCatalog(context));

export const apiWidgetsDetail = baseAgentOs.widgets.detail.handler(async ({ context, input }) => {
  try {
    return await context.agent.getWidgetDetail(input.name, input.source);
  } catch (error) {
    throwWidgetError(error);
  }
});

export const apiWidgetsFiles = baseAgentOs.widgets.files.handler(async ({ context, input }) => {
  try {
    return await context.agent.listWidgetFiles(input.name, input.source);
  } catch (error) {
    throwWidgetError(error);
  }
});

export const apiWidgetsFile = baseAgentOs.widgets.file.handler(async ({ context, input }) => {
  try {
    return await context.agent.readWidgetFile(input.name, input.source, input.path);
  } catch (error) {
    throwWidgetError(error);
  }
});

export const apiWidgetsEnsureDraft = baseAgentOs.widgets.ensureDraft.handler(async ({ context, input }) => {
  try {
    return await context.agent.ensureWidgetDraft(input.name, input.expectedPublishedFingerprint);
  } catch (error) {
    throwWidgetError(error);
  }
});

export const apiWidgetsPatchDraftTool = baseAgentOs.widgets.patchDraftTool.handler(async ({ context, input }) => {
  if (input.patch.group !== undefined && input.patch.group !== null) {
    const group = await context.db.toolGroup.getByName(context.tenant, { name: input.patch.group });
    if (!group) throw new ORPCError('NOT_FOUND', { message: `Tool group "${input.patch.group}" was not found.` });
  }
  try {
    return await context.agent.patchWidgetDraftTool(input.name, input.expectedRevision, input.patch);
  } catch (error) {
    throwWidgetError(error);
  }
});

export const apiWidgetsPatchDraftMetadata = baseAgentOs.widgets.patchDraftMetadata.handler(async ({ context, input }) => {
  if (input.patch.tool?.group !== undefined && input.patch.tool.group !== null) {
    const group = await context.db.toolGroup.getByName(context.tenant, { name: input.patch.tool.group });
    if (!group) throw new ORPCError('NOT_FOUND', { message: `Tool group "${input.patch.tool.group}" was not found.` });
  }
  try {
    return await context.agent.patchWidgetDraftMetadata(input.name, input.expectedRevision, input.patch);
  } catch (error) {
    throwWidgetError(error);
  }
});

export const apiWidgetsDelete = baseAgentOs.widgets.delete.handler(async ({ context, input }) => {
  try {
    const result = await context.agent.deleteWidget(input.name, input.source);
    if (!result) throw new ORPCError('NOT_FOUND', { message: `${input.source === 'published' ? 'Published widget' : 'Widget draft'} "${input.name}" was not found.` });
    context.eventPublisher.publishAgentEvent(context.tenant, { kind: 'widget-catalog', type: 'changed' });
    if (result.deletedPublished) {
      context.eventPublisher.publishAgentEvent(context.tenant, {
        kind: 'widgetupdate',
        widgetId: input.name,
        sessionId: 'definition-delete',
        cwd: '',
        files: [],
      });
    }
    return result;
  } catch (error) {
    if (error instanceof ORPCError) throw error;
    throwWidgetError(error);
  }
});

export const apiWidgetsResolvePlacement = baseAgentOs.widgets.resolvePlacement.handler(async ({ context, input }) => {
  return context.agent.resolveWidgetPlacement(input.reference, input.previewId);
});

export const apiWidgetsGroupsCreate = baseAgentOs.widgets.groups.create.handler(async ({ context, input }) => {
  try {
    const group = await context.db.toolGroup.create(context.tenant, { name: input.name, json: input.icon as TJson | null });
    context.eventPublisher.publishAgentEvent(context.tenant, { kind: 'widget-catalog', type: 'changed' });
    return toCatalogGroup(group);
  } catch {
    throw new ORPCError('ALREADY_EXISTS', { message: `Tool group "${input.name}" already exists.` });
  }
});

export const apiWidgetsGroupsUpdate = baseAgentOs.widgets.groups.update.handler(async ({ context, input }) => {
  if (input.currentName !== input.group.name) {
    const catalog = await readCatalog(context);
    const affected = fnWidgetGroupMembers(catalog, input.currentName);
    if (affected.length > 0) {
      throw new ORPCError('CONFLICT', { message: `GROUP_IN_USE: Rename is blocked because ${affected.length} widget variant${affected.length === 1 ? '' : 's'} use this group.` });
    }
  }
  const group = await context.db.toolGroup.update(context.tenant, {
    currentName: input.currentName,
    name: input.group.name,
    json: input.group.icon as TJson | null,
  });
  if (!group) throw new ORPCError('NOT_FOUND', { message: `Tool group "${input.currentName}" was not found.` });
  context.eventPublisher.publishAgentEvent(context.tenant, { kind: 'widget-catalog', type: 'changed' });
  return toCatalogGroup(group);
});

export const apiWidgetsGroupsRemove = baseAgentOs.widgets.groups.remove.handler(async ({ context, input }) => {
  const catalog = await readCatalog(context);
  const affected = fnWidgetGroupMembers(catalog, input.name);
  if (affected.length > 0) {
    throw new ORPCError('CONFLICT', { message: `GROUP_IN_USE: Delete is blocked because ${affected.length} widget variant${affected.length === 1 ? '' : 's'} use this group.` });
  }
  const group = await context.db.toolGroup.remove(context.tenant, { name: input.name });
  if (!group) throw new ORPCError('NOT_FOUND', { message: `Tool group "${input.name}" was not found.` });
  context.eventPublisher.publishAgentEvent(context.tenant, { kind: 'widget-catalog', type: 'changed' });
  return toCatalogGroup(group);
});
