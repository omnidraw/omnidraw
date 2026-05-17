import type { IPlugin } from '@vibecanvas/runtime';
import type { ActorService } from '@vibecanvas/service-actor';
import type { IDbService } from '@vibecanvas/service-db/IDbService';
import type { TDrizzleDb } from '@vibecanvas/service-db/DbServiceBunSqlite/index';
import * as schema from '@vibecanvas/service-db/schema';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ICliConfig } from '../../config';
import type { ICliHooks } from '../../hooks';

const ACTOR_SANDBOX_HOST_DATA_DIR = '/home/vibecanvas/host-data';

type TJsonRecord = Record<string, unknown>;

type TActorJson = {
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  functions?: unknown;
  initialState?: unknown;
  initialContext?: unknown;
  states?: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
};

type TVibecanvasJson = {
  id?: unknown;
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  actor?: TActorJson;
  widget?: unknown;
  frontend?: unknown;
};

type TDbBackedService = IDbService & {
  drizzle?: TDrizzleDb;
};

function isRecord(value: unknown): value is TJsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function asRecord(value: unknown): TJsonRecord {
  return isRecord(value) ? value : {};
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function getDrizzle(db: IDbService): TDrizzleDb | null {
  return (db as TDbBackedService).drizzle ?? null;
}

function guestDataPath(config: ICliConfig, hostPath: string): string {
  if (!hostPath.startsWith(config.dataPath)) return hostPath;
  return `${ACTOR_SANDBOX_HOST_DATA_DIR}${hostPath.slice(config.dataPath.length)}`;
}

function upsertWidgetActor(args: {
  db: TDrizzleDb;
  cliConfig: ICliConfig;
  widgetDir: string;
  vibecanvasJsonPath: string;
  widgetConfig: TVibecanvasJson;
}) {
  const actor = args.widgetConfig.actor ?? {};
  const functionsRelativePath = asString(actor.functions, 'actor/functions.ts');
  const functionsHostPath = join(args.widgetDir, functionsRelativePath);

  if (!existsSync(functionsHostPath)) return false;

  const fallbackSlug = asString(args.widgetConfig.slug, basename(args.widgetDir));
  const slug = asString(actor.slug, fallbackSlug);
  const widgetId = asString(args.widgetConfig.id, fallbackSlug);
  const name = asString(actor.name, asString(args.widgetConfig.name, slug));
  const description = typeof actor.description === 'string'
    ? actor.description
    : typeof args.widgetConfig.description === 'string' ? args.widgetConfig.description : null;
  const functionsGuestPath = guestDataPath(args.cliConfig, functionsHostPath);
  const machineConfig = {
    initialState: asString(actor.initialState, 'ready'),
    initialContext: actor.initialContext ?? {},
    states: asRecord(actor.states),
  };
  const serverManifest = {
    modulePath: functionsGuestPath,
    entrypoint: functionsGuestPath,
    functionsPath: functionsGuestPath,
  };
  const uiManifest = {
    vibecanvasJsonPath: args.vibecanvasJsonPath,
    widgetDir: args.widgetDir,
    widget: args.widgetConfig.widget ?? {},
    frontend: args.widgetConfig.frontend ?? {},
  };

  args.db.insert(schema.actor_definitions).values({
    id: `widget:${slug}`,
    name,
    slug,
    description,
    widget_id: widgetId,
    widget_dir: args.widgetDir,
    actor_json_path: args.vibecanvasJsonPath,
    functions_path: functionsGuestPath,
    machine_schema: {},
    machine_config: machineConfig,
    contract_schema: asRecord(actor.inputSchema),
    output_schema: asRecord(actor.outputSchema),
    server_manifest: serverManifest,
    ui_manifest: uiManifest,
    updated_at: new Date(),
  }).onConflictDoUpdate({
    target: schema.actor_definitions.slug,
    set: {
      name,
      description,
      widget_id: widgetId,
      widget_dir: args.widgetDir,
      actor_json_path: args.vibecanvasJsonPath,
      functions_path: functionsGuestPath,
      machine_schema: {},
      machine_config: machineConfig,
      contract_schema: asRecord(actor.inputSchema),
      output_schema: asRecord(actor.outputSchema),
      server_manifest: serverManifest,
      ui_manifest: uiManifest,
      updated_at: new Date(),
    },
  }).run();

  return true;
}

function sourceWidgets(args: { db: TDrizzleDb; config: ICliConfig }) {
  const widgetsDir = join(args.config.dataPath, 'widgets');
  if (!existsSync(widgetsDir)) return 0;

  let count = 0;
  for (const entry of readdirSync(widgetsDir)) {
    const widgetDir = join(widgetsDir, entry);
    if (!statSync(widgetDir).isDirectory()) continue;

    const vibecanvasJsonPath = join(widgetDir, 'vibecanvas.json');
    if (!existsSync(vibecanvasJsonPath)) continue;

    const widgetConfig = readJsonFile(vibecanvasJsonPath) as TVibecanvasJson;
    if (upsertWidgetActor({ db: args.db, cliConfig: args.config, widgetDir, vibecanvasJsonPath, widgetConfig })) {
      count += 1;
    }
  }

  return count;
}

function createWidgetPlugin(): IPlugin<{ db: IDbService; actor?: ActorService }, ICliHooks, ICliConfig> {
  return {
    name: 'widget',
    apply(ctx) {
      ctx.hooks.boot.tapPromise(async () => {
        if (ctx.config.helpRequested || ctx.config.versionRequested) return;

        const dbService = ctx.services.get('db');
        if (!dbService) return;

        const db = getDrizzle(dbService);
        if (!db) return;

        sourceWidgets({ db, config: ctx.config });

        const actorService = ctx.services.get('actor');
        await actorService?.supervisor.loadActors();
      });
    },
  };
}

export { createWidgetPlugin, sourceWidgets };
