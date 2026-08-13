import { DATABASE_STATEMENTS } from '../statement-registry';
import type { Database } from '@tursodatabase/database';
import type { TJson, TKeyValue } from '../model';
import { getKeyValueRow } from './read-key-value';

type TEffects = { db: Database };
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

export async function addKeyValueRow(effects: TEffects, args: TArgsAdd): Promise<TKeyValue> {
  const [text, json, number, bool, blob] = columnValues(args);
  await (await effects.db.prepare(DATABASE_STATEMENTS.keyValueUpsert)).run(args.name, args.type, text, json, number, bool, blob);
  const stored = await getKeyValueRow(effects, { name: args.name });
  if (!stored) throw new Error('Failed to store key value.');
  return stored;
}

export async function removeKeyValueRow(effects: TEffects, args: TArgsRemove): Promise<void> {
  await (await effects.db.prepare(DATABASE_STATEMENTS.keyValueDelete)).run(args.name);
}
