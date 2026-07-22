import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { DbServiceTurso } from "@vibecanvas/service-db/DbServiceTurso/DbServiceTurso";
import { EventPublisherService } from "@vibecanvas/service-event-publisher/EventPublisherService";
import type { ITenantEventPublisherService } from "@vibecanvas/service-event-publisher/IEventPublisherService";
import { ActorSupervisor } from "../src/ActorSupervisor";
import type { TActorEvent } from "../src/Actor";
import type { TActorStartAdmission } from "../src/legacy/resource-protocol";
import path from "node:path";
import { access, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import fundActorConfigJson from "./fixtures/account-fund-actor/vibecanvas.json";
import { createTestCrypto, testUuid } from "./test-uuid";
import { bindTestTenantDb, TEST_TENANT, type TActorTestDb } from "./tenant.fixture";

const widgetDir = new URL("./fixtures", import.meta.url).pathname;
const configPath = new URL(".", import.meta.url).pathname;
const fundActorManifestPath = path.join("fixtures", "account-fund-actor", "vibecanvas.json");
const bookkeeperActorManifestPath = path.join("fixtures", "account-bookkeeper-actor", "vibecanvas.json");

type TNotification = {
  readonly type: "error" | "info" | "success" | "warning";
  readonly title: string;
  readonly description: string;
};

function createEventPublisherService(
  notifications: TNotification[],
  actorEvents: TActorEvent[],
): ITenantEventPublisherService {
  const publisher = new EventPublisherService().forTenant(TEST_TENANT);
  return {
    ...publisher,
    publishNotification: (notification: TNotification) => {
      notifications.push(notification);
      return publisher.publishNotification(notification);
    },
    publishActorEvent: (event: TActorEvent) => {
      actorEvents.push(event);
      return publisher.publishActorEvent(event);
    },
  };
}

function createSupervisor(db: TActorTestDb, notifications: TNotification[], actorEvents: TActorEvent[] = []) {
  return new ActorSupervisor({
    absWidgetDir: widgetDir,
    configPath,
    db,
    crypto: createTestCrypto("actor-supervisor"),
    eventPublisherService: createEventPublisherService(notifications, actorEvents),
  });
}

function createSupervisorWithPaths(args: {
  db: TActorTestDb;
  notifications: TNotification[];
  actorEvents?: TActorEvent[];
  absWidgetDir: string;
  configPath: string;
  actorShutdownTimeoutMs?: number;
}) {
  return new ActorSupervisor({
    absWidgetDir: args.absWidgetDir,
    configPath: args.configPath,
    db: args.db,
    crypto: createTestCrypto("actor-supervisor-with-paths"),
    eventPublisherService: createEventPublisherService(args.notifications, args.actorEvents ?? []),
    actorShutdownTimeoutMs: args.actorShutdownTimeoutMs,
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForIdle(actor: { isIdle(): boolean }) {
  for (let index = 0; index < 100; index += 1) {
    if (actor.isIdle()) return;
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for actor to become idle");
}

async function waitForPersistedContext(db: TActorTestDb, instanceId: string, expectedContext: unknown) {
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

async function waitForPersistedState(db: TActorTestDb, instanceId: string, expectedState: string) {
  for (let index = 0; index < 100; index += 1) {
    const instance = await db.actor.getInstanceById(instanceId);
    if (instance?.machine_state === expectedState) return;
    await Bun.sleep(10);
  }
  throw new Error(`Timed out waiting for actor state ${expectedState} to persist`);
}

describe("ActorSupervisor", () => {
  let dbService!: DbServiceTurso;
  let db!: TActorTestDb;
  let notifications!: TNotification[];

  beforeEach(async () => {
    dbService = new DbServiceTurso({
      databasePath: ":memory:",
      dataDir: widgetDir,
      cacheDir: widgetDir,
    });
    notifications = [];
    await dbService.start();
    db = bindTestTenantDb(dbService);
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

    await supervisor.closeActors();
  });

  test("definition-only reload does not start persisted instances", async () => {
    const supervisor = createSupervisor(db, notifications);
    await supervisor.init();
    await db.canvas.create({
      id: testUuid("publication-canvas"),
      name: "Publication Canvas",
      automerge_url: "automerge:publication-canvas",
    });
    await db.actor.insertInstance({
      id: testUuid("publication-instance"),
      canvas_id: testUuid("publication-canvas"),
      element_id: "publication-element",
      actor_definition_name: "Account Funds Test",
      display_name: "Publication instance",
      status: "created",
      machine_state: "ready",
      machine_context: { balance: 0 },
    });

    await supervisor.reloadDefinitionsOnly();
    expect(supervisor.actorMap[testUuid("publication-instance")]).toBeUndefined();
    await supervisor.closeActors();
  });

  test("definition reload prefers the canonical slug directory over a legacy duplicate", async () => {
    const tempConfigPath = await mkdtemp(path.join(tmpdir(), "vibecanvas-actor-duplicate-"));
    const tempWidgetDir = path.join(tempConfigPath, "widgets");
    const canonicalDir = path.join(tempWidgetDir, "todo-actor-system");
    const legacyDir = path.join(tempWidgetDir, "sdk-test");
    const publicationBackupDir = path.join(tempWidgetDir, ".publish-backup-test");
    const reconcileDir = path.join(tempWidgetDir, ".reconcile-test");
    await mkdir(canonicalDir, { recursive: true });
    await mkdir(legacyDir, { recursive: true });
    await mkdir(publicationBackupDir, { recursive: true });
    await mkdir(reconcileDir, { recursive: true });

    const identity = {
      name: "Todo Actor System",
      slug: "todo-actor-system",
    };
    const canonicalManifest = {
      ...fundActorConfigJson,
      ...identity,
      version: "0.2.0",
      actor: {
        ...fundActorConfigJson.actor,
        resources: {
          todos: { kind: "kv", required: true, scope: ["read", "write"] },
        },
      },
    };
    const legacyManifest = {
      ...fundActorConfigJson,
      ...identity,
      version: "0.1.0",
    };
    await writeFile(path.join(canonicalDir, "vibecanvas.json"), JSON.stringify(canonicalManifest), "utf8");
    await writeFile(path.join(legacyDir, "vibecanvas.json"), JSON.stringify(legacyManifest), "utf8");
    await writeFile(path.join(publicationBackupDir, "vibecanvas.json"), JSON.stringify(legacyManifest), "utf8");
    await writeFile(path.join(reconcileDir, "vibecanvas.json"), JSON.stringify(legacyManifest), "utf8");

    const supervisor = createSupervisorWithPaths({
      db,
      notifications,
      absWidgetDir: tempWidgetDir,
      configPath: tempConfigPath,
    });

    try {
      await supervisor.reloadDefinitionsOnly();

      expect(supervisor.vibecanvasDefMap[identity.name]).toMatchObject({
        version: "0.2.0",
        manifest_path: "widgets/todo-actor-system/vibecanvas.json",
        actor: {
          resources: {
            todos: { kind: "kv", required: true, scope: ["read", "write"] },
          },
        },
      });
      await expect(db.actor.getDefinition(identity.name)).resolves.toMatchObject({
        manifest_path: "widgets/todo-actor-system/vibecanvas.json",
      });
      expect(notifications).toContainEqual({
        type: "warning",
        title: "Ignored duplicate actor definition",
        description: expect.stringContaining("widgets/sdk-test/vibecanvas.json"),
      });
      expect(notifications.some((notification) => notification.description.includes(".publish-"))).toBe(false);
      expect(notifications.some((notification) => notification.description.includes(".reconcile-"))).toBe(false);
    } finally {
      await supervisor.closeActors();
      await rm(tempConfigPath, { recursive: true, force: true });
    }
  });

  test("definition reload excludes duplicate names without one canonical slug directory", async () => {
    const tempConfigPath = await mkdtemp(path.join(tmpdir(), "vibecanvas-actor-ambiguous-"));
    const tempWidgetDir = path.join(tempConfigPath, "widgets");
    const firstDir = path.join(tempWidgetDir, "legacy-first");
    const secondDir = path.join(tempWidgetDir, "legacy-second");
    await mkdir(firstDir, { recursive: true });
    await mkdir(secondDir, { recursive: true });

    const manifest = {
      ...fundActorConfigJson,
      name: "Ambiguous Actor",
      slug: "ambiguous-actor",
    };
    await writeFile(path.join(firstDir, "vibecanvas.json"), JSON.stringify(manifest), "utf8");
    await writeFile(path.join(secondDir, "vibecanvas.json"), JSON.stringify(manifest), "utf8");

    const supervisor = createSupervisorWithPaths({
      db,
      notifications,
      absWidgetDir: tempWidgetDir,
      configPath: tempConfigPath,
    });

    try {
      await supervisor.reloadDefinitionsOnly();

      expect(supervisor.vibecanvasDefMap[manifest.name]).toBeUndefined();
      expect(await db.actor.getDefinition(manifest.name)).toBeNull();
      expect(notifications).toContainEqual({
        type: "error",
        title: "Ambiguous actor definition",
        description: expect.stringContaining("widgets/legacy-first/vibecanvas.json"),
      });
    } finally {
      await supervisor.closeActors();
      await rm(tempConfigPath, { recursive: true, force: true });
    }
  });

  test("init boots actor instances from db with saved state and data", async () => {
    await db.canvas.create({
      id: testUuid("canvas-1"),
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
      id: testUuid("fund-instance-ready"),
      canvas_id: testUuid("canvas-1"),
      element_id: "element-fund-ready",
      actor_definition_name: "Account Funds Test",
      display_name: "Fund Ready",
      status: "running",
      machine_state: "ready",
      machine_context: { balance: 125 },
    });
    await db.actor.insertInstance({
      id: testUuid("fund-instance-busy"),
      canvas_id: testUuid("canvas-1"),
      element_id: "element-fund-busy",
      actor_definition_name: "Account Funds Test",
      display_name: "Fund Busy",
      status: "paused",
      machine_state: "busy.counting",
      machine_context: { balance: 55 },
    });
    await db.actor.insertInstance({
      id: testUuid("bookkeeper-instance-ready"),
      canvas_id: testUuid("canvas-1"),
      element_id: "element-bookkeeper-ready",
      actor_definition_name: "Account Bookkeeper Test",
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
      testUuid("bookkeeper-instance-ready"),
      testUuid("fund-instance-busy"),
      testUuid("fund-instance-ready"),
    ].sort());
    expect(supervisor.actorMap[testUuid("fund-instance-ready")].getState()).toBe("ready");
    expect(supervisor.actorMap[testUuid("fund-instance-ready")].getData()).toEqual({ balance: 125 });
    expect(supervisor.actorMap[testUuid("fund-instance-busy")].getState()).toBe("busy.counting");
    expect(supervisor.actorMap[testUuid("fund-instance-busy")].getData()).toEqual({ balance: 55 });
    expect(supervisor.actorMap[testUuid("bookkeeper-instance-ready")].getState()).toBe("ready");
    expect(supervisor.actorMap[testUuid("bookkeeper-instance-ready")].getData()).toEqual({
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
      .filter((args) => args.id === testUuid("fund-instance-ready"))
      .map((args) => args.status);
    expect(readyInstanceStatuses).toEqual(["starting", "running"]);

    await supervisor.closeActors();
  });

  test("keeps loading persisted actors after one definition is unavailable", async () => {
    const supervisor = createSupervisor(db, notifications);
    await supervisor.init();
    await supervisor.closeActors();

    await db.canvas.create({
      id: testUuid("canvas-isolation"),
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
      id: testUuid("actor-bad-first"),
      canvas_id: testUuid("canvas-isolation"),
      element_id: "element-bad-first",
      actor_definition_name: "Unavailable Widget",
      display_name: "Unavailable Widget",
      status: "created",
      machine_state: "idle",
      machine_context: {},
    });
    await db.actor.insertInstance({
      id: testUuid("actor-good-second"),
      canvas_id: testUuid("canvas-isolation"),
      element_id: "element-good-second",
      actor_definition_name: "Account Funds Test",
      display_name: "Account Funds Test",
      status: "created",
      machine_state: "idle",
      machine_context: { balance: 10 },
    });

    await supervisor.init();

    expect(supervisor.actorMap[testUuid("actor-bad-first")]).toBeUndefined();
    expect(supervisor.actorMap[testUuid("actor-good-second")]).toBeDefined();
    expect(await db.actor.getInstanceById(testUuid("actor-bad-first"))).toMatchObject({
      status: "error",
      last_error: { code: "WIDGET_DEFINITION_UNAVAILABLE" },
    });
    expect(await db.actor.getInstanceById(testUuid("actor-good-second"))).toMatchObject({ status: "running", last_error: null });
    await supervisor.closeActors();
  });

  test("publishes running status event when actor instance is created", async () => {
    await db.canvas.create({
      id: testUuid("canvas-create-instance"),
      name: "Actor Create Instance Test Canvas",
      automerge_url: "automerge:actor-create-instance-test",
    });

    const publishedActorEvents: TActorEvent[] = [];
    const supervisor = createSupervisor(db, notifications, publishedActorEvents);

    await supervisor.init();
    const actor = await supervisor.createInstance("Account Funds Test", testUuid("canvas-create-instance"), "element-created-fund");
    if (!actor) throw new Error("Expected actor instance to be created");

    expect(actor.getId()).toBeString();
    expect(publishedActorEvents).toContainEqual({
      kind: "system",
      actorId: actor.getId(),
      type: "status.changed",
      from: null,
      to: "running",
    });

    await supervisor.closeActors();
  });

  test("reload refreshes definitions and loads missing db instances without stopping running actors", async () => {
    await db.canvas.create({
      id: testUuid("canvas-reload"),
      name: "Actor Reload Test Canvas",
      automerge_url: "automerge:actor-reload-test",
    });

    const supervisor = createSupervisor(db, notifications);

    await supervisor.init();
    const existingActor = await supervisor.createInstance("Account Funds Test", testUuid("canvas-reload"), "element-existing-fund");
    if (!existingActor) throw new Error("Expected existing actor to be created");
    const existingActorId = existingActor.getId();
    const existingEvents: TActorEvent[] = [];
    existingActor.listen(event => existingEvents.push(event));

    await db.actor.insertInstance({
      id: testUuid("fund-reload-new"),
      canvas_id: testUuid("canvas-reload"),
      element_id: "element-fund-reload-new",
      actor_definition_name: "Account Funds Test",
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
    expect(supervisor.actorMap[testUuid("fund-reload-new")].getData()).toEqual({ balance: 7 });

    await supervisor.closeActors();
  });

  test("persists actor machine data after successful inbox processing", async () => {
    await db.canvas.create({
      id: testUuid("canvas-persist-machine"),
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
      id: testUuid("fund-persist"),
      canvas_id: testUuid("canvas-persist-machine"),
      element_id: "element-fund-persist",
      actor_definition_name: "Account Funds Test",
      display_name: "Fund Persist",
      status: "running",
      machine_state: "ready",
      machine_context: { balance: 0 },
    });

    const supervisor = createSupervisor(db, notifications);

    await supervisor.init();
    supervisor.actorMap[testUuid("fund-persist")].inbox("add-funds", {accountId: "1", amount: 42});
    await waitForIdle(supervisor.actorMap[testUuid("fund-persist")]);
    await waitForPersistedContext(db, testUuid("fund-persist"), { balance: 42 });

    const instance = await db.actor.getInstanceById(testUuid("fund-persist"));
    expect(instance?.machine_state).toBe("ready");

    await supervisor.closeActors();
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
        id: testUuid("canvas-activity-persist"),
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
      const actor = await supervisor.createInstance("Activity Persist Test", testUuid("canvas-activity-persist"), "element-activity-persist");
      if (!actor) throw new Error("Expected activity actor to be created");

      await waitForPersistedContext(db, actor.getId(), { events: ["lifecycle.enter"], ticks: 1 });
      expect(actorEvents.some(event => event.kind === "system" && event.type === "snapshot" && event.cause === "startup")).toBe(true);
      expect(actorEvents.some(event => event.kind === "system" && event.type === "snapshot" && event.cause === "activity")).toBe(true);
      expect(actorEvents
        .filter((event): event is Extract<TActorEvent, { kind: "system"; type: "snapshot" }> => event.kind === "system" && event.type === "snapshot")
        .map(event => event.revision)).toEqual([1, 2]);
      expect(actorEvents.some(event => event.kind === "system" && event.type === "ack")).toBe(false);
      await supervisor.closeActors();
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
        id: testUuid("canvas-error-persist"),
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
      const actor = await supervisor.createInstance("Error Persist Test", testUuid("canvas-error-persist"), "element-error-persist");
      if (!actor) throw new Error("Expected error actor to be created");

      await waitForPersistedState(db, actor.getId(), "error");
      expect(actor.getState()).toBe("error");
      expect((await db.actor.getInstanceById(actor.getId()))?.status).toBe("running");
      await supervisor.closeActors();
    } finally {
      await rm(tempConfigPath, { recursive: true, force: true });
    }
  });

  test("routes emitted actor messages to connected target actors", async () => {
    await db.canvas.create({
      id: testUuid("canvas-connection"),
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
      id: testUuid("fund-source"),
      canvas_id: testUuid("canvas-connection"),
      element_id: "element-fund-source",
      actor_definition_name: "Account Funds Test",
      display_name: "Fund Source",
      status: "running",
      machine_state: "ready",
      machine_context: { balance: 0 },
    });
    await db.actor.insertInstance({
      id: testUuid("bookkeeper-target"),
      canvas_id: testUuid("canvas-connection"),
      element_id: "element-bookkeeper-target",
      actor_definition_name: "Account Bookkeeper Test",
      display_name: "Bookkeeper Target",
      status: "running",
      machine_state: "ready",
      machine_context: { entries: [] },
    });

    await db.actor.insertConnection({
      id: testUuid("connection-fund-to-bookkeeper"),
      canvas_id: testUuid("canvas-connection"),
      source_actor_instance_id: testUuid("fund-source"),
      target_actor_instance_id: testUuid("bookkeeper-target"),
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
    supervisor.listenToActorEvents(testUuid("fund-source"), event => sourceEvents.push(event));
    supervisor.listenToActorEvents(testUuid("bookkeeper-target"), event => targetEvents.push(event));

    const messageId = supervisor.actorMap[testUuid("fund-source")].inbox("add-funds", {accountId: "1", amount: 42});
    await waitForIdle(supervisor.actorMap[testUuid("fund-source")]);
    await waitForIdle(supervisor.actorMap[testUuid("bookkeeper-target")]);

    expect(messageId).toBeString();
    expect(sourceEvents).toContainEqual({
      kind: "system",
      actorId: testUuid("fund-source"),
      type: "data.changed",
      data: { balance: 42 },
      messageId,
    });
    expect(sourceEvents).toContainEqual({
      kind: "actor",
      actorId: testUuid("fund-source"),
      name: "funds-added",
      payload: { accountId: "1", amount: 42, balance: 42 },
      messageId,
    });
    expect(sourceEvents).toContainEqual({
      kind: "system",
      actorId: testUuid("fund-source"),
      type: "ack",
      inputName: "add-funds",
      messageId,
    });
    expect(targetEvents.some(event => event.kind === "system" && event.type === "data.changed")).toBe(true);
    expect(targetEvents.some(event => event.kind === "system" && event.type === "ack")).toBe(true);
    expect(publishedActorEvents).toContainEqual({
      kind: "actor",
      actorId: testUuid("fund-source"),
      name: "funds-added",
      payload: { accountId: "1", amount: 42, balance: 42 },
      messageId,
    });
    expect(publishedActorEvents.some(event => event.kind === "system" && event.type === "data.changed")).toBe(true);

    expect(supervisor.connectionMap[testUuid("fund-source")].map(connection => connection.id)).toEqual([
      testUuid("connection-fund-to-bookkeeper"),
    ]);
    expect(supervisor.actorMap[testUuid("bookkeeper-target")].getData()).toEqual({
      entries: [
        {
          accountId: "1",
          amount: 42,
          balance: 42,
        },
      ],
    });

    await supervisor.closeActors();
  });

  test("deleteDefinition removes instances, db definition, and widget files", async () => {
    const tempConfigPath = await mkdtemp(path.join(tmpdir(), "vibecanvas-actor-delete-"));
    const tempWidgetDir = path.join(tempConfigPath, "widgets");
    const tempDefinitionDir = path.join(tempWidgetDir, "account-fund-actor");
    await cp(path.join(widgetDir, "account-fund-actor"), tempDefinitionDir, { recursive: true });

    try {
      await db.canvas.create({
        id: testUuid("canvas-delete-definition"),
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
      const actor = await supervisor.createInstance("Account Funds Test", testUuid("canvas-delete-definition"), "element-delete-definition");
      if (!actor) throw new Error("Expected actor to be created");

      const deleted = await supervisor.deleteDefinition("Account Funds Test");

      expect(deleted).toBe(true);
      expect(supervisor.vibecanvasDefMap["Account Funds Test"]).toBeUndefined();
      expect(supervisor.actorMap[actor.getId()]).toBeUndefined();
      expect(await db.actor.getDefinition("Account Funds Test")).toBeNull();
      expect(await db.actor.getInstanceById(actor.getId())).toBeNull();
      await expect(access(tempDefinitionDir)).rejects.toThrow();

      await supervisor.closeActors();
    } finally {
      await rm(tempConfigPath, { recursive: true, force: true });
    }
  });

  test("serializes duplicate starts for one actor instance", async () => {
    await db.canvas.create({
      id: testUuid("canvas-serialized-start"),
      name: "Serialized start",
      automerge_url: "automerge:serialized-start",
    });
    const allowedAdmission: TActorStartAdmission = {
      allowed: true,
      hadBlocks: false,
      shouldRestart: true,
      resolvedBlockResourceIds: [],
      code: null,
      message: null,
    };
    let admissionCalls = 0;
    let completions: boolean[] = [];
    let holdAdmission = false;
    let releaseAdmission!: () => void;
    let markAdmissionStarted!: () => void;
    const admissionGate = new Promise<void>((resolve) => { releaseAdmission = resolve; });
    const admissionStarted = new Promise<void>((resolve) => { markAdmissionStarted = resolve; });
    const supervisor = new ActorSupervisor({
      absWidgetDir: widgetDir,
      configPath,
      db,
      crypto: createTestCrypto("serialized-start"),
      eventPublisherService: createEventPublisherService(notifications, []) as any,
      actorStartAdmission: async () => {
        admissionCalls += 1;
        if (holdAdmission) {
          markAdmissionStarted();
          await admissionGate;
        }
        return allowedAdmission;
      },
      actorStartCompleted: async ({ succeeded }) => { completions.push(succeeded); },
    });
    await supervisor.init();
    const actor = await supervisor.createInstance(
      "Account Funds Test",
      testUuid("canvas-serialized-start"),
      "element-serialized-start",
    );
    if (!actor) throw new Error("Expected actor instance to be created");
    await supervisor.stopInstanceForResourceApply(actor.getId());
    admissionCalls = 0;
    completions = [];
    holdAdmission = true;

    const firstStart = supervisor.restartInstanceAfterResourceApply(actor.getId());
    const secondStart = supervisor.restartInstanceAfterResourceApply(actor.getId());
    await admissionStarted;
    await Bun.sleep(10);
    expect(admissionCalls).toBe(1);

    releaseAdmission();
    const [firstActor, secondActor] = await Promise.all([firstStart, secondStart]);
    expect(firstActor).toBeDefined();
    expect(secondActor).toBe(firstActor);
    expect(admissionCalls).toBe(1);
    expect(completions).toEqual([true]);
    await supervisor.closeActors();
  });

  test("closeActors drains an accepted start and prevents a post-shutdown actor", async () => {
    await db.canvas.create({
      id: testUuid("canvas-shutdown-start"),
      name: "Shutdown start",
      automerge_url: "automerge:shutdown-start",
    });
    const allowedAdmission: TActorStartAdmission = {
      allowed: true,
      hadBlocks: false,
      shouldRestart: true,
      resolvedBlockResourceIds: [],
      code: null,
      message: null,
    };
    let holdAdmission = false;
    let releaseAdmission!: () => void;
    let markAdmissionStarted!: () => void;
    const admissionGate = new Promise<void>((resolve) => { releaseAdmission = resolve; });
    const admissionStarted = new Promise<void>((resolve) => { markAdmissionStarted = resolve; });
    let completions: boolean[] = [];
    const supervisor = new ActorSupervisor({
      absWidgetDir: widgetDir,
      configPath,
      db,
      crypto: createTestCrypto("shutdown-start"),
      eventPublisherService: createEventPublisherService(notifications, []) as any,
      actorStartAdmission: async () => {
        if (holdAdmission) {
          markAdmissionStarted();
          await admissionGate;
        }
        return allowedAdmission;
      },
      actorStartCompleted: async ({ succeeded }) => { completions.push(succeeded); },
    });
    await supervisor.init();
    const actor = await supervisor.createInstance(
      "Account Funds Test",
      testUuid("canvas-shutdown-start"),
      "element-shutdown-start",
    );
    if (!actor) throw new Error("Expected actor instance to be created");
    await supervisor.stopInstanceForResourceApply(actor.getId());
    completions = [];
    holdAdmission = true;

    const starting = supervisor.restartInstanceAfterResourceApply(actor.getId());
    await admissionStarted;
    let closeSettled = false;
    const closing = supervisor.closeActors().then(() => { closeSettled = true; });
    await Bun.sleep(10);
    expect(closeSettled).toBe(false);

    releaseAdmission();
    expect(await starting).toBeNull();
    await closing;
    expect(completions).toEqual([false]);
    expect(supervisor.actorMap[actor.getId()]).toBeUndefined();
  });

  test("removeInstance retains and counts a delayed child until its exit is reaped", async () => {
    const tempConfigPath = await mkdtemp(path.join(tmpdir(), "vibecanvas-actor-delayed-remove-"));
    const tempWidgetDir = path.join(tempConfigPath, "widgets");
    const definitionDir = path.join(tempWidgetDir, "delayed-remove");
    await cp(path.join(widgetDir, "slow-exit-actor"), definitionDir, { recursive: true });
    await writeFile(path.join(definitionDir, "vibecanvas.json"), JSON.stringify({
      ...fundActorConfigJson,
      name: "Delayed Remove Actor",
      slug: "delayed-remove",
    }), "utf8");
    const supervisor = createSupervisorWithPaths({
      db,
      notifications,
      absWidgetDir: tempWidgetDir,
      configPath: tempConfigPath,
      actorShutdownTimeoutMs: 500,
    });

    try {
      await supervisor.init();
      const canvasId = testUuid("canvas-delayed-remove");
      await db.canvas.create({
        id: canvasId,
        name: "Delayed remove",
        automerge_url: "automerge:delayed-remove",
      });
      const actor = await supervisor.createInstance("Delayed Remove Actor", canvasId, "element-delayed-remove");
      if (!actor) throw new Error("Expected delayed actor instance");
      const pid = actor.getActiveProcessId();
      if (pid === null) throw new Error("Expected delayed actor process id");

      let settled = false;
      const removing = supervisor.removeInstance(actor.getId()).then(() => { settled = true; });
      await Bun.sleep(30);
      expect(settled).toBe(false);
      expect(supervisor.getActiveProcessCount()).toBe(1);
      expect(supervisor.actorMap[actor.getId()]).toBe(actor);
      expect(isProcessAlive(pid)).toBe(true);

      await removing;
      expect(supervisor.getActiveProcessCount()).toBe(0);
      expect(supervisor.actorMap[actor.getId()]).toBeUndefined();
      expect(await db.actor.getInstanceById(actor.getId())).toBeNull();
      expect(isProcessAlive(pid)).toBe(false);
    } finally {
      await supervisor.closeActors();
      await rm(tempConfigPath, { recursive: true, force: true });
    }
  });

  test("closeActors force-kills a stubborn child and resolves with no live pid or count", async () => {
    const tempConfigPath = await mkdtemp(path.join(tmpdir(), "vibecanvas-actor-stubborn-close-"));
    const tempWidgetDir = path.join(tempConfigPath, "widgets");
    const definitionDir = path.join(tempWidgetDir, "stubborn-close");
    await cp(path.join(widgetDir, "stubborn-exit-actor"), definitionDir, { recursive: true });
    await writeFile(path.join(definitionDir, "vibecanvas.json"), JSON.stringify({
      ...fundActorConfigJson,
      name: "Stubborn Close Actor",
      slug: "stubborn-close",
    }), "utf8");
    const supervisor = createSupervisorWithPaths({
      db,
      notifications,
      absWidgetDir: tempWidgetDir,
      configPath: tempConfigPath,
      actorShutdownTimeoutMs: 50,
    });

    try {
      await supervisor.init();
      const canvasId = testUuid("canvas-stubborn-close");
      await db.canvas.create({
        id: canvasId,
        name: "Stubborn close",
        automerge_url: "automerge:stubborn-close",
      });
      const actor = await supervisor.createInstance("Stubborn Close Actor", canvasId, "element-stubborn-close");
      if (!actor) throw new Error("Expected stubborn actor instance");
      const pid = actor.getActiveProcessId();
      if (pid === null) throw new Error("Expected stubborn actor process id");

      let settled = false;
      const closing = supervisor.closeActors().then(() => { settled = true; });
      await Bun.sleep(20);
      expect(settled).toBe(false);
      expect(supervisor.getActiveProcessCount()).toBe(1);
      expect(supervisor.actorMap[actor.getId()]).toBe(actor);
      expect(isProcessAlive(pid)).toBe(true);

      await closing;
      expect(supervisor.getActiveProcessCount()).toBe(0);
      expect(supervisor.actorMap[actor.getId()]).toBeUndefined();
      expect(isProcessAlive(pid)).toBe(false);
    } finally {
      await supervisor.closeActors();
      await rm(tempConfigPath, { recursive: true, force: true });
    }
  });
});
