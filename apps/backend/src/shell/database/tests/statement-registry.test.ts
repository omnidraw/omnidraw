import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DATABASE_STATEMENTS,
  DATABASE_STATEMENT_NAMES,
  DATABASE_STATEMENT_TEMPLATE_MARKERS,
  databaseParameterPlaceholders,
  renderDatabaseStatement,
  type TDatabaseStatementName,
} from '../statement-registry';

const STATEMENT_DIRECTORY = path.resolve(
  import.meta.dir,
  '../../../shell/database/stmts',
);

function statementNameForFile(fileName: string): string {
  return fileName
    .replace(/\.sql$/, '')
    .replace(/-([a-z0-9])/g, (_match, character: string) => character.toUpperCase());
}

function topLevelSemicolons(sql: string): number {
  let count = 0;
  let quote: "'" | '"' | '`' | ']' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index]!;
    const next = sql[index + 1];

    if (lineComment) {
      if (current === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (quote === ']' && current === ']') quote = null;
      else if (quote !== ']' && current === quote) {
        if (next === quote) index += 1;
        else quote = null;
      }
      continue;
    }

    if (current === '-' && next === '-') {
      lineComment = true;
      index += 1;
    } else if (current === '/' && next === '*') {
      blockComment = true;
      index += 1;
    } else if (current === '[') {
      quote = ']';
    } else if (current === "'" || current === '"' || current === '`') {
      quote = current;
    } else if (current === ';') {
      count += 1;
    }
  }

  return count;
}

describe('production database statement registry', () => {
  test('is a one-to-one exhaustive registry over the SQL asset directory', async () => {
    const files = (await readdir(STATEMENT_DIRECTORY))
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort();
    const fileStatementNames = files.map(statementNameForFile).sort();
    const registeredNames = [...DATABASE_STATEMENT_NAMES].sort();

    expect(new Set(DATABASE_STATEMENT_NAMES).size).toBe(DATABASE_STATEMENT_NAMES.length);
    expect(Object.keys(DATABASE_STATEMENTS).sort()).toEqual(registeredNames);
    expect(fileStatementNames).toEqual(registeredNames);
    expect(files.filter((fileName) => /\d+\.sql$|-read-read-|-write-(?:read|insert|update|delete)-/.test(fileName))).toEqual([]);

    for (const fileName of files) {
      const name = statementNameForFile(fileName) as TDatabaseStatementName;
      const source = await readFile(path.join(STATEMENT_DIRECTORY, fileName), 'utf8');
      expect(DATABASE_STATEMENTS[name]).toBe(source);
    }
  });

  test('keeps exactly one operation in each SQL asset', () => {
    for (const [name, sql] of Object.entries(DATABASE_STATEMENTS)) {
      expect(sql.trim().length, name).toBeGreaterThan(0);
      const operationSql = sql.replace(/^(?:\s*--[^\n]*(?:\n|$))+/, '').trimStart();
      expect(operationSql, name).toMatch(
        /^(?:ALTER|BEGIN|COMMIT|CREATE|DELETE|DROP|INSERT|PRAGMA|ROLLBACK|SELECT|UPDATE)\b/i,
      );
      const expectedInternalSemicolons = /^CREATE\s+TRIGGER\b/i.test(operationSql) ? 1 : 0;
      expect(topLevelSemicolons(sql), name).toBe(expectedInternalSemicolons);
    }
  });

  test('declares every template marker and rejects unsafe substitutions', () => {
    const declaredTemplates = Object.keys(DATABASE_STATEMENT_TEMPLATE_MARKERS).sort();
    const discoveredTemplates = Object.entries(DATABASE_STATEMENTS)
      .filter(([, sql]) => /__[A-Z0-9_]+__/.test(sql))
      .map(([name]) => name)
      .sort();
    expect(discoveredTemplates).toEqual(declaredTemplates);

    for (const name of declaredTemplates) {
      const markers = [...DATABASE_STATEMENTS[name as keyof typeof DATABASE_STATEMENTS]
        .matchAll(/__[A-Z0-9_]+__/g)]
        .map(([marker]) => marker!)
        .filter((marker, index, all) => all.indexOf(marker) === index)
        .sort();
      expect(markers, name).toEqual(
        [...DATABASE_STATEMENT_TEMPLATE_MARKERS[
          name as keyof typeof DATABASE_STATEMENT_TEMPLATE_MARKERS
        ]].sort(),
      );
    }

    expect(databaseParameterPlaceholders(3)).toBe('?, ?, ?');
    expect(() => databaseParameterPlaceholders(0)).toThrow(RangeError);
    expect(() => renderDatabaseStatement('canvasItemReadByIds', {
      __IDS__: '?); DROP TABLE canvas_items; --',
    })).toThrow('unsafe replacement');
  });
});
