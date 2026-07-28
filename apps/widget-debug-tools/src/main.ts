import { buildCapsuleGuest } from '@vibecanvas/capsule-vibecanvas/build';
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
import { BunChildFunctionDescriptorExtractor } from '@vibecanvas/function-runtime/local';
import { ApprovalCoordinator } from '@vibecanvas/service-agent/approval/ApprovalCoordinator';
import { createResourceTools } from '@vibecanvas/service-agent/tools/tool.resources';
import { createWidgetWorkspaceTools } from '@vibecanvas/service-agent/tools/tool.widget-workspace';
import { createWorkspaceFileTools } from '@vibecanvas/service-agent/tools/tool.workspace-files';
import type { TToolDefinition } from '@vibecanvas/service-agent/tools/types';
import { WidgetDraftController } from '@vibecanvas/service-agent/widget-drafts/WidgetDraftController';
import { WidgetWorkspace } from '@vibecanvas/service-agent/workspace/WidgetWorkspace';
import {
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_CELL_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
} from '@vibecanvas/service-db/CONSTANTS';
import { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { EventPublisherService } from '@vibecanvas/service-event-publisher/EventPublisherService';
import { fnFreezeTenantContext } from '@vibecanvas/tenant-core';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const REPOSITORY_ROOT = resolve(import.meta.dir, '../../..');
const DEFAULT_HOME = join(REPOSITORY_ROOT, '.vibecanvas');
const NPM_USER_CONFIG_PATH = fnLocalRegistryNpmUserConfig({
  homeDirectory: homedir(),
  stateDirectory: process.env.VIBECANVAS_REGISTRY_STATE_DIR,
  join,
});
const CHAT_ID = 'widget-debug-tools';
const ARTIFACT_READ_MAXIMUM_TTL_MS = 5 * 60 * 1_000;
const TRUSTED_WIDGET_BUILD_PACKAGE_IMPORTS = Object.freeze([
  '@vibecanvas/sdk/server',
  'zod',
]);

type TCommand = Readonly<{
  home: string;
  toolName: string;
  args: unknown;
}>;

type TToolResult = Readonly<{
  content?: readonly Readonly<{ type?: string; text?: string }>[];
  details?: unknown;
  isError?: boolean;
}>;

function usage(): string {
  return [
    'Usage:',
    "  bun run lab -- [--home <path>] <tool-name> '<json-args>'",
    '  bun run lab -- [--home <path>] create <name>',
    '  bun run lab -- [--home <path>] validate <name>',
    '  bun run lab -- [--home <path>] list',
  ].join('\n');
}

function parseCommand(argv: readonly string[]): TCommand {
  const values = [...argv];
  let home = DEFAULT_HOME;
  const homeIndex = values.indexOf('--home');
  if (homeIndex !== -1) {
    const selected = values[homeIndex + 1];
    if (!selected) throw new Error('--home requires a path.');
    home = resolve(process.cwd(), selected);
    values.splice(homeIndex, 2);
  }
  const command = values.shift();
  if (!command) throw new Error(usage());
  if (command === 'create' || command === 'validate') {
    const name = values.join(' ').trim();
    if (!name) throw new Error(`${command} requires a widget name.`);
    return {
      home,
      toolName: command === 'create' ? 'vc_widget_create' : 'vc_widget_validate',
      args: { name },
    };
  }
  if (command === 'list') {
    if (values.length > 0) throw new Error('list does not accept arguments.');
    return { home, toolName: 'vc_widget_list', args: {} };
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
  return { home, toolName: command, args };
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
    silentMigrations: process.env.VIBECANVAS_SILENT_DB_MIGRATIONS === '1',
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
      capsuleBuild: buildCapsuleGuest,
      distributionBuild: createWidgetNpmDistributionBuild({
        scratchDirectory: buildTempRoot,
        npmUserConfigPath: NPM_USER_CONFIG_PATH,
      }),
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
    const cwd = await workspace.ensureChat(CHAT_ID);
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
      draftController.handleToolChange({ ...change, chatId: CHAT_ID })
    );
    const authorize = async () => true;
    const tools: TToolDefinition[] = [
      ...createWidgetWorkspaceTools({
        workspace,
        chatId: CHAT_ID,
        authorize,
        onDraftChanged,
      }),
      ...createWorkspaceFileTools({
        workspace,
        chatId: CHAT_ID,
        cwd,
        authorize,
        onDraftChanged,
      }),
      ...createResourceTools({
        chatId: CHAT_ID,
        authorization: {
          accountId: tenant.accountId,
          requestId: tenant.requestId,
        },
        approvals,
        authorize,
      }),
    ];
    const tool = tools.find((candidate) => candidate.name === command.toolName);
    if (!tool) {
      throw new Error(
        `Unknown tool '${command.toolName}'. Available: ${tools.map((item) => item.name).join(', ')}`,
      );
    }
    const result = await (tool.execute as (...args: unknown[]) => Promise<TToolResult>)(
      `widget-debug-tools-${randomUUID()}`,
      command.args,
      undefined,
      undefined,
      {},
    );
    console.log(JSON.stringify({
      tool: tool.name,
      isError: result.isError === true,
      modelData: resultModelData(result),
      details: result.details ?? null,
    }, null, 2));
    if (result.isError) process.exitCode = 1;
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
