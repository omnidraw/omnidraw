import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DbServiceTurso } from "../../../src/DbServiceTurso/DbServiceTurso";
import { bindTestTenant, type TTenantTestDb } from "../tenant.fixture";

const testUuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const CANVAS_ID = testUuid(401);
const actorId = (index: number) => testUuid(500 + index);
const connectionId = (index: number) => testUuid(700 + index);
const ACTOR_SMALL = testUuid(801);
const ACTOR_TARGET = testUuid(802);
const ACTOR_MEDIUM = testUuid(803);
const ACTOR_HEALTH = testUuid(804);
const ACTOR_DEFINITION_NAME = "Counter";

async function createDbService(tempRoot: string): Promise<TTenantTestDb> {
  const service = new DbServiceTurso({
    databasePath: join(tempRoot, "vibecanvas.turso"),
    dataDir: tempRoot,
    cacheDir: tempRoot,
  });

  await service.start();
  return bindTestTenant(service);
}

async function seedActorGraph(db: TTenantTestDb): Promise<void> {
  await db.canvas.create({
    id: CANVAS_ID,
    name: "Actor Write Burst",
    automerge_url: "automerge:actor-write-burst",
  });
  await db.actor.insertDefinition({
    name: ACTOR_DEFINITION_NAME,
    slug: "counter",
    url: null,
    description: null,
    manifest_path: "actors/counter/vibecanvas.json",
  });
}

describe("DbServiceTurso actor writes", () => {
  let tempRoot: string;
  let db: TTenantTestDb;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "vibecanvas-db-actor-writes-"));
    db = await createDbService(tempRoot);
    await seedActorGraph(db);
  });

  afterEach(async () => {
    await db.db.close();
    await rm(tempRoot, { recursive: true, force: true });
  });

  test("keeps actor instance burst writes stable through the public DB service", async () => {
    const iterations = 120;
    const deletedIds = new Set<string>();

    await Promise.all(Array.from({ length: iterations }, async (_, index) => {
      const id = actorId(index);

      await db.actor.insertInstance({
        id,
        canvas_id: CANVAS_ID,
        element_id: `element-${index}`,
        actor_definition_name: ACTOR_DEFINITION_NAME,
        filesystem_id: null,
        display_name: `Actor ${index}`,
        status: "created",
        machine_state: "idle",
        machine_context: { count: 0 },
      });

      await Promise.all([
        db.actor.updateInstanceMachine({
          id,
          machine_state: "ready",
          machine_context: { count: index, nested: { ok: true } },
        }),
        db.actor.updateInstanceStatus({
          id,
          status: "running",
        }),
      ]);

      if (index % 5 === 0) {
        deletedIds.add(id);
        await db.actor.deleteInstance(id);
      }
    }));

    const instances = await db.actor.listInstances({ canvasId: CANVAS_ID });

    expect(instances).toHaveLength(iterations - deletedIds.size);
    expect(instances.every(instance => instance.status === "running")).toBe(true);
    expect(instances.every(instance => instance.machine_state === "ready")).toBe(true);

    const actor37 = instances.find(instance => instance.id === actorId(37));
    expect(actor37?.machine_context).toEqual({ count: 37, nested: { ok: true } });

    const liveIds = instances.map(instance => instance.id);
    await Promise.all(liveIds.slice(0, 40).map((sourceId, index) => db.actor.insertConnection({
      id: connectionId(index),
      canvas_id: CANVAS_ID,
      source_actor_instance_id: sourceId,
      target_actor_instance_id: liveIds[(index + 1) % liveIds.length],
      enabled: true,
      label: null,
      msg_name_whitelist: null,
      style: { index },
    })));

    const connections = await db.actor.listConnections();
    expect(connections).toHaveLength(40);
    expect(connections.find(connection => connection.id === connectionId(37))?.style).toEqual({ index: 37 });

    await Promise.all(connections.map((connection, index) => {
      if (index % 2 === 0) {
        return db.actor.deleteConnectionById(connection.id);
      }

      return db.actor.deleteConnectionBySource(connection.source_actor_instance_id);
    }));

    await expect(db.actor.listConnections()).resolves.toHaveLength(0);
  });

  test("continues actor write queue after a failed mutation", async () => {
    await expect(db.actor.insertDefinition({
      name: ACTOR_DEFINITION_NAME,
      slug: "counter",
      url: null,
      description: null,
      manifest_path: "actors/duplicate/vibecanvas.json",
    })).rejects.toBeInstanceOf(Error);

    await expect(db.actor.insertDefinition({
      name: "Timer",
      slug: "timer",
      url: null,
      description: null,
      manifest_path: "actors/timer/vibecanvas.json",
    })).resolves.toMatchObject({
      name: "Timer",
      slug: "timer",
    });
  });

  test("updates the correct actor rows with medium JSON state and update triggers", async () => {
    const mediumHtml = `<!doctype html><html><body>${"x".repeat(16_000)}</body></html>`;

    for (const [id, context] of [
      [ACTOR_SMALL, { kind: "small-a" }],
      [ACTOR_TARGET, { kind: "target" }],
      [ACTOR_MEDIUM, { kind: "medium", html: mediumHtml }],
    ] as const) {
      await db.actor.insertInstance({
        id,
        canvas_id: CANVAS_ID,
        element_id: `element-${id}`,
        actor_definition_name: ACTOR_DEFINITION_NAME,
        filesystem_id: null,
        display_name: id,
        status: "created",
        machine_state: "idle",
        machine_context: context,
      });
    }

    const statusResult = await db.actor.updateInstanceStatus({
      id: ACTOR_TARGET,
      status: "running",
    });
    expect(statusResult).toMatchObject({
      id: ACTOR_TARGET,
      status: "running",
      machine_context: { kind: "target" },
    });

    const nextContext = { kind: "medium-updated", html: mediumHtml };
    const machineResult = await db.actor.updateInstanceMachine({
      id: ACTOR_MEDIUM,
      machine_state: "ready",
      machine_context: nextContext,
    });
    expect(machineResult).toMatchObject({
      id: ACTOR_MEDIUM,
      machine_state: "ready",
      machine_context: nextContext,
    });

    const persistedTarget = await db.actor.getInstanceById(ACTOR_TARGET);
    const persistedMedium = await db.actor.getInstanceById(ACTOR_MEDIUM);
    expect(persistedTarget?.id).toBe(ACTOR_TARGET);
    expect(persistedTarget?.status).toBe("running");
    expect(persistedMedium?.id).toBe(ACTOR_MEDIUM);
  });

  test("updates actor definition identity without UPDATE RETURNING on the self-triggered table", async () => {
    const updated = await db.actor.updateDefinition({
      currentSlug: "counter",
      name: ACTOR_DEFINITION_NAME,
      slug: "counter-v2",
      url: "https://example.com/counter",
      description: "Updated counter",
      manifest_path: "actors/counter-renamed/vibecanvas.json",
    });

    expect(updated).toMatchObject({
      name: ACTOR_DEFINITION_NAME,
      slug: "counter-v2",
      url: "https://example.com/counter",
      description: "Updated counter",
      manifest_path: "actors/counter-renamed/vibecanvas.json",
    });
    await expect(db.actor.listDefinitions()).resolves.toHaveLength(1);
  });

  test("persists and clears actor infrastructure errors without changing machine context", async () => {
    const mediumHtml = `<main>${"state".repeat(4_000)}</main>`;
    await db.actor.insertInstance({
      id: ACTOR_HEALTH,
      canvas_id: CANVAS_ID,
      element_id: "element-health",
      actor_definition_name: ACTOR_DEFINITION_NAME,
      filesystem_id: null,
      display_name: "Actor Health",
      status: "created",
      machine_state: "idle",
      machine_context: { html: mediumHtml, count: 7 },
    });

    const failed = await db.actor.updateInstanceHealth({
      id: ACTOR_HEALTH,
      status: "error",
      last_error: {
        phase: "instance-start",
        code: "ACTOR_INSTANCE_START_FAILED",
        message: "Child process did not start",
        retryable: true,
      },
    });
    if (!failed) throw new Error('Expected actor health update to find the instance.');
    expect(failed.last_error?.code).toBe("ACTOR_INSTANCE_START_FAILED");
    expect(failed.machine_context).toEqual({ html: mediumHtml, count: 7 });

    const recovered = await db.actor.updateInstanceHealth({ id: ACTOR_HEALTH, status: "running", last_error: null });
    if (!recovered) throw new Error('Expected actor recovery update to find the instance.');
    expect(recovered.last_error).toBeNull();
    expect(recovered.machine_context).toEqual({ html: mediumHtml, count: 7 });
  });
});
