import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DbServiceTurso } from "@vibecanvas/service-db/DbServiceTurso/DbServiceTurso";
import { ActorSupervisor } from "../src/ActorSupervisor";
import type { TActorEvent } from "../src/Actor";

const widgetDir = new URL("./fixtures", import.meta.url).pathname;
const fundActorManifestPath = new URL("./fixtures/account-fund-actor/vibecanvas.json", import.meta.url).pathname;
const bookkeeperActorManifestPath = new URL("./fixtures/account-bookkeeper-actor/vibecanvas.json", import.meta.url).pathname;

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
    db,
    eventPublisherService: createEventPublisherService(notifications, actorEvents) as any,
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
});
