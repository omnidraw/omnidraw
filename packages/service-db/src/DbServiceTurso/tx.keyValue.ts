import type { Database } from '@tursodatabase/database';
import type { TJson, TKeyValue } from '../model';
import { fxKeyValueGet } from './fx.keyValue';

type TPortal = { db: Database };
type TArgsAdd = TKeyValue;
type TArgsRemove = { name: string };

function serializeJson(value: TJson): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('Key-value JSON is not serializable.');
  return serialized;
}

function columnValues(
  args: TKeyValue,
): [string | null, string | null, number | null, boolean | null, Uint8Array | null] {
  if (args.type === 'text') return [args.value, null, null, null, null];
  if (args.type === 'json') return [null, serializeJson(args.value), null, null, null];
  if (args.type === 'number') return [null, null, args.value, null, null];
  if (args.type === 'bool') return [null, null, null, args.value, null];
  return [null, null, null, null, args.value];
}

export async function txKeyValueAdd(portal: TPortal, args: TArgsAdd): Promise<TKeyValue> {
  const [text, json, number, bool, blob] = columnValues(args);
  await (await portal.db.prepare(`
    INSERT INTO key_values (
      name, kind, text_value, json_value, number_value, bool_value, blob_value
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (name) DO UPDATE SET
      kind = excluded.kind,
      text_value = excluded.text_value,
      json_value = excluded.json_value,
      number_value = excluded.number_value,
      bool_value = excluded.bool_value,
      blob_value = excluded.blob_value,
      updated_at_sec = CURRENT_TIMESTAMP
  `)).run(args.name, args.type, text, json, number, bool, blob);
  const stored = await fxKeyValueGet(portal, { name: args.name });
  if (!stored) throw new Error('Failed to store key value.');
  return stored;
}

export async function txKeyValueRemove(portal: TPortal, args: TArgsRemove): Promise<void> {
  await (await portal.db.prepare(`DELETE FROM key_values WHERE name = ?`)).run(args.name);
}
