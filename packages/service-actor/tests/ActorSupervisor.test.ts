import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { DbServiceTurso } from "@vibecanvas/service-db/DbServiceTurso/DbServiceTurso";
import { ActorSupervisor } from "../src/ActorSupervisor";
import type { TActorEvent } from "../src/Actor";
import path from "node:path";
import { access, cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import fundActorConfigJson from "./fixtures/account-fund-actor/vibecanvas.json";

const widgetDir = new URL("./fixtures", import.meta.url).pathname;
const configPath = new URL(".", import.meta.url).pathname;
const fundActorManifestPath = path.join("fixtures", "account-fund-actor", "vibecanvas.json");
const bookkeeperActorManifestPath = path.join("fixtures", "account-bookkeeper-actor", "vibecanvas.json");

type TNotification = {
  readonly type: "error" | "info" | "success" | "warning";
  readonly title: string;
  readonly description: string;
};

function createEventPublisherService(notifications: TNotification[], actorEvents: TActorEvent[]) {
  return {
    publishNotification: (notification: TNotification) => {
      notifications.push(notification);
    },
    publishActorEvent: (event: TActorEvent) => {
      actorEvents.push(event);
    },
  };
}

function createSupervisor(db: DbServiceTurso, notifications: TNotification[], actorEvents: TActorEvent[] = []) {
  return new ActorSupervisor({
    absWidgetDir: widgetDir,
    configPath,
    db,
    eventPublisherService: createEventPublisherService(notifications, actorEvents) as any,
  });
}

function createSupervisorWithPaths(args: {
  db: DbServiceTurso;
  notifications: TNotification[];
  actorEvents?: TActorEvent[];
  absWidgetDir: string;
  configPath: string;
}) {
  return new ActorSupervisor({
    absWidgetDir: args.absWidgetDir,
    configPath: args.configPath,
    db: args.db,
    eventPublisherService: createEventPublisherService(args.notifications, args.actorEvents ?? []) as any,
  });
}

async function waitForIdle(actor: { isIdle(): boolean }) {
  for (let index = 0; index < 100; index += 1) {
    if (actor.isIdle()) return;
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for actor to become idle");
}

async function waitForPersistedContext(db: DbServiceTurso, instanceId: string, expectedContext: unknown) {
  for (let index = 0; index < 100; index += 1) {
    const instance = await db.actor.getInstanceById(instanceId);
    const context = typeof instance?.machine_context === "string"
      ? JSON.parse(instance.machine_context)
      : instance?.machine_context;

    if (JSON.stringify(context) === JSON.stringify(expectedContext)) return;
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for actor context to persist");
}

async function waitForPersistedState(db: DbServiceTurso, instanceId: string, expectedState: string) {
  for (let index = 0; index < 100; index += 1) {
    const instance = await db.actor.getInstanceById(instanceId);
    if (instance?.machine_state === expectedState) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for actor state ${expectedState} to persist`);
}

describe("ActorSupervisor", () => {
  let db!: DbServiceTurso;
  let notifications!: TNotification[];

  beforeEach(async () => {
    db = new DbServiceTurso({
      databasePath: ":memory:",
      dataDir: widgetDir,
      cacheDir: widgetDir,
    });
    notifications = [];
    await db.start();
  });

  afterEach(async () => {
    await db.db.close();
  });

  test("init loads actor definitions from widget directory", async () => {
    const supervisor = createSupervisor(db, notifications);

    await supervisor.init();

    const definitions = await db.actor.listDefinitions();

    expect(Object.keys(supervisor.vibecanvasDefMap).sort()).toEqual([
      "Account Bookkeeper Test",
      "Account Funds Test",
      "Ping Pong Test",
    ]);
    expect(definitions.map(def => def.name).sort()).toEqual([
      "Account Bookkeeper Test",
      "Account Funds Test",
      "Ping Pong Test",
    ]);
    expect(notifications).toEqual([]);

    supervisor.closeActors();
  });

  test("init boots actor instances from db with saved state and data", async () => {
    await db.canvas.create({
      id: "canvas-1",
      name: "Actor Supervisor Test Canvas",
      automerge_url: "automerge:actor-supervisor-test",
    });

    await db.actor.insertDefinition({
      name: "Account Funds Test",
      slug: "account-funds-test",
      url: null,
      description: null,
      manifest_path: fundActorManifestPath,
    });
    await db.actor.insertDefinition({
      name: "Account Bookkeeper Test",
      slug: "account-bookkeeper-test",
      url: null,
      description: null,
      manifest_path: bookkeeperActorManifestPath,
    });

    await db.actor.insertInstance({
      id: "fund-instance-ready",
      canvas_id: "canvas-1",
      element_id: "element-fund-ready",
      actor_definition_name: "Account Funds Test",
      filesystem_id: null,
      display_name: "Fund Ready",
      status: "running",
      machine_state: "ready",
      machine_context: { balance: 125 },
    });
    await db.actor.insertInstance({
      id: "fund-instance-busy",
      canvas_id: "canvas-1",
      element_id: "element-fund-busy",
      actor_definition_name: "Account Funds Test",
      filesystem_id: null,
      display_name: "Fund Busy",
      status: "paused",
      machine_state: "busy.counting",
      machine_context: { balance: 55 },
    });
    await db.actor.insertInstance({
      id: "bookkeeper-instance-ready",
      canvas_id: "canvas-1",
      element_id: "element-bookkeeper-ready",
      actor_definition_name: "Account Bookkeeper Test",
      filesystem_id: null,
      display_name: "Bookkeeper Ready",
      status: "running",
      machine_state: "ready",
      machine_context: {
        entries: [
          {
            accountId: "1",
            amount: 25,
            balance: 25,
          },
        ],
      },
    });

    const updateInstanceHealth = spyOn(db.actor, "updateInstanceHealth");
    const supervisor = createSupervisor(db, notifications);

    await supervisor.init();

    expect(Object.keys(supervisor.actorMap).sort()).toEqual([
      "bookkeeper-instance-ready",
      "fund-instance-busy",
      "fund-instance-ready",
    ]);
    expect(supervisor.actorMap["fund-instance-ready"].getState()).toBe("ready");
    expect(supervisor.actorMap["fund-instance-ready"].getData()).toEqual({ balance: 125 });
    expect(supervisor.actorMap["fund-instance-busy"].getState()).toBe("busy.counting");
    expect(supervisor.actorMap["fund-instance-busy"].getData()).toEqual({ balance: 55 });
    expect(supervisor.actorMap["bookkeeper-instance-ready"].getState()).toBe("ready");
    expect(supervisor.actorMap["bookkeeper-instance-ready"].getData()).toEqual({
      entries: [
        {
          accountId: "1",
          amount: 25,
          balance: 25,
        },
      ],
    });
    const readyInstanceStatuses = updateInstanceHealth.mock.calls
      .map(([args]) => args)
      .filter((args) => args.id === "fund-instance-ready")
      .map((args) => args.status);
    expect(readyInstanceStatuses).toEqual(["starting", "running"]);

    supervisor.closeActors();
  });

  test("keeps loading persisted actors after one definition is unavailable", async () => {
    const supervisor = createSupervisor(db, notifications);
    await supervisor.init();
    supervisor.closeActors();

    await db.canvas.create({
      id: "canvas-isolation",
      name: "Isolation",
      automerge_url: "automerge:actor-isolation",
    });
    await db.actor.insertDefinition({
      name: "Unavailable Widget",
      slug: "unavailable-widget",
      url: null,
      description: null,
      manifest_path: "widgets/unavailable/vibecanvas.json",
    });
    await db.actor.insertInstance({
      id: "actor-bad-first",
      canvas_id: "canvas-isolation",
      element_id: "element-bad-first",
      actor_definition_name: "Unavailable Widget",
      filesystem_id: null,
      display_name: "Unavailable Widget",
      status: "created",
      machine_state: "idle",
      machine_context: {},
    });
    await db.actor.insertInstance({
      id: "actor-good-second",
      canvas_id: "canvas-isolation",
      element_id: "element-good-second",
      actor_definition_name: "Account Funds Test",
      filesystem_id: null,
      display_name: "Account Funds Test",
      status: "created",
      machine_state: "idle",
      machine_context: { balance: 10 },
    });

    await supervisor.init();

    expect(supervisor.actorMap["actor-bad-first"]).toBeUndefined();
    expect(supervisor.actorMap["actor-good-second"]).toBeDefined();
    expect(await db.actor.getInstanceById("actor-bad-first")).toMatchObject({
      status: "error",
      last_error: { code: "WIDGET_DEFINITION_UNAVAILABLE" },
    });
    expect(await db.actor.getInstanceById("actor-good-second")).toMatchObject({ status: "running", last_error: null });
    supervisor.closeActors();
  });

  test("publishes running status event when actor instance is created", async () => {
    await db.canvas.create({
      id: "canvas-create-instance",
      name: "Actor Create Instance Test Canvas",
      automerge_url: "automerge:actor-create-instance-test",
    });

    const publishedActorEvents: TActorEvent[] = [];
    const supervisor = createSupervisor(db, notifications, publishedActorEvents);

    await supervisor.init();
    const actor = await supervisor.createInstance("Account Funds Test", "canvas-create-instance", "element-created-fund");

    expect(actor?.getId()).toBeString();
    expect(publishedActorEvents).toContainEqual({
      kind: "system",
      actorId: actor?.getId(),
      type: "status.changed",
      from: null,
      to: "running",
    });

    supervisor.closeActors();
  });

  test("reload refreshes definitions and loads missing db instances without stopping running actors", async () => {
    await db.canvas.create({
      id: "canvas-reload",
      name: "Actor Reload Test Canvas",
      automerge_url: "automerge:actor-reload-test",
    });

    const supervisor = createSupervisor(db, notifications);

    await supervisor.init();
    const existingActor = await supervisor.createInstance("Account Funds Test", "canvas-reload", "element-existing-fund");
    if (!existingActor) throw new Error("Expected existing actor to be created");
    const existingActorId = existingActor.getId();
    const existingEvents: TActorEvent[] = [];
    existingActor.listen(event => existingEvents.push(event));

    await db.actor.insertInstance({
      id: "fund-reload-new",
      canvas_id: "canvas-reload",
      element_id: "element-fund-reload-new",
      actor_definition_name: "Account Funds Test",
      filesystem_id: null,
      display_name: "Fund Reload New",
      status: "created",
      machine_state: "ready",
      machine_context: { balance: 7 },
    });

    await supervisor.reload();

    expect(supervisor.actorMap[existingActorId]).toBe(existingActor);
    expect(existingEvents).not.toContainEqual({
      kind: "system",
      actorId: existingActorId,
      type: "status.changed",
      from: "running",
      to: "stopped",
    });
    expect(supervisor.actorMap["fund-reload-new"].getData()).toEqual({ balance: 7 });

    supervisor.closeActors();
  });

  test("persists actor machine data after successful inbox processing", async () => {
    await db.canvas.create({
      id: "canvas-persist-machine",
      name: "Actor Persistence Test Canvas",
      automerge_url: "automerge:actor-persistence-test",
    });

    await db.actor.insertDefinition({
      name: "Account Funds Test",
      slug: "account-funds-test",
      url: null,
      description: null,
      manifest_path: fundActorManifestPath,
    });

    await db.actor.insertInstance({
      id: "fund-persist",
      canvas_id: "canvas-persist-machine",
      element_id: "element-fund-persist",
      actor_definition_name: "Account Funds Test",
      filesystem_id: null,
      display_name: "Fund Persist",
      status: "running",
      machine_state: "ready",
      machine_context: { balance: 0 },
    });

    const supervisor = createSupervisor(db, notifications);

    await supervisor.init();
    supervisor.actorMap["fund-persist"].inbox("add-funds", {accountId: "1", amount: 42});
    await waitForIdle(supervisor.actorMap["fund-persist"]);
    await waitForPersistedContext(db, "fund-persist", { balance: 42 });

    const instance = await db.actor.getInstanceById("fund-persist");
    expect(instance?.machine_state).toBe("ready");

    supervisor.closeActors();
  });

  test("persists startup lifecycle and activity snapshots without an input ack", async () => {
    const tempConfigPath = await mkdtemp(path.join(tmpdir(), "vibecanvas-actor-activity-persist-"));
    const tempWidgetDir = path.join(tempConfigPath, "widgets");
    const tempDefinitionDir = path.join(tempWidgetDir, "activity-persist");
    await cp(path.join(widgetDir, "account-fund-actor"), tempDefinitionDir, { recursive: true });

    const manifest = structuredClone(fundActorConfigJson) as any;
    manifest.name = "Activity Persist Test";
    manifest.slug = "activity-persist-test";
    manifest.actor.initialState = "busy.counting";
    manifest.actor.initialData = { events: [], ticks: 0 };
    manifest.actor.states = {
      "busy.counting": {
        on: {},
        onEnter: ["tx.record"],
        activity: { everyMs: 1000, runImmediately: true, func: ["tx.activityTick"] },
      },
      error: { on: {} },
    };
    manifest.actor.inputMsgSchema = {};
    await writeFile(path.join(tempDefinitionDir, "vibecanvas.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    try {
      await db.canvas.create({
        id: "canvas-activity-persist",
        name: "Activity Persist",
        automerge_url: "automerge:activity-persist",
      });
      const actorEvents: TActorEvent[] = [];
      const supervisor = createSupervisorWithPaths({
        db,
        notifications,
        actorEvents,
        absWidgetDir: tempWidgetDir,
        configPath: tempConfigPath,
      });
      await supervisor.init();
      const actor = await supervisor.createInstance("Activity Persist Test", "canvas-activity-persist", "element-activity-persist");
      if (!actor) throw new Error("Expected activity actor to be created");

      await waitForPersistedContext(db, actor.getId(), { events: ["lifecycle.enter"], ticks: 1 });
      expect(actorEvents.some(event => event.kind === "system" && event.type === "snapshot" && event.cause === "startup")).toBe(true);
      expect(actorEvents.some(event => event.kind === "system" && event.type === "snapshot" && event.cause === "activity")).toBe(true);
      expect(actorEvents
        .filter((event): event is Extract<TActorEvent, { kind: "system"; type: "snapshot" }> => event.kind === "system" && event.type === "snapshot")
        .map(event => event.revision)).toEqual([1, 2]);
      expect(actorEvents.some(event => event.kind === "system" && event.type === "ack")).toBe(false);
      supervisor.closeActors();
    } finally {
      await rm(tempConfigPath, { recursive: true, force: true });
    }
  });

  test("persists implicit error state produced by an activity failure", async () => {
    const tempConfigPath = await mkdtemp(path.join(tmpdir(), "vibecanvas-actor-error-persist-"));
    const tempWidgetDir = path.join(tempConfigPath, "widgets");
    const tempDefinitionDir = path.join(tempWidgetDir, "error-persist");
    await cp(path.join(widgetDir, "account-fund-actor"), tempDefinitionDir, { recursive: true });

    const manifest = structuredClone(fundActorConfigJson) as any;
    manifest.name = "Error Persist Test";
    manifest.slug = "error-persist-test";
    manifest.actor.initialState = "busy.counting";
    manifest.actor.initialData = { balance: 0 };
    manifest.actor.states = {
      "busy.counting": {
        on: {},
        activity: { everyMs: 1000, runImmediately: true, func: ["fn.throw"] },
      },
      error: { on: {} },
    };
    manifest.actor.inputMsgSchema = {};
    await writeFile(path.join(tempDefinitionDir, "vibecanvas.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    try {
      await db.canvas.create({
        id: "canvas-error-persist",
        name: "Error Persist",
        automerge_url: "automerge:error-persist",
      });
      const supervisor = createSupervisorWithPaths({
        db,
        notifications,
        absWidgetDir: tempWidgetDir,
        configPath: tempConfigPath,
      });
      await supervisor.init();
      const actor = await supervisor.createInstance("Error Persist Test", "canvas-error-persist", "element-error-persist");
      if (!actor) throw new Error("Expected error actor to be created");

      await waitForPersistedState(db, actor.getId(), "error");
      expect(actor.getState()).toBe("error");
      expect((await db.actor.getInstanceById(actor.getId()))?.status).toBe("running");
      supervisor.closeActors();
    } finally {
      await rm(tempConfigPath, { recursive: true, force: true });
    }
  });

  test("routes emitted actor messages to connected target actors", async () => {
    await db.canvas.create({
      id: "canvas-connection",
      name: "Actor Connection Test Canvas",
      automerge_url: "automerge:actor-connection-test",
    });

    await db.actor.insertDefinition({
      name: "Account Funds Test",
      slug: "account-funds-test",
      url: null,
      description: null,
      manifest_path: fundActorManifestPath,
    });
    await db.actor.insertDefinition({
      name: "Account Bookkeeper Test",
      slug: "account-bookkeeper-test",
      url: null,
      description: null,
      manifest_path: bookkeeperActorManifestPath,
    });

    await db.actor.insertInstance({
      id: "fund-source",
      canvas_id: "canvas-connection",
      element_id: "element-fund-source",
      actor_definition_name: "Account Funds Test",
      filesystem_id: null,
      display_name: "Fund Source",
      status: "running",
      machine_state: "ready",
      machine_context: { balance: 0 },
    });
    await db.actor.insertInstance({
      id: "bookkeeper-target",
      canvas_id: "canvas-connection",
      element_id: "element-bookkeeper-target",
      actor_definition_name: "Account Bookkeeper Test",
      filesystem_id: null,
      display_name: "Bookkeeper Target",
      status: "running",
      machine_state: "ready",
      machine_context: { entries: [] },
    });

    await db.actor.insertConnection({
      id: "connection-fund-to-bookkeeper",
      canvas_id: "canvas-connection",
      source_actor_instance_id: "fund-source",
      target_actor_instance_id: "bookkeeper-target",
      enabled: true,
      label: null,
      msg_name_whitelist: JSON.stringify(["funds-added"]),
      style: {},
    });

    const publishedActorEvents: TActorEvent[] = [];
    const supervisor = createSupervisor(db, notifications, publishedActorEvents);

    await supervisor.init();
    const sourceEvents: TActorEvent[] = [];
    const targetEvents: TActorEvent[] = [];
    supervisor.listenToActorEvents("fund-source", event => sourceEvents.push(event));
    supervisor.listenToActorEvents("bookkeeper-target", event => targetEvents.push(event));

    const messageId = supervisor.actorMap["fund-source"].inbox("add-funds", {accountId: "1", amount: 42});
    await waitForIdle(supervisor.actorMap["fund-source"]);
    await waitForIdle(supervisor.actorMap["bookkeeper-target"]);

    expect(messageId).toBeString();
    expect(sourceEvents).toContainEqual({
      kind: "system",
      actorId: "fund-source",
      type: "data.changed",
      data: { balance: 42 },
      messageId,
    });
    expect(sourceEvents).toContainEqual({
      kind: "actor",
      actorId: "fund-source",
      name: "funds-added",
      payload: { accountId: "1", amount: 42, balance: 42 },
      messageId,
    });
    expect(sourceEvents).toContainEqual({
      kind: "system",
      actorId: "fund-source",
      type: "ack",
      inputName: "add-funds",
      messageId,
    });
    expect(targetEvents.some(event => event.kind === "system" && event.type === "data.changed")).toBe(true);
    expect(targetEvents.some(event => event.kind === "system" && event.type === "ack")).toBe(true);
    expect(publishedActorEvents).toContainEqual({
      kind: "actor",
      actorId: "fund-source",
      name: "funds-added",
      payload: { accountId: "1", amount: 42, balance: 42 },
      messageId,
    });
    expect(publishedActorEvents.some(event => event.kind === "system" && event.type === "data.changed")).toBe(true);

    expect(supervisor.connectionMap["fund-source"].map(connection => connection.id)).toEqual([
      "connection-fund-to-bookkeeper",
    ]);
    expect(supervisor.actorMap["bookkeeper-target"].getData()).toEqual({
      entries: [
        {
          accountId: "1",
          amount: 42,
          balance: 42,
        },
      ],
    });

    supervisor.closeActors();
  });

  test("deleteDefinition removes instances, db definition, and widget files", async () => {
    const tempConfigPath = await mkdtemp(path.join(tmpdir(), "vibecanvas-actor-delete-"));
    const tempWidgetDir = path.join(tempConfigPath, "widgets");
    const tempDefinitionDir = path.join(tempWidgetDir, "account-fund-actor");
    await cp(path.join(widgetDir, "account-fund-actor"), tempDefinitionDir, { recursive: true });

    try {
      await db.canvas.create({
        id: "canvas-delete-definition",
        name: "Actor Delete Definition Test Canvas",
        automerge_url: "automerge:actor-delete-definition-test",
      });

      const supervisor = createSupervisorWithPaths({
        db,
        notifications,
        absWidgetDir: tempWidgetDir,
        configPath: tempConfigPath,
      });

      await supervisor.init();
      const actor = await supervisor.createInstance("Account Funds Test", "canvas-delete-definition", "element-delete-definition");
      if (!actor) throw new Error("Expected actor to be created");

      const deleted = await supervisor.deleteDefinition("Account Funds Test");

      expect(deleted).toBe(true);
      expect(supervisor.vibecanvasDefMap["Account Funds Test"]).toBeUndefined();
      expect(supervisor.actorMap[actor.getId()]).toBeUndefined();
      expect(await db.actor.getDefinition("Account Funds Test")).toBeUndefined();
      expect(await db.actor.getInstanceById(actor.getId())).toBeUndefined();
      await expect(access(tempDefinitionDir)).rejects.toThrow();

      supervisor.closeActors();
    } finally {
      await rm(tempConfigPath, { recursive: true, force: true });
    }
  });
});
