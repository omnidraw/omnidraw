import { Repo, type PeerId } from '@automerge/automerge-repo';
import { connect, type Database as TursoDatabase } from '@tursodatabase/database';
import { TursoStorageAdapter } from '@vibecanvas/service-automerge/adapters/turso.adapter';
import type { TCanvasDoc } from '@vibecanvas/service-automerge/types/canvas-doc.types';

type TCanvasRow = {
  id: string;
  name: string;
  automerge_url: string;
  created_at: number | string;
};

type TWorkerPayloads = {
  'list-canvases': { dbPath: string };
  'seed-canvas': {
    dbPath: string;
    args: {
      name?: string;
      docId?: string;
      docName?: string;
      createdAtUnixSeconds?: number;
      elements?: TCanvasDoc['elements'];
      groups?: TCanvasDoc['groups'];
    };
  };
  'read-canvas-doc': { dbPath: string; automergeUrl: string };
};

function readPayload<TKey extends keyof TWorkerPayloads>(command: TKey): TWorkerPayloads[TKey] {
  const encoded = Bun.argv[3];
  if (!encoded) throw new Error(`Missing payload for ${command}`);
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TWorkerPayloads[TKey];
}

function createRepo(database: TursoDatabase): Repo {
  return new Repo({ storage: new TursoStorageAdapter(database), peerId: `cli-test-worker-${crypto.randomUUID()}` as PeerId });
}

async function createCanvasRow(args: { database: TursoDatabase; repo: Repo; name: string; createdAtUnixSeconds?: number }): Promise<TCanvasRow> {
  const handle = args.repo.create<TCanvasDoc>({ id: crypto.randomUUID(), name: args.name, elements: {}, groups: {} });
  const createdAtUnixSeconds = args.createdAtUnixSeconds ?? Math.floor(Date.now() / 1000);
  const canvas = { id: crypto.randomUUID(), name: args.name, created_at: createdAtUnixSeconds, automerge_url: handle.url };
  const insert = await args.database.prepare('INSERT INTO canvas (id, name, automerge_url, created_at) VALUES (?, ?, ?, ?)');
  await insert.run(canvas.id, canvas.name, canvas.automerge_url, createdAtUnixSeconds);
  const select = await args.database.prepare('SELECT id, name, automerge_url, created_at FROM canvas WHERE id = ? LIMIT 1');
  return await select.get(canvas.id) as TCanvasRow;
}

async function readCanvasDocFromDb(databasePath: string, automergeUrl: string): Promise<TCanvasDoc> {
  const database = await connect(databasePath);
  const repo = createRepo(database);
  const handle = await repo.find<TCanvasDoc>(automergeUrl as never);
  await handle.whenReady();
  const doc = handle.doc();
  if (!doc) throw new Error(`Canvas doc ${automergeUrl} not found in ${databasePath}`);
  return structuredClone(doc);
}

async function waitForCanvasDoc(args: { databasePath: string; automergeUrl: string; expectedElementCount: number; expectedGroupCount: number }): Promise<TCanvasDoc> {
  const startedAt = Date.now();
  let lastError: unknown = null;
  while (Date.now() - startedAt < 2000) {
    try {
      const doc = await readCanvasDocFromDb(args.databasePath, args.automergeUrl);
      if (Object.keys(doc.elements).length === args.expectedElementCount && Object.keys(doc.groups).length === args.expectedGroupCount) return doc;
    } catch (error) {
      lastError = error;
    }
    await Bun.sleep(25);
  }
  throw new Error(`Timed out waiting for persisted canvas doc ${args.automergeUrl}: ${String(lastError)}`);
}

async function run(): Promise<void> {
  const command = Bun.argv[2] as keyof TWorkerPayloads | undefined;
  if (!command) throw new Error('Missing worker command');

  if (command === 'list-canvases') {
    const payload = readPayload('list-canvases');
    const database = await connect(payload.dbPath);
    const stmt = await database.prepare('SELECT id, name, automerge_url, created_at FROM canvas ORDER BY created_at ASC, name ASC');
    const rows = await stmt.all() as TCanvasRow[];
    console.log(JSON.stringify(rows));
    return;
  }

  if (command === 'seed-canvas') {
    const payload = readPayload('seed-canvas');
    const database = await connect(payload.dbPath);
    const repo = createRepo(database);
    const canvas = await createCanvasRow({ database, repo, name: payload.args.name ?? `cli-canvas-${crypto.randomUUID().slice(0, 8)}`, createdAtUnixSeconds: payload.args.createdAtUnixSeconds });
    const handle = await repo.find<TCanvasDoc>(canvas.automerge_url as never);
    await handle.whenReady();
    handle.change((doc: TCanvasDoc) => {
      doc.id = payload.args.docId ?? doc.id;
      doc.name = payload.args.docName ?? canvas.name;
      doc.elements = structuredClone(payload.args.elements ?? {});
      doc.groups = structuredClone(payload.args.groups ?? {});
    });
    await waitForCanvasDoc({ databasePath: payload.dbPath, automergeUrl: canvas.automerge_url, expectedElementCount: Object.keys(payload.args.elements ?? {}).length, expectedGroupCount: Object.keys(payload.args.groups ?? {}).length });
    console.log(JSON.stringify({ canvas, automergeUrl: canvas.automerge_url }));
    return;
  }

  if (command === 'read-canvas-doc') {
    const payload = readPayload('read-canvas-doc');
    const doc = await readCanvasDocFromDb(payload.dbPath, payload.automergeUrl);
    console.log(JSON.stringify(doc));
    return;
  }

  throw new Error(`Unsupported worker command: ${command}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
