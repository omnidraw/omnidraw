import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DbServiceTurso } from "@vibecanvas/service-db/DbServiceTurso/DbServiceTurso";
import { ActorSupervisor } from "../src/ActorSupervisor";

const widgetDir = new URL("./fixtures", import.meta.url).pathname;
const fundActorManifestPath = new URL("./fixtures/account-fund-actor/vibecanvas.json", import.meta.url).pathname;
const bookkeeperActorManifestPath = new URL("./fixtures/account-bookkeeper-actor/vibecanvas.json", import.meta.url).pathname;

type TNotification = {
  readonly type: "error" | "info" | "success" | "warning";
  readonly title: string;
  readonly description: string;
};

function createEventPublisherService(notifications: TNotification[]) {
  return {
    publishNotification: (notification: TNotification) => {
      notifications.push(notification);
    },
  };
}

function createSupervisor(db: DbServiceTurso, notifications: TNotification[]) {
  return new ActorSupervisor({
    absWidgetDir: widgetDir,
    db,
    eventPublisherService: createEventPublisherService(notifications) as any,
  });
}

async function waitForIdle(actor: { isIdle(): boolean }) {
  for (let index = 0; index < 100; index += 1) {
    if (actor.isIdle()) return;
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for actor to become idle");
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

    const supervisor = createSupervisor(db, notifications);

    await supervisor.init();
    const messageId = supervisor.actorMap["fund-source"].inbox("add-funds", {accountId: "1", amount: 42});
    await waitForIdle(supervisor.actorMap["fund-source"]);
    await waitForIdle(supervisor.actorMap["bookkeeper-target"]);

    expect(messageId).toBeString();

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
