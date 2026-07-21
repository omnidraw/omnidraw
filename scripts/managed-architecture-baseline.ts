#!/usr/bin/env bun

/**
 * @file Repeatable M0 measurements for the actor-era server, Automerge, resources, and UI-only metadata.
 */

import { createServer } from "node:net";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Actor, type TActorEvent } from "../packages/service-actor/src/Actor";
import type { TVibecanvasJson } from "../packages/service-actor/src/core/types";
import { ActorResourceKeyValueStore } from "../packages/service-actor/src/resources/ActorResourceKeyValueStore";
import { AutomergeService } from "../packages/service-automerge/src/AutomergeService";
import type { TCanvasDoc, TElement } from "../packages/service-automerge/src/types/canvas-doc.types";
import type { WebSocketWithIsAlive } from "../packages/service-automerge/src/adapters/websocket.adapter";
import { Database } from "../packages/service-db/src/DbServiceTurso/turso-native";
import {
  createUiOnlyMetadataFixture,
  digestBaselineValue,
  getManagedArchitectureBaselineFixture,
  type TManagedArchitectureBaselineFixture,
} from "./managed-architecture-baseline-fixture";

type TProcessStat = {
  readonly pid: number;
  readonly parentPid: number;
  readonly rssKb: number;
  readonly cpuPercent: number;
  readonly command: string;
};

type TWorkspaceGraphNode = {
  readonly name: string;
  readonly path: string;
};

type TWorkspaceGraphEdge = {
  readonly from: string;
  readonly to: string;
  readonly kind: "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies";
};

type TMockSocket = WebSocketWithIsAlive & {
  readonly sent: ArrayBuffer[];
  closeCount: number;
  terminateCount: number;
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ACTOR_FIXTURE_ROOT = resolve(REPO_ROOT, "packages/service-actor/tests/fixtures/account-fund-actor");
const ACTOR_FIXTURE_MANIFEST = resolve(ACTOR_FIXTURE_ROOT, "vibecanvas.json");

function round(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function memorySnapshot() {
  const usage = process.memoryUsage();
  return {
    rssBytes: usage.rss,
    heapUsedBytes: usage.heapUsed,
    externalBytes: usage.external,
  };
}

function memoryDelta(before: ReturnType<typeof memorySnapshot>, after: ReturnType<typeof memorySnapshot>) {
  return {
    rssBytes: after.rssBytes - before.rssBytes,
    heapUsedBytes: after.heapUsedBytes - before.heapUsedBytes,
    externalBytes: after.externalBytes - before.externalBytes,
  };
}

function cpuDelta(started: NodeJS.CpuUsage) {
  const usage = process.cpuUsage(started);
  return { userMicros: usage.user, systemMicros: usage.system };
}

function parseProcessTable(output: string): TProcessStat[] {
  return output.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/);
    if (!match) return [];
    return [{
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      rssKb: Number(match[3]),
      cpuPercent: Number(match[4]),
      command: match[5]!,
    }];
  });
}

async function readProcessTable(): Promise<TProcessStat[]> {
  const subprocess = Bun.spawn(["ps", "-axo", "pid=,ppid=,rss=,%cpu=,command="], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`ps failed: ${stderr.trim()}`);
  return parseProcessTable(stdout);
}

async function readActorChildStats(): Promise<TProcessStat[]> {
  return (await readProcessTable()).filter((row) => (
    row.parentPid === process.pid && row.command.includes("--icp-client")
  ));
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  message: string,
  timeoutMs = 10_000,
): Promise<void> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await Bun.sleep(20);
  }
  throw new Error(message);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function reservePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("failed to reserve a local TCP port"));
        return;
      }
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

async function readWorkspaceGraph() {
  const nodes: TWorkspaceGraphNode[] = [];
  const manifests = new Map<string, Record<string, any>>();

  for (const workspaceRoot of ["apps", "packages"] as const) {
    const absoluteRoot = resolve(REPO_ROOT, workspaceRoot);
    for (const entry of await readdir(absoluteRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = resolve(absoluteRoot, entry.name, "package.json");
      try {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, any>;
        if (typeof manifest.name !== "string") continue;
        nodes.push({ name: manifest.name, path: relative(REPO_ROOT, dirname(manifestPath)) });
        manifests.set(manifest.name, manifest);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  nodes.sort((left, right) => left.name.localeCompare(right.name));
  const nodeNames = new Set(nodes.map((node) => node.name));
  const edges: TWorkspaceGraphEdge[] = [];
  const dependencyKinds = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ] as const;

  for (const node of nodes) {
    const manifest = manifests.get(node.name)!;
    for (const kind of dependencyKinds) {
      for (const dependencyName of Object.keys(manifest[kind] ?? {})) {
        if (!nodeNames.has(dependencyName)) continue;
        edges.push({ from: node.name, to: dependencyName, kind });
      }
    }
  }
  edges.sort((left, right) => (
    left.from.localeCompare(right.from)
    || left.to.localeCompare(right.to)
    || left.kind.localeCompare(right.kind)
  ));

  const graph = { nodes, edges };
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    digestSha256: digestBaselineValue(graph),
    ...graph,
  };
}

async function measureServerBaseline(fixture: TManagedArchitectureBaselineFixture) {
  const tempRoot = await mkdtemp(join(tmpdir(), "vibecanvas-m0-server-"));
  const port = await reservePort();
  const databasePath = resolve(tempRoot, "database", "vibecanvas.db");
  const bunExecutable = Bun.which("bun") ?? process.execPath;
  const startedAt = performance.now();
  const subprocess = Bun.spawn([
    bunExecutable,
    resolve(REPO_ROOT, "apps/cli/src/main.ts"),
    "serve",
    "--port",
    String(port),
    "--db",
    databasePath,
  ], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: resolve(tempRoot, "config"),
      XDG_DATA_HOME: resolve(tempRoot, "data"),
      XDG_CACHE_HOME: resolve(tempRoot, "cache"),
      XDG_STATE_HOME: resolve(tempRoot, "state"),
      VIBECANVAS_SILENT_AUTOMERGE_LOGS: "1",
      VIBECANVAS_SILENT_DB_MIGRATIONS: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutPromise = new Response(subprocess.stdout).text();
  const stderrPromise = new Response(subprocess.stderr).text();
  let serverStat: TProcessStat | undefined;
  let childStats: TProcessStat[] = [];
  let startupMs = 0;
  let healthStatus = 0;
  let failure: unknown;

  try {
    await waitFor(async () => {
      if (subprocess.exitCode !== null) return false;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(500),
        });
        healthStatus = response.status;
        return response.ok;
      } catch {
        return false;
      }
    }, "current server did not become healthy", fixture.server.startupTimeoutMs);
    startupMs = round(performance.now() - startedAt);
    await Bun.sleep(fixture.server.settleMs);
    const processTable = await readProcessTable();
    serverStat = processTable.find((row) => row.pid === subprocess.pid);
    childStats = processTable.filter((row) => row.parentPid === subprocess.pid);
    if (!serverStat) throw new Error("server process was missing from the process table after readiness");
  } catch (error) {
    failure = error;
  }

  const shutdownStartedAt = performance.now();
  subprocess.kill("SIGTERM");
  let exitCode: number;
  try {
    exitCode = await withTimeout(subprocess.exited, 10_000, "current server shutdown");
  } catch (error) {
    subprocess.kill("SIGKILL");
    exitCode = await subprocess.exited;
    failure ??= error;
  }
  const shutdownMs = round(performance.now() - shutdownStartedAt);
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  await rm(tempRoot, { recursive: true, force: true });

  if (failure) {
    throw new Error(`${String(failure)}\nserver stdout:\n${stdout}\nserver stderr:\n${stderr}`);
  }

  return {
    startupMs,
    shutdownMs,
    healthStatus,
    exitCode,
    rssKb: serverStat!.rssKb,
    cpuPercent: serverStat!.cpuPercent,
    directChildProcessCount: childStats.length,
    directChildRssKb: childStats.reduce((sum, child) => sum + child.rssKb, 0),
  };
}

function measureUiOnlyMetadata(fixture: TManagedArchitectureBaselineFixture) {
  const memoryBefore = memorySnapshot();
  const cpuStartedAt = process.cpuUsage();
  const startedAt = performance.now();
  const records = createUiOnlyMetadataFixture(fixture);
  const serialized = JSON.stringify(records);
  const elapsedMs = round(performance.now() - startedAt);
  const memoryAfter = memorySnapshot();
  const actorBackedCount = records.filter((record) => (
    "actorDefinitionName" in record.element.data || "actorInstanceId" in record.element.data
  )).length;

  return {
    count: records.length,
    canvasCount: new Set(records.map((record) => record.canvasId)).size,
    definitionCount: new Set(records.map((record) => record.definitionId)).size,
    actorBackedCount,
    serializedBytes: Buffer.byteLength(serialized),
    digestSha256: digestBaselineValue(records),
    createAndSerializeMs: elapsedMs,
    cpu: cpuDelta(cpuStartedAt),
    memoryDelta: memoryDelta(memoryBefore, memoryAfter),
  };
}

async function measureActors(fixture: TManagedArchitectureBaselineFixture) {
  const manifest = JSON.parse(await readFile(ACTOR_FIXTURE_MANIFEST, "utf8")) as TVibecanvasJson;
  const totalLiveCount = fixture.actors.liveIdleSampleCount + fixture.actors.liveHotSampleCount;
  const actors = Array.from({ length: totalLiveCount }, (_, index) => new Actor({
    id: `m0-baseline-actor-${index}`,
    rootDir: ACTOR_FIXTURE_ROOT,
    vsJson: manifest,
  }));
  const events: TActorEvent[] = [];
  for (const actor of actors) actor.listen((event) => events.push(event));
  const memoryBefore = memorySnapshot();
  const cpuStartedAt = process.cpuUsage();
  const actorChildrenBefore = await readActorChildStats();
  const startupStartedAt = performance.now();
  let idleStats: TProcessStat[] = [];
  let hotStats: TProcessStat[] = [];
  let closeResults: boolean[] = [];
  let startupMs = 0;
  let stopMs = 0;

  try {
    for (const actor of actors) actor.start();
    await Promise.all(actors.map((actor) => actor.waitUntilReady(15_000)));
    await waitFor(
      () => actors.every((actor) => actor.isIdle()),
      "actors did not become idle after startup",
      15_000,
    );
    startupMs = round(performance.now() - startupStartedAt);
    idleStats = await readActorChildStats();
    if (idleStats.length !== totalLiveCount) {
      throw new Error(`expected ${totalLiveCount} actor child processes, observed ${idleStats.length}`);
    }

    const hotActors = actors.slice(fixture.actors.liveIdleSampleCount);
    for (const actor of hotActors) {
      for (let message = 0; message < fixture.actors.messagesPerHotActor; message += 1) {
        actor.inbox("add-funds", { accountId: "m0-baseline", amount: 1 });
      }
    }
    await waitFor(
      () => hotActors.every((actor) => actor.isIdle()),
      "hot actors did not drain their message queues",
      20_000,
    );
    hotStats = await readActorChildStats();
    if (hotActors.some((actor) => (
      (actor.getData() as { balance?: unknown }).balance !== fixture.actors.messagesPerHotActor
    ))) {
      throw new Error("hot actor fixture produced an unexpected final balance");
    }
  } finally {
    const stopStartedAt = performance.now();
    closeResults = await Promise.all(actors.map((actor) => actor.closeAndWait(5_000)));
    stopMs = round(performance.now() - stopStartedAt);
  }

  const stopVerificationStartedAt = performance.now();
  await waitFor(
    async () => (await readActorChildStats()).length === actorChildrenBefore.length,
    "actor child processes remained after closeAndWait",
    5_000,
  );
  const memoryAfter = memorySnapshot();

  return {
    modeledIdleCount: fixture.actors.modeledIdleCount,
    liveIdleSampleCount: fixture.actors.liveIdleSampleCount,
    liveHotSampleCount: fixture.actors.liveHotSampleCount,
    messagesPerHotActor: fixture.actors.messagesPerHotActor,
    childCountBefore: actorChildrenBefore.length,
    childCountIdle: idleStats.length,
    childCountAfterStop: (await readActorChildStats()).length,
    idleChildRssKb: idleStats.reduce((sum, child) => sum + child.rssKb, 0),
    idleChildCpuPercent: round(idleStats.reduce((sum, child) => sum + child.cpuPercent, 0)),
    postWorkChildRssKb: hotStats.reduce((sum, child) => sum + child.rssKb, 0),
    postWorkChildCpuPercent: round(hotStats.reduce((sum, child) => sum + child.cpuPercent, 0)),
    startupMs,
    stopMs,
    stopVerificationMs: round(performance.now() - stopVerificationStartedAt),
    closeSucceededCount: closeResults.filter(Boolean).length,
    snapshotEventCount: events.filter((event) => event.kind === "system" && event.type === "snapshot").length,
    actorMessageEventCount: events.filter((event) => event.kind === "actor").length,
    cpu: cpuDelta(cpuStartedAt),
    memoryDelta: memoryDelta(memoryBefore, memoryAfter),
  };
}

function createAutomergeElement(id: string, index: number): TElement {
  return {
    id,
    x: (index % 16) * 24,
    y: Math.floor(index / 16) * 24,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    zIndex: String(index).padStart(6, "0"),
    parentGroupId: null,
    bindings: [],
    locked: false,
    createdAt: 1,
    updatedAt: 1,
    style: {},
    data: {
      type: "ui-widget",
      kind: "m0-automerge-fixture",
      w: 320,
      h: 240,
      expanded: true,
      window: "contained",
      payload: { index },
    },
  };
}

function createMockSocket(): TMockSocket {
  return {
    data: { isAlive: true },
    readyState: WebSocket.OPEN,
    sent: [],
    closeCount: 0,
    terminateCount: 0,
    ping() {},
    close() {
      this.closeCount += 1;
      this.readyState = WebSocket.CLOSED;
    },
    send(data) {
      this.sent.push(data);
    },
    terminate() {
      this.terminateCount += 1;
      this.readyState = WebSocket.CLOSED;
    },
  };
}

async function measureAutomerge(fixture: TManagedArchitectureBaselineFixture) {
  const cborModulePath = Bun.resolveSync(
    "@automerge/automerge-repo/helpers/cbor.js",
    resolve(REPO_ROOT, "packages/service-automerge/src/AutomergeService.ts"),
  );
  const { encode } = await import(cborModulePath) as { encode(message: never): Uint8Array };
  const encodePeerMessage = (message: Record<string, unknown>) => encode(message as never);
  const database = new Database(":memory:");
  await database.connect();
  const service = new AutomergeService(database as ConstructorParameters<typeof AutomergeService>[0], {
    onElementCreate() {},
    onElementDelete() {},
  });
  const memoryBefore = memorySnapshot();
  const cpuStartedAt = process.cpuUsage();
  const startedAt = performance.now();
  const activePeers = new Set<string>();
  let peerCandidateEvents = 0;
  let peerDisconnectedEvents = 0;
  let maxActivePeerCount = 0;
  const sockets: TMockSocket[] = [];
  const latestSocketByPeer = new Map<string, TMockSocket>();

  service.start();
  service.wsAdapter.on("peer-candidate", (event) => {
    const peerId = (event as { peerId: string }).peerId;
    peerCandidateEvents += 1;
    activePeers.add(peerId);
    maxActivePeerCount = Math.max(maxActivePeerCount, activePeers.size);
  });
  service.wsAdapter.on("peer-disconnected", (event) => {
    peerDisconnectedEvents += 1;
    activePeers.delete((event as { peerId: string }).peerId);
  });

  try {
    const handles = Array.from({ length: fixture.automerge.documentCount }, (_, documentIndex) => {
      const elements = Object.fromEntries(Array.from(
        { length: fixture.automerge.uiElementsPerDocument },
        (_, elementIndex) => {
          const index = documentIndex * fixture.automerge.uiElementsPerDocument + elementIndex;
          const element = createAutomergeElement(`m0-automerge-element-${index}`, index);
          return [element.id, element];
        },
      ));
      return service.repo.create<TCanvasDoc>({
        id: `m0-automerge-document-${documentIndex}`,
        name: `M0 Automerge Document ${documentIndex}`,
        elements,
        groups: {},
      });
    });
    await Promise.all(handles.map((handle) => handle.whenReady()));
    await waitFor(async () => {
      try {
        const statement = await database.prepare("SELECT COUNT(*) AS count FROM automerge_repo_data");
        const row = await statement.get() as { count?: unknown } | null | undefined;
        return Number(row?.count ?? 0) >= fixture.automerge.documentCount;
      } catch {
        return false;
      }
    }, "Automerge fixture documents did not drain to Turso storage", 10_000);

    for (let cycle = 0; cycle < fixture.automerge.reconnectCycles; cycle += 1) {
      for (let peerIndex = 0; peerIndex < fixture.automerge.reconnectPeerCount; peerIndex += 1) {
        const peerId = `m0-peer-${peerIndex}`;
        const socket = createMockSocket();
        sockets.push(socket);
        latestSocketByPeer.set(peerId, socket);
        service.wsAdapter.receiveMessage(encodePeerMessage({
          type: "join",
          senderId: peerId,
          supportedProtocolVersions: ["1"],
        }), socket);
      }
    }

    for (const [peerId, socket] of latestSocketByPeer) {
      service.wsAdapter.receiveMessage(encodePeerMessage({ type: "leave", senderId: peerId }), socket);
    }

    const memoryAfter = memorySnapshot();
    return {
      documentHandleCount: Object.keys(service.repo.handles).length,
      elementCount: fixture.automerge.documentCount * fixture.automerge.uiElementsPerDocument,
      reconnectPeerCount: fixture.automerge.reconnectPeerCount,
      reconnectCycles: fixture.automerge.reconnectCycles,
      joinCount: fixture.automerge.reconnectPeerCount * fixture.automerge.reconnectCycles,
      peerCandidateEvents,
      peerDisconnectedEvents,
      maxActivePeerCount,
      activePeerCountAfterLeave: activePeers.size,
      responseFrameCount: sockets.reduce((sum, socket) => sum + socket.sent.length, 0),
      replacedSocketCloseCount: sockets.reduce((sum, socket) => sum + socket.closeCount, 0),
      terminatedSocketCount: sockets.reduce((sum, socket) => sum + socket.terminateCount, 0),
      elapsedMs: round(performance.now() - startedAt),
      cpu: cpuDelta(cpuStartedAt),
      memoryDelta: memoryDelta(memoryBefore, memoryAfter),
    };
  } finally {
    service.stop();
    await Bun.sleep(50);
    await database.close();
  }
}

async function measureResources(fixture: TManagedArchitectureBaselineFixture) {
  const tempRoot = await mkdtemp(join(tmpdir(), "vibecanvas-m0-resources-"));
  const store = new ActorResourceKeyValueStore({
    dataRoot: tempRoot,
    kind: "kv",
    maxOpenHandles: fixture.resources.maxOpenHandles,
  });
  const resourceIds = Array.from(
    { length: fixture.resources.provisionedSampleCount },
    (_, index) => `m0-resource-${String(index).padStart(4, "0")}`,
  );
  const memoryBefore = memorySnapshot();
  const cpuStartedAt = process.cpuUsage();
  const provisionStartedAt = performance.now();
  let peakOpenHandleCount = 0;
  let openHandleCountAfterProvision = 0;
  let openHandleCountAfterClose = -1;

  try {
    for (const resourceId of resourceIds) {
      await store.provision({ resourceId, kind: "kv" });
      peakOpenHandleCount = Math.max(peakOpenHandleCount, store.openHandleCount);
    }
    const provisionMs = round(performance.now() - provisionStartedAt);
    openHandleCountAfterProvision = store.openHandleCount;
    const hotResourceIds = resourceIds.slice(0, fixture.resources.liveHotSampleCount);
    const workloadStartedAt = performance.now();
    for (const resourceId of hotResourceIds) {
      for (let write = 0; write < fixture.resources.writesPerHotResource; write += 1) {
        await store.set({
          resourceId,
          key: `m0-key-${write}`,
          value: { resourceId, write },
        });
        peakOpenHandleCount = Math.max(peakOpenHandleCount, store.openHandleCount);
      }
    }
    const workloadMs = round(performance.now() - workloadStartedAt);
    const openHandleCountAfterWorkload = store.openHandleCount;
    if (peakOpenHandleCount > fixture.resources.maxOpenHandles) {
      throw new Error(`resource handle peak ${peakOpenHandleCount} exceeded bound ${fixture.resources.maxOpenHandles}`);
    }
    const memoryAfter = memorySnapshot();
    await store.close();
    openHandleCountAfterClose = store.openHandleCount;
    return {
      modeledIdleCount: fixture.resources.modeledIdleCount,
      provisionedSampleCount: resourceIds.length,
      provisionedIdleCount: resourceIds.length - hotResourceIds.length,
      hotResourceCount: hotResourceIds.length,
      writesPerHotResource: fixture.resources.writesPerHotResource,
      maxOpenHandles: fixture.resources.maxOpenHandles,
      peakOpenHandleCount,
      openHandleCountAfterProvision,
      openHandleCountAfterWorkload,
      openHandleCountAfterClose,
      provisionMs,
      workloadMs,
      cpu: cpuDelta(cpuStartedAt),
      memoryDelta: memoryDelta(memoryBefore, memoryAfter),
    };
  } finally {
    await store.close().catch(() => undefined);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function outputPathFromArgs(argv: readonly string[]): string | null {
  const index = argv.indexOf("--output");
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) throw new TypeError("--output requires a file path");
  return resolve(process.cwd(), value);
}

export async function captureManagedArchitectureBaseline() {
  process.env.VIBECANVAS_SILENT_AUTOMERGE_LOGS = "1";
  process.env.VIBECANVAS_SILENT_DB_MIGRATIONS = "1";
  const fixture = getManagedArchitectureBaselineFixture();
  const startedAt = performance.now();

  const packageGraph = await readWorkspaceGraph();
  const server = await measureServerBaseline(fixture);
  const uiOnlyMetadata = measureUiOnlyMetadata(fixture);
  const actors = await measureActors(fixture);
  const automerge = await measureAutomerge(fixture);
  const resources = await measureResources(fixture);

  return {
    schemaVersion: 1,
    baseline: fixture.name,
    capturedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      architecture: process.arch,
      bunVersion: Bun.version,
      cpuCount: navigator.hardwareConcurrency,
    },
    fixture,
    packageGraph,
    measurements: {
      server,
      uiOnlyMetadata,
      actors,
      automerge,
      resources,
    },
    elapsedMs: round(performance.now() - startedAt),
    limitations: [
      "The idle actor population is modeled at fixture scale but live child processes are sampled because the current one-process-per-actor design makes a full 250-process run unsafe for routine developer machines.",
      "The idle resource population is modeled at fixture scale while a deterministic subset is provisioned; the hot subset crosses the configured handle bound.",
      "Reconnect bursts exercise the real Automerge server adapter and protocol frames in-process, without opening hundreds of kernel sockets.",
      "Server memory is a single cold-start sample from an isolated empty XDG data root and is evidence, not a cross-machine performance threshold.",
    ],
  };
}

async function main() {
  const result = await captureManagedArchitectureBaseline();
  const output = `${JSON.stringify(result, null, 2)}\n`;
  const outputPath = outputPathFromArgs(Bun.argv.slice(2));
  if (outputPath) {
    await writeFile(outputPath, output, "utf8");
    console.error(`[managed-architecture-baseline] wrote ${outputPath}`);
  } else {
    process.stdout.write(output);
  }
}

if (import.meta.main) {
  await main();
}
