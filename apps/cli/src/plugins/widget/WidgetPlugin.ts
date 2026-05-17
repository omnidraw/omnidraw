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

type TWidgetJson = {
  id?: unknown;
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  actor?: {
    definition?: unknown;
    functions?: unknown;
  };
  frontend?: unknown;
  messages?: unknown;
};

type TActorJson = {
  slug?: unknown;
  name?: unknown;
  description?: unknown;
  initialState?: unknown;
  initialContext?: unknown;
  states?: unknown;
  inputSchema?: unknown;
  outputSchema?: unknown;
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
  config: ICliConfig;
  widgetDir: string;
  widgetJsonPath: string;
  widget: TWidgetJson;
}) {
  const actorRef = isRecord(args.widget.actor) ? args.widget.actor : {};
  const actorJsonRelativePath = asString(actorRef.definition, 'actor/actor.json');
  const functionsRelativePath = asString(actorRef.functions, 'actor/functions.ts');
  const actorJsonHostPath = join(args.widgetDir, actorJsonRelativePath);
  const functionsHostPath = join(args.widgetDir, functionsRelativePath);

  if (!existsSync(actorJsonHostPath) || !existsSync(functionsHostPath)) return false;

  const actor = readJsonFile(actorJsonHostPath) as TActorJson;
  const fallbackSlug = asString(args.widget.slug, basename(args.widgetDir));
  const slug = asString(actor.slug, fallbackSlug);
  const widgetId = asString(args.widget.id, fallbackSlug);
  const name = asString(actor.name, asString(args.widget.name, slug));
  const description = typeof actor.description === 'string'
    ? actor.description
    : typeof args.widget.description === 'string' ? args.widget.description : null;
  const functionsGuestPath = guestDataPath(args.config, functionsHostPath);

  args.db.insert(schema.actor_definitions).values({
    id: `widget:${slug}`,
    name,
    slug,
    description,
    widget_id: widgetId,
    widget_dir: args.widgetDir,
    actor_json_path: actorJsonHostPath,
    functions_path: functionsGuestPath,
    machine_schema: {},
    machine_config: {
      initialState: asString(actor.initialState, 'ready'),
      initialContext: actor.initialContext ?? {},
      states: asRecord(actor.states),
    },
    contract_schema: asRecord(actor.inputSchema),
    output_schema: asRecord(actor.outputSchema),
    server_manifest: {
      modulePath: functionsGuestPath,
      entrypoint: functionsGuestPath,
      functionsPath: functionsGuestPath,
    },
    ui_manifest: {
      widgetJsonPath: args.widgetJsonPath,
      widgetDir: args.widgetDir,
      frontend: args.widget.frontend ?? {},
      messages: args.widget.messages ?? {},
    },
    updated_at: new Date(),
  }).onConflictDoUpdate({
    target: schema.actor_definitions.slug,
    set: {
      name,
      description,
      widget_id: widgetId,
      widget_dir: args.widgetDir,
      actor_json_path: actorJsonHostPath,
      functions_path: functionsGuestPath,
      machine_schema: {},
      machine_config: {
        initialState: asString(actor.initialState, 'ready'),
        initialContext: actor.initialContext ?? {},
        states: asRecord(actor.states),
      },
      contract_schema: asRecord(actor.inputSchema),
      output_schema: asRecord(actor.outputSchema),
      server_manifest: {
        modulePath: functionsGuestPath,
        entrypoint: functionsGuestPath,
        functionsPath: functionsGuestPath,
      },
      ui_manifest: {
        widgetJsonPath: args.widgetJsonPath,
        widgetDir: args.widgetDir,
        frontend: args.widget.frontend ?? {},
        messages: args.widget.messages ?? {},
      },
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

    const widgetJsonPath = join(widgetDir, 'widget.json');
    if (!existsSync(widgetJsonPath)) continue;

    const widget = readJsonFile(widgetJsonPath) as TWidgetJson;
    if (upsertWidgetActor({ db: args.db, config: args.config, widgetDir, widgetJsonPath, widget })) {
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
