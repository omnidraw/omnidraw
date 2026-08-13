import { DATABASE_STATEMENTS } from '../statement-registry';
import type { Database } from '@tursodatabase/database';
import type { TJson, TKeyValue } from '../model';

type TEffects = { db: Database };
type TArgs = { name: string };

type TRawKeyValue = {
  name: string;
  kind: TKeyValue['type'];
  text_value: string | null;
  json_value: unknown | null;
  number_value: number | null;
  bool_value: boolean | number | null;
  blob_value: Uint8Array | null;
};

function parseJson(value: unknown): TJson {
  return (typeof value === 'string' ? JSON.parse(value) : value) as TJson;
}

function parseKeyValue(row: unknown): TKeyValue {
  const value = row as TRawKeyValue;
  if (value.kind === 'text' && value.text_value !== null) {
    return { name: value.name, type: 'text', value: value.text_value };
  }
  if (value.kind === 'json' && value.json_value !== null) {
    return { name: value.name, type: 'json', value: parseJson(value.json_value) };
  }
  if (value.kind === 'number' && value.number_value !== null) {
    return { name: value.name, type: 'number', value: value.number_value };
  }
  if (value.kind === 'bool' && value.bool_value !== null) {
    return { name: value.name, type: 'bool', value: Boolean(value.bool_value) };
  }
  if (value.kind === 'blob' && value.blob_value !== null) {
    return { name: value.name, type: 'blob', value: value.blob_value };
  }
  throw new Error(`Invalid key value row '${value.name}'.`);
}

export async function getKeyValueRow(effects: TEffects, args: TArgs): Promise<TKeyValue | null> {
  const row = await (await effects.db.prepare(DATABASE_STATEMENTS.keyValueReadByName)).get(args.name);
  return row ? parseKeyValue(row) : null;
}
