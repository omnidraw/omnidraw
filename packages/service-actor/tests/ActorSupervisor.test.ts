import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DbServiceTurso } from "@vibecanvas/service-db/DbServiceTurso/DbServiceTurso";
import { ActorSupervisor } from "../src/ActorSupervisor";

const widgetDir = new URL("./fixtures", import.meta.url).pathname;

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
    const supervisor = new ActorSupervisor({
      absWidgetDir: widgetDir,
      db,
      eventPublisherService: createEventPublisherService(notifications) as any,
    });

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
});
