import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { connect, Database } from "@tursodatabase/database";
import { DEFAULT_OSS_ORGANIZATION_ID } from "../../../src/CONSTANTS";
import { fxKeyValueGet } from "../../../src/DbServiceTurso/fx.keyValue";
import { txKeyValueAdd, txKeyValueRemove } from "../../../src/DbServiceTurso/tx.keyValue";
import { txRunMigrations } from "../../../src/DbServiceTurso/tx.migrations";
import { EXPECTED_APPLICATION_TABLES } from "../../../src/schema/expected-schema";

async function inMemoryDb() {
  // @ts-expect-error custom_types not typed yet
  return connect(":memory:", { experimental: ["custom_types", "triggers", "index_method"] });
}

async function expectSqlConstraintFailure(action: () => Promise<unknown>) {
  let error: unknown;

  try {
    await action();
  } catch (caught) {
    error = caught;
  }

  expect(error).toBeInstanceOf(Error);
}

describe("tx.keyValue/fx.keyValue", () => {
  let db!: Database;

  beforeEach(async () => {
    db = await inMemoryDb();
    await txRunMigrations({ db, Bun }, {
      applicationVersion: "test",
      appliedAtMs: 1,
      expectedApplicationTables: EXPECTED_APPLICATION_TABLES,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  test("adds and gets text, json, number, and bool values", async () => {
    const text = await txKeyValueAdd({ db }, { name: "kv-text", type: "text", value: "hello" });
    const json = await txKeyValueAdd({ db }, { name: "kv-json", type: "json", value: { ok: true, count: 2 } });
    const number = await txKeyValueAdd({ db }, { name: "kv-number", type: "number", value: 42 });
    const bool = await txKeyValueAdd({ db }, { name: "kv-bool", type: "bool", value: true });

    expect(text).toEqual({ name: "kv-text", type: "text", value: "hello" });
    expect(json).toEqual({ name: "kv-json", type: "json", value: { ok: true, count: 2 } });
    expect(number).toEqual({ name: "kv-number", type: "number", value: 42 });
    expect(bool).toEqual({ name: "kv-bool", type: "bool", value: true });

    await expect(fxKeyValueGet({ db }, { name: "kv-text" })).resolves.toEqual(text);
    await expect(fxKeyValueGet({ db }, { name: "kv-json" })).resolves.toEqual(json);
    await expect(fxKeyValueGet({ db }, { name: "kv-number" })).resolves.toEqual(number);
    await expect(fxKeyValueGet({ db }, { name: "kv-bool" })).resolves.toEqual(bool);
  });

  test("removes a value and get returns null", async () => {
    await txKeyValueAdd({ db }, { name: "kv-remove", type: "text", value: "temporary" });

    await expect(fxKeyValueGet({ db }, { name: "kv-remove" })).resolves.toEqual({
      name: "kv-remove",
      type: "text",
      value: "temporary",
    });

    await txKeyValueRemove({ db }, { name: "kv-remove" });

    await expect(fxKeyValueGet({ db }, { name: "kv-remove" })).resolves.toBeNull();
  });

  test("enforces exactly one non-null value column", async () => {
    const insert = await db.prepare(`
      INSERT INTO key_values (
        org_id, name, kind, text_value, json_value, number_value, bool_value,
        blob_value, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, 1)
    `);

    await expectSqlConstraintFailure(() => insert.run(
      DEFAULT_OSS_ORGANIZATION_ID, "kv-none", "text", null, null, null, null,
    ));
    await expectSqlConstraintFailure(() => insert.run(
      DEFAULT_OSS_ORGANIZATION_ID, "kv-many", "text", "hello", null, 42, null,
    ));

    await insert.run(DEFAULT_OSS_ORGANIZATION_ID, "kv-one", "text", "hello", null, null, null);

    await expect(fxKeyValueGet({ db }, { name: "kv-one" })).resolves.toEqual({
      name: "kv-one",
      type: "text",
      value: "hello",
    });
  });
});
