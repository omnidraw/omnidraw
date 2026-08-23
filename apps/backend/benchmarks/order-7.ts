import {
  CANVAS_SCENE_SCHEMA_VERSION,
  type TCanvasCommand,
  type TCanvasItemQueryCursor,
  type TCanvasItemSnapshot,
  type TCanvasSceneNode,
  type TCanvasSnapshot,
} from '@omnidraw/canvas-contract';
import { fnReduceCanvasCommand } from '../src/core/canvas/fn.reduce-command';
import { fnCanonicalJson } from '../src/core/fn.canonical-json';
import { CanvasItemStoreTurso } from '../src/shell/database/CanvasItemStoreTurso';
import { DbServiceTurso } from '../src/shell/database/DbServiceTurso/DbServiceTurso';
import { runDatabaseWrite } from '../src/shell/database/run-database-transaction';

type TBenchmarkResult = Readonly<{
  name: string;
  workload: string;
  samples: number;
  operationsPerSample: number;
  medianMs: number;
  p95Ms: number;
  operationsPerSecond: number;
  checksum: number;
}>;

type TBenchmarkOptions = Readonly<{
  samples: number;
  warmups: number;
  operationsPerSample: number;
  workload: string;
}>;

const CANVAS_ID = 'order-7-benchmark-canvas';
const LARGE_CANVAS_ITEM_COUNT = 2_048;
const transform = Object.freeze({
  position: Object.freeze({ x: 0, y: 0 }),
  rotation: 0,
  scale: Object.freeze({ x: 1, y: 1 }),
  skew: Object.freeze({ x: 0, y: 0 }),
  origin: Object.freeze({ x: 0, y: 0 }),
});

function percentile(values: readonly number[], fraction: number): number {
  return values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)]!;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

async function benchmark(
  name: string,
  options: TBenchmarkOptions,
  run: () => number | Promise<number>,
): Promise<TBenchmarkResult> {
  for (let index = 0; index < options.warmups; index += 1) await run();
  const durations: number[] = [];
  let checksum = 0;
  for (let index = 0; index < options.samples; index += 1) {
    const started = Bun.nanoseconds();
    checksum ^= await run();
    durations.push((Bun.nanoseconds() - started) / 1_000_000);
  }
  durations.sort((left, right) => left - right);
  const medianMs = percentile(durations, 0.5);
  return Object.freeze({
    name,
    workload: options.workload,
    samples: options.samples,
    operationsPerSample: options.operationsPerSample,
    medianMs: round(medianMs),
    p95Ms: round(percentile(durations, 0.95)),
    operationsPerSecond: round(options.operationsPerSample / (medianMs / 1_000)),
    checksum,
  });
}

function rectangle(index: number): TCanvasSceneNode {
  return Object.freeze({
    id: `rect-${String(index).padStart(5, '0')}`,
    parentId: null,
    orderKey: String(index).padStart(8, '0'),
    kind: 'rect',
    transform,
    size: Object.freeze({ width: 100 + (index % 7), height: 80 + (index % 11) }),
    metadata: Object.freeze({
      benchmark: true,
      index,
      labels: Object.freeze(['canvas', 'order-7', `item-${index % 13}`]),
    }),
  });
}

function itemSnapshot(item: TCanvasSceneNode): TCanvasItemSnapshot {
  return Object.freeze({
    id: item.id,
    item,
    itemRevision: 1,
    createdAtSec: '2026-08-13 00:00:00',
    updatedAtSec: '2026-08-13 00:00:00',
  });
}

function createLargeCanvas(): Readonly<{
  command: TCanvasCommand;
  items: readonly TCanvasItemSnapshot[];
  snapshot: TCanvasSnapshot;
}> {
  const items = Object.freeze(Array.from(
    { length: LARGE_CANVAS_ITEM_COUNT },
    (_, index) => itemSnapshot(rectangle(index)),
  ));
  const target = items[Math.floor(items.length / 2)]!;
  return Object.freeze({
    items,
    snapshot: Object.freeze({
      schemaVersion: CANVAS_SCENE_SCHEMA_VERSION,
      canvasId: CANVAS_ID,
      revision: 1,
      items,
    }),
    command: Object.freeze({
      commandId: 'order-7-reorder',
      canvasId: CANVAS_ID,
      baseRevision: 1,
      operations: Object.freeze([Object.freeze({
        type: 'reorder' as const,
        itemId: target.id,
        orderKey: 'zzzzzzzz',
      })]),
      preconditions: Object.freeze([Object.freeze({
        type: 'item-revision' as const,
        itemId: target.id,
        itemRevision: target.itemRevision,
      })]),
    }),
  });
}

function canonicalPayload(items: readonly TCanvasItemSnapshot[]): unknown {
  return Object.freeze({
    schemaVersion: 1,
    choices: Object.freeze(items.slice(0, 128).map((entry, index) => Object.freeze({
      step: index,
      node: entry.item,
      outcome: index % 3 === 0 ? undefined : Object.freeze({ accepted: true, rank: index % 17 }),
    }))),
    nested: Object.freeze({ z: Object.freeze([3, 2, 1]), a: 'canonical' }),
  });
}

async function seedCanvasStore(
  service: DbServiceTurso,
  items: readonly TCanvasItemSnapshot[],
): Promise<CanvasItemStoreTurso> {
  await service.canvas.create({ id: CANVAS_ID, name: 'Order 7 benchmark' });
  const store = new CanvasItemStoreTurso(service.db);
  let revision = 0;
  for (let offset = 0; offset < items.length; offset += 128) {
    const result = await store.applyMutations({
      commandId: `seed-${offset}`,
      canvasId: CANVAS_ID,
      expectedCanvasRevision: revision,
      mutations: items.slice(offset, offset + 128).map((entry) => Object.freeze({
        type: 'insert' as const,
        item: entry.item,
      })),
    });
    if (result.status !== 'committed') throw new Error(`Canvas seed conflicted at offset ${offset}.`);
    revision = result.revision;
  }
  return store;
}

async function scanCanvas(store: CanvasItemStoreTurso): Promise<number> {
  let cursor: TCanvasItemQueryCursor | undefined;
  let count = 0;
  do {
    const page = await store.queryItems({
      canvasId: CANVAS_ID,
      filter: Object.freeze({ type: 'all' }),
      limit: 256,
      ...(cursor === undefined ? {} : { cursor }),
    });
    count += page.items.length;
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return count;
}

async function main(): Promise<void> {
  const largeCanvas = createLargeCanvas();
  const canonical = canonicalPayload(largeCanvas.items);
  const service = new DbServiceTurso({
    applicationVersion: 'order-7-benchmark',
    databasePath: ':memory:',
    dataDir: '/tmp',
    cacheDir: '/tmp',
  });
  await service.start();
  try {
    const store = await seedCanvasStore(service, largeCanvas.items);
    const results: TBenchmarkResult[] = [];

    results.push(await benchmark('canvas-command-reduction', {
      workload: `${LARGE_CANVAS_ITEM_COUNT}-item valid snapshot; one guarded reorder; full authoritative reduction`,
      samples: 9,
      warmups: 2,
      operationsPerSample: 1,
    }, () => fnReduceCanvasCommand({
      snapshot: largeCanvas.snapshot,
      command: largeCanvas.command,
      timestamp: '2026-08-13 00:00:01',
    }).snapshot.revision));

    results.push(await benchmark('canvas-query-full-scan', {
      workload: `${LARGE_CANVAS_ITEM_COUNT} Turso rows; 256-item cursor pages; strict row validation`,
      samples: 7,
      warmups: 1,
      operationsPerSample: LARGE_CANVAS_ITEM_COUNT,
    }, () => scanCanvas(store)));

    results.push(await benchmark('canonical-json-repeated', {
      workload: 'same frozen 128-node nested payload canonicalized 100 times',
      samples: 9,
      warmups: 2,
      operationsPerSample: 100,
    }, () => {
      let checksum = 0;
      for (let index = 0; index < 100; index += 1) checksum ^= fnCanonicalJson(canonical).length;
      return checksum;
    }));

    results.push(await benchmark('serialized-database-operations', {
      workload: '256 same-connection operations queued concurrently through database serialization',
      samples: 9,
      warmups: 2,
      operationsPerSample: 256,
    }, async () => {
      const results = await Promise.all(Array.from({ length: 256 }, (_, index) => (
        runDatabaseWrite({ database: service.db }, {
          operation: async () => index,
        })
      )));
      return results.reduce((sum, value) => sum ^ value, 0);
    }));

    console.log(JSON.stringify({
      benchmarkVersion: 1,
      runtime: `Bun ${Bun.version}`,
      platform: `${process.platform}-${process.arch}`,
      results,
    }, null, 2));
  } finally {
    await service.stop();
  }
}

await main();
