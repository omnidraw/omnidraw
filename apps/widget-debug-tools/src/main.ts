import { buildCapsuleGuest } from '@omnidraw/capsule-omnidraw/build';
import {
  WIDGET_CAPSULE_BUILD_IDENTITY,
  WIDGET_CAPSULE_BUILD_POLICY_ID,
} from '../../cli/src/services/CONSTANTS';
import { WidgetCapsuleSigningKeyStore } from '../../cli/src/services/WidgetCapsuleSigningKeyStore';
import {
  createWidgetNpmDistributionBuild,
  fnWidgetNpmBuildEnvironmentIdentity,
} from '../../cli/src/services/WidgetNpmDistributionBuild';
import { fnLocalRegistryNpmUserConfig } from '../../cli/src/fn.local-registry-npm-userconfig';
import { WidgetService } from '../../cli/src/services/WidgetService';
import {
  createWidgetAuthoringCapability,
  WidgetServicePool,
} from '../../cli/src/services/WidgetServicePool';
import { fnWidgetCapsuleBuilderIdentity } from '../../cli/src/services/fn.widget-capsule-builder-identity';
import { BunChildFunctionDescriptorExtractor } from '@omnidraw/function-runtime/local';
import { ApprovalCoordinator } from '@omnidraw/service-agent/approval/ApprovalCoordinator';
import { createResourceTools } from '@omnidraw/service-agent/tools/tool.resources';
import { createWidgetWorkspaceTools } from '@omnidraw/service-agent/tools/tool.widget-workspace';
import { createWidgetPreviewTools } from '@omnidraw/service-agent/tools/tool.widget-preview';
import { createWorkspaceFileTools } from '@omnidraw/service-agent/tools/tool.workspace-files';
import { txTryNpmInstall } from '@omnidraw/service-agent/tools/tx.npm-install';
import type { TToolDefinition } from '@omnidraw/service-agent/tools/types';
import { WidgetDraftController } from '@omnidraw/service-agent/widget-drafts/WidgetDraftController';
import { WidgetWorkspace } from '@omnidraw/service-agent/workspace/WidgetWorkspace';
import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_CELL_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '@omnidraw/service-db/CONSTANTS';
import { DbServiceTurso } from '@omnidraw/service-db/DbServiceTurso/DbServiceTurso';
import { EventPublisherService } from '@omnidraw/service-event-publisher/EventPublisherService';
import { fnFreezeTenantContext } from '@omnidraw/tenant-core';
import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { access, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const REPOSITORY_ROOT = resolve(import.meta.dir, '../../..');
const DEFAULT_HOME = join(REPOSITORY_ROOT, '.omnidraw');
const NPM_USER_CONFIG_PATH = fnLocalRegistryNpmUserConfig({
  homeDirectory: homedir(),
  localDevelopment: true,
  stateDirectory: process.env.LOCAL_NPM_REGISTRY_STATE_DIR,
  join,
});
const DEFAULT_CHAT_ID = 'widget-debug-tools';
const ARTIFACT_READ_MAXIMUM_TTL_MS = 5 * 60 * 1_000;
const TRUSTED_WIDGET_BUILD_PACKAGE_IMPORTS = Object.freeze([
  '@omnidraw/sdk/server',
  'zod',
]);

type TOperation =
  | Readonly<{ tool: string; args: unknown; expect?: unknown }>
  | Readonly<{
      lab: 'preview' | 'inspect-preview-owner' | 'rebuild-preview-owner';
      args: unknown;
      expect?: unknown;
    }>;

type TCommand = Readonly<{
  home: string;
  chatId: string;
  session: boolean;
  operation: TOperation | null;
}>;

type TToolResult = Readonly<{
  content?: readonly Readonly<{ type?: string; text?: string }>[];
  details?: unknown;
  isError?: boolean;
}>;

function usage(): string {
  return [
    'Usage:',
    "  bun run lab -- [--home <path>] [--chat-id <id>] <tool-name> '<json-args>'",
    '  bun run lab -- [--home <path>] [--chat-id <id>] create <name>',
    '  bun run lab -- [--home <path>] [--chat-id <id>] validate <name>',
    '  bun run lab -- [--home <path>] [--chat-id <id>] preview <name>',
    '  bun run lab -- [--home <path>] [--chat-id <id>] inspect-preview-owner <draft-id>',
    '  bun run lab -- [--home <path>] [--chat-id <id>] rebuild-preview-owner <draft-id>',
    '  bun run lab -- [--home <path>] [--chat-id <id>] list',
    '  bun run lab -- --home <isolated-path> [--chat-id <id>] session < operations.jsonl',
    '',
    'Session records:',
    '  {"tool":"od_widget_create","args":{"name":"Counter"}}',
    '  {"tool":"read","args":{"path":"widgets/Counter/ui/main.ts"}}',
    '  {"lab":"preview","args":{"name":"Counter"}}',
    '  {"lab":"inspect-preview-owner","args":{"draftId":"..."}}',
    '  {"lab":"rebuild-preview-owner","args":{"draftId":"..."}}',
  ].join('\n');
}

function parseCommand(argv: readonly string[]): TCommand {
  const values = [...argv];
  let home = DEFAULT_HOME;
  let homeSpecified = false;
  let chatId = DEFAULT_CHAT_ID;
  const homeIndex = values.indexOf('--home');
  if (homeIndex !== -1) {
    const selected = values[homeIndex + 1];
    if (!selected) throw new Error('--home requires a path.');
    home = resolve(process.cwd(), selected);
    homeSpecified = true;
    values.splice(homeIndex, 2);
  }
  const chatIndex = values.indexOf('--chat-id');
  if (chatIndex !== -1) {
    const selected = values[chatIndex + 1]?.trim();
    if (!selected) throw new Error('--chat-id requires an identity.');
    chatId = selected;
    values.splice(chatIndex, 2);
  }
  const command = values.shift();
  if (!command) throw new Error(usage());
  if (command === 'session') {
    if (values.length > 0) throw new Error('session does not accept positional arguments.');
    if (!homeSpecified) {
      throw new Error('session requires an explicit isolated --home path.');
    }
    return { home, chatId, session: true, operation: null };
  }
  if (command === 'create' || command === 'validate') {
    const name = values.join(' ').trim();
    if (!name) throw new Error(`${command} requires a widget name.`);
    return {
      home,
      chatId,
      session: false,
      operation: {
        tool: command === 'create' ? 'od_widget_create' : 'od_widget_validate',
        args: { name },
      },
    };
  }
  if (command === 'preview') {
    const name = values.join(' ').trim();
    if (!name) throw new Error('preview requires a widget name.');
    return {
      home,
      chatId,
      session: false,
      operation: { lab: 'preview', args: { name } },
    };
  }
  if (command === 'inspect-preview-owner') {
    const draftId = values.join(' ').trim();
    if (!draftId) throw new Error('inspect-preview-owner requires a draft ID.');
    return {
      home,
      chatId,
      session: false,
      operation: { lab: 'inspect-preview-owner', args: { draftId } },
    };
  }
  if (command === 'rebuild-preview-owner') {
    const draftId = values.join(' ').trim();
    if (!draftId) throw new Error('rebuild-preview-owner requires a draft ID.');
    return {
      home,
      chatId,
      session: false,
      operation: { lab: 'rebuild-preview-owner', args: { draftId } },
    };
  }
  if (command === 'list') {
    if (values.length > 0) throw new Error('list does not accept arguments.');
    return {
      home,
      chatId,
      session: false,
      operation: { tool: 'od_widget_list', args: {} },
    };
  }
  if (values.length > 1) {
    throw new Error('A direct tool call accepts one JSON argument value.');
  }
  let args: unknown = {};
  if (values[0] !== undefined) {
    try {
      args = JSON.parse(values[0]);
    } catch {
      throw new Error('Tool arguments must be valid JSON.');
    }
  }
  return {
    home,
    chatId,
    session: false,
    operation: { tool: command, args },
  };
}

function resolveTrustedWidgetBuildPackageImport(specifier: string): string {
  if (!TRUSTED_WIDGET_BUILD_PACKAGE_IMPORTS.includes(specifier)) {
    throw new Error(`Widget build package '${specifier}' is not trusted by the host.`);
  }
  if (specifier === 'zod') {
    return join(dirname(Bun.resolveSync('zod/package.json', import.meta.dir)), 'index.cjs');
  }
  return Bun.resolveSync(specifier, import.meta.dir);
}

function resultModelData(result: TToolResult): unknown {
  const text = result.content?.find((item) => item.type === 'text')?.text;
  const marker = 'Model data:\n';
  const markerIndex = text?.indexOf(marker) ?? -1;
  if (!text || markerIndex === -1) return null;
  try {
    return JSON.parse(text.slice(markerIndex + marker.length));
  } catch {
    return null;
  }
}

function boundedResultText(result: TToolResult): Readonly<{
  text: string | null;
  textTruncated: boolean;
}> {
  const text = result.content?.find((item) => item.type === 'text')?.text ?? null;
  if (text === null) return { text: null, textTruncated: false };
  const maximum = 16_000;
  return {
    text: text.slice(0, maximum),
    textTruncated: text.length > maximum,
  };
}

function operationFromJson(line: string): TOperation {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('Session input must contain one valid JSON object per line.');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Session operation must be a JSON object.');
  }
  const record = value as Record<string, unknown>;
  const expect = record.expect;
  if (typeof record.tool === 'string' && !('lab' in record)) {
    return {
      tool: record.tool,
      args: record.args ?? {},
      ...(expect === undefined ? {} : { expect }),
    };
  }
  if (
    (
      record.lab === 'preview'
      || record.lab === 'inspect-preview-owner'
      || record.lab === 'rebuild-preview-owner'
    )
    && !('tool' in record)
  ) {
    return {
      lab: record.lab,
      args: record.args ?? {},
      ...(expect === undefined ? {} : { expect }),
    };
  }
  throw new Error("Session operation must select exactly one 'tool' or supported 'lab' action.");
}

function matchesExpected(actual: unknown, expected: unknown): boolean {
  if (typeof expected !== 'object' || expected === null) return Object.is(actual, expected);
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && expected.length === actual.length
      && expected.every((value, index) => matchesExpected(actual[index], value));
  }
  if (typeof actual !== 'object' || actual === null || Array.isArray(actual)) return false;
  const actualRecord = actual as Record<string, unknown>;
  return Object.entries(expected as Record<string, unknown>)
    .every(([key, value]) => matchesExpected(actualRecord[key], value));
}

async function run(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  const tenant = fnFreezeTenantContext({
    orgId: DEFAULT_OSS_ORGANIZATION_ID,
    accountId: DEFAULT_OSS_ACCOUNT_ID,
    cellId: DEFAULT_OSS_CELL_ID,
    placementEpoch: 1,
    roles: ['owner'],
    capabilities: ['*'],
    requestId: `widget-debug-tools-${randomUUID()}`,
  });
  const organizationRoot = join(command.home, 'organizations', tenant.orgId);
  const agentDataPath = join(organizationRoot, 'agent', tenant.accountId);
  const artifactsRoot = join(organizationRoot, 'artifacts');
  const buildTempRoot = join(organizationRoot, 'temp', 'widget-builds');
  const functionTempRoot = join(organizationRoot, 'temp', 'widget-functions');
  await Promise.all([
    mkdir(artifactsRoot, { recursive: true, mode: 0o700 }),
    mkdir(buildTempRoot, { recursive: true, mode: 0o700 }),
    mkdir(functionTempRoot, { recursive: true, mode: 0o700 }),
  ]);

  const database = new DbServiceTurso({
    databasePath: join(command.home, 'main.db'),
    dataDir: command.home,
    cacheDir: join(command.home, 'cache'),
    silentMigrations: process.env.OMNIDRAW_SILENT_DB_MIGRATIONS === '1',
  });
  const builderIdentity = fnWidgetCapsuleBuilderIdentity({
    npmVersion: process.versions.npm ?? 'external',
    serverBunVersion: Bun.version,
  });
  const buildEnvironmentIdentity = fnWidgetNpmBuildEnvironmentIdentity({
    runnerIdentity: 'host-v1',
    nodeVersion: process.version,
    npmVersion: process.versions.npm ?? 'external',
    platform: process.platform,
    architecture: process.arch,
    toolchainPinnedByRunner: false,
  });
  const signingKeys = new WidgetCapsuleSigningKeyStore(join(command.home, 'keys'));
  const telemetry = {
    guestConstructions: 0,
    distributionBuilds: 0,
    dependencyInstalls: 0,
  };
  const npmDistributionBuild = createWidgetNpmDistributionBuild({
    scratchDirectory: buildTempRoot,
    npmUserConfigPath: NPM_USER_CONFIG_PATH,
  });
  const distributionBuild = Object.assign(
    async (request: Parameters<typeof npmDistributionBuild>[0]) => {
      telemetry.distributionBuilds += 1;
      return npmDistributionBuild({
        ...request,
        reportProgress: (phase) => {
          if (phase === 'installing') telemetry.dependencyInstalls += 1;
          request.reportProgress?.(phase);
        },
      });
    },
    {
      closeWorkspace: npmDistributionBuild.closeWorkspace.bind(npmDistributionBuild),
      close: npmDistributionBuild.close.bind(npmDistributionBuild),
    },
  );
  const widgetPool = new WidgetServicePool({
    create: async (placement) => new WidgetService({
      placement,
      database: database.db,
      artifactsRoot,
      buildTempRoot,
      builderIdentity,
      buildEnvironmentIdentity,
      capsuleBuildIdentity: WIDGET_CAPSULE_BUILD_IDENTITY,
      buildPolicyId: WIDGET_CAPSULE_BUILD_POLICY_ID,
      capsuleBuild: async (request) => {
        telemetry.guestConstructions += 1;
        return buildCapsuleGuest(request);
      },
      distributionBuild,
      loadCapsuleSigningKeys: (purpose) => signingKeys.loadSigningKeys(purpose),
      artifactReadSecret: randomBytes(32),
      artifactReadMaximumTtlMs: ARTIFACT_READ_MAXIMUM_TTL_MS,
      functionDescriptorExtractor: new BunChildFunctionDescriptorExtractor({
        compiledExecutable: false,
        tempRoot: functionTempRoot,
      }),
      resolveTrustedPackageImport: resolveTrustedWidgetBuildPackageImport,
    }),
  });
  const eventPublisher = new EventPublisherService();
  const workspace = new WidgetWorkspace({
    dataPath: agentDataPath,
    npmUserConfigPath: NPM_USER_CONFIG_PATH,
  });
  const approvals = new ApprovalCoordinator();
  let controller: WidgetDraftController | undefined;
  try {
    await database.start();
    widgetPool.start({ hooks: {}, config: {} });
    await workspace.init();
    const cwd = await workspace.ensureChat(command.chatId);
    const owner = await widgetPool.forTenant(tenant);
    const draftController = new WidgetDraftController({
      tenant,
      workspace,
      eventPublisher: eventPublisher.forTenant(tenant),
      authoringStore: owner.authoringStore,
      widgets: createWidgetAuthoringCapability(widgetPool),
      resolveResourceBindings: async () => [],
      createId: randomUUID,
      nowMs: Date.now,
      builderIdentity,
      capsuleBuildIdentity: WIDGET_CAPSULE_BUILD_IDENTITY,
      buildPolicyId: WIDGET_CAPSULE_BUILD_POLICY_ID,
    });
    controller = draftController;
    const onDraftChanged = (change: Parameters<typeof draftController.handleToolChange>[0]) => (
      draftController.handleToolChange({ ...change, chatId: command.chatId })
    );
    const trackedNpmInstall = async (installCwd: string) => {
      telemetry.dependencyInstalls += 1;
      return txTryNpmInstall({ access, execFile, join }, {
        cwd: installCwd,
        userConfigPath: NPM_USER_CONFIG_PATH,
      });
    };
    const authorize = async () => true;
    const tools: TToolDefinition[] = [
      ...createWidgetWorkspaceTools({
        workspace,
        chatId: command.chatId,
        authorize,
        onDraftChanged,
        npmInstall: trackedNpmInstall,
      }),
      ...createWidgetPreviewTools({
        chatId: command.chatId,
        preview: draftController,
        authorize,
      }),
      ...createWorkspaceFileTools({
        workspace,
        chatId: command.chatId,
        cwd,
        authorize,
        onDraftChanged,
        npmInstall: trackedNpmInstall,
      }),
      ...createResourceTools({
        chatId: command.chatId,
        authorization: {
          accountId: tenant.accountId,
          requestId: tenant.requestId,
        },
        approvals,
        authorize,
      }),
    ];
    const executeOperation = async (operation: TOperation) => {
      const before = { ...telemetry };
      const startedAt = performance.now();
      let record: Record<string, unknown>;
      if ('tool' in operation) {
        const tool = tools.find((candidate) => candidate.name === operation.tool);
        if (!tool) {
          throw new Error(
            `Unknown tool '${operation.tool}'. Available: ${tools.map((item) => item.name).join(', ')}`,
          );
        }
        const result = await (tool.execute as (...args: unknown[]) => Promise<TToolResult>)(
          `widget-debug-tools-${randomUUID()}`,
          operation.args,
          undefined,
          undefined,
          {},
        );
        record = {
          tool: tool.name,
          isError: result.isError === true,
          modelData: resultModelData(result),
          details: result.details ?? null,
          ...boundedResultText(result),
        };
      } else if (operation.lab === 'preview') {
        const args = operation.args as { name?: unknown };
        if (typeof args.name !== 'string' || args.name.trim().length === 0) {
          throw new Error('Preview requires a widget name.');
        }
        const draft = await draftController.getByName(args.name);
        if (!draft) throw new Error(`Widget draft '${args.name}' was not found.`);
        const preview = await draftController.buildPreview(draft.draftId);
        record = preview.ready
          ? {
              lab: 'preview',
              isError: false,
              ready: true,
              name: preview.name,
              draftId: preview.draftId,
              revision: preview.revision,
              sourceIdentity: preview.revision,
              committedMutationId: preview.committedMutationId,
              uiArtifact: {
                digestSha256: preview.uiArtifact.digestSha256,
                byteSize: preview.uiArtifact.byteSize,
              },
              diagnostics: preview.diagnostics,
            }
          : {
              lab: 'preview',
              isError: true,
              ready: false,
              draftId: preview.draftId,
              revision: preview.revision ?? null,
              reason: preview.reason,
              message: preview.message,
              diagnostics: preview.diagnostics,
            };
      } else if (operation.lab === 'inspect-preview-owner') {
        const args = operation.args as { draftId?: unknown };
        if (typeof args.draftId !== 'string' || args.draftId.trim().length === 0) {
          throw new Error('Preview owner inspection requires a draft ID.');
        }
        const durableDraft = await owner.authoringStore.getDraft(
          tenant,
          args.draftId,
        );
        const durableChat = durableDraft === null
          ? null
          : await owner.authoringStore.getChat(tenant, durableDraft.chatId);
        const owners = durableDraft === null
          ? []
          : await owner.authoringStore.listPreviewOwners(
              tenant,
              { draftId: durableDraft.id, includeClosed: true },
            );
        record = {
          lab: 'inspect-preview-owner',
          isError: durableDraft === null,
          requestedExternalChatId: command.chatId,
          draft: durableDraft === null
            ? null
            : {
                id: durableDraft.id,
                chatId: durableDraft.chatId,
                sourceDigestSha256: durableDraft.sourceDigestSha256,
                committedMutationId: durableDraft.committedMutationId,
                buildSequence: durableDraft.buildSequence,
                status: durableDraft.status,
              },
          chat: durableChat === null
            ? null
            : {
                id: durableChat.id,
                externalSessionKey: durableChat.externalSessionKey,
                canvasId: durableChat.canvasId,
                externalSessionMatches:
                  durableChat.externalSessionKey === command.chatId,
              },
          owners: owners.map((previewOwner) => ({
            id: previewOwner.id,
            canvasId: previewOwner.canvasId,
            frameNodeId: previewOwner.frameNodeId,
            draftId: previewOwner.draftId,
            originChatId: previewOwner.originChatId,
            role: previewOwner.role,
            status: previewOwner.status,
            sourceDigestSha256: previewOwner.sourceDigestSha256,
            committedMutationId: previewOwner.committedMutationId,
            activeRevisionId: previewOwner.activeRevisionId,
            pendingBuildId: previewOwner.pendingBuildId,
            closedAtMs: previewOwner.closedAtMs,
            durableChatMatches: previewOwner.originChatId === durableDraft?.chatId,
            externalChatMatches: previewOwner.originChatId === command.chatId,
          })),
        };
      } else {
        const args = operation.args as { draftId?: unknown };
        if (typeof args.draftId !== 'string' || args.draftId.trim().length === 0) {
          throw new Error('Preview owner rebuild requires a draft ID.');
        }
        const durableDraft = await owner.authoringStore.getDraft(
          tenant,
          args.draftId,
        );
        if (durableDraft === null || durableDraft.status === 'discarded') {
          throw new Error(`Active widget draft '${args.draftId}' was not found.`);
        }
        const candidates = (await owner.authoringStore.listPreviewOwners(
          tenant,
          { draftId: durableDraft.id },
        )).filter((previewOwner) => (
          previewOwner.status !== 'closed'
          && previewOwner.role === 'companion'
          && (tenant.canvasId === undefined || previewOwner.canvasId === tenant.canvasId)
        ));
        if (candidates.length !== 1) {
          throw new Error(
            `Expected exactly one open companion Preview owner; found ${candidates.length}.`,
          );
        }
        const previewOwner = candidates[0]!;
        const preview = await draftController.buildPreview(durableDraft.id, {
          previewId: previewOwner.id,
          canvasId: previewOwner.canvasId,
          frameNodeId: previewOwner.frameNodeId,
        });
        record = {
          lab: 'rebuild-preview-owner',
          isError: !preview.ready,
          preview: preview.ready
            ? {
                ready: true,
                draftId: preview.draftId,
                previewId: preview.previewId,
                previewRevisionId: preview.previewRevisionId,
                revision: preview.revision,
                committedMutationId: preview.committedMutationId,
                buildSequence: preview.buildSequence,
                bindingRevision: preview.bindingRevision,
                diagnostics: preview.diagnostics,
              }
            : preview,
        };
      }
      const delta = {
        guestConstructions: telemetry.guestConstructions - before.guestConstructions,
        distributionBuilds: telemetry.distributionBuilds - before.distributionBuilds,
        dependencyInstalls: telemetry.dependencyInstalls - before.dependencyInstalls,
      };
      record.durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
      const buildRequested = 'lab' in operation
        ? operation.lab === 'preview' || operation.lab === 'rebuild-preview-owner'
        : operation.tool === 'od_widget_validate';
      record.build = {
        disposition: !buildRequested
          ? 'not-requested'
          : delta.guestConstructions === 0 && delta.distributionBuilds === 0
            ? 'reused'
            : 'constructed',
        ...delta,
        totals: { ...telemetry },
      };
      const assertionPassed = operation.expect === undefined
        ? null
        : matchesExpected(record, operation.expect);
      if (assertionPassed === false) {
        record.isError = true;
        record.assertion = { passed: false };
      } else if (assertionPassed === true) {
        record.assertion = { passed: true };
      }
      const expectedError = assertionPassed === true
        && operation.expect !== null
        && typeof operation.expect === 'object'
        && !Array.isArray(operation.expect)
        && (operation.expect as Record<string, unknown>).isError === true;
      if (record.isError === true && !expectedError) process.exitCode = 1;
      return record;
    };

    if (command.session) {
      const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
      let operationIndex = 0;
      for await (const rawLine of lines) {
        const line = rawLine.trim();
        if (line.length === 0) continue;
        operationIndex += 1;
        try {
          const record = await executeOperation(operationFromJson(line));
          console.log(JSON.stringify({ operation: operationIndex, ...record }));
        } catch (error) {
          process.exitCode = 1;
          console.log(JSON.stringify({
            operation: operationIndex,
            isError: true,
            message: error instanceof Error ? error.message : String(error),
          }));
        }
      }
      return;
    }
    if (command.operation === null) throw new Error('No lab operation was selected.');
    console.log(JSON.stringify(await executeOperation(command.operation), null, 2));
  } finally {
    approvals.close();
    await controller?.close();
    await widgetPool.stop();
    await database.stop();
  }
}

await run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
