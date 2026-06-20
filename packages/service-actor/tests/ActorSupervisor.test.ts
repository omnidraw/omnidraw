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
    ]);
    expect(definitions.map(def => def.name).sort()).toEqual([
      "Account Bookkeeper Test",
      "Account Funds Test",
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
      machine_context: JSON.stringify({ balance: 125 }),
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
      machine_context: JSON.stringify({ balance: 55 }),
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
      machine_context: JSON.stringify({
        entries: [
          {
            accountId: "1",
            amount: 25,
            balance: 25,
          },
        ],
      }),
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
});
