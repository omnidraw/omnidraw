/**
 * @file Conservative SQL profile shared by widget check/build and resource hosts.
 *
 * This is not a general SQL parser. It recognizes the deliberately small
 * portable SQLite/Turso statement surface and fails closed for every root it
 * cannot classify. Quoting and comments are tokenized so forbidden words in
 * data do not become policy decisions.
 */

export const PORTABLE_RESOURCE_SQL_LIMITS = Object.freeze({
  maxUtf8Bytes: 65_536,
  maxTokens: 16_384,
  maxNesting: 64,
});

export type TPortableResourceSqlEffect = 'read' | 'write';

export type TPortableResourceSqlRejectionCode =
  | 'SQL_EMPTY'
  | 'SQL_LIMIT_EXCEEDED'
  | 'SQL_MALFORMED'
  | 'SQL_MULTIPLE_STATEMENTS'
  | 'SQL_TRANSACTION_CONTROL'
  | 'SQL_ATTACHMENT_FORBIDDEN'
  | 'SQL_PRAGMA_FORBIDDEN'
  | 'SQL_VACUUM_FORBIDDEN'
  | 'SQL_EXTENSION_FORBIDDEN'
  | 'SQL_HOST_FILE_FORBIDDEN'
  | 'SQL_TEMP_OBJECT_FORBIDDEN'
  | 'SQL_TRIGGER_FORBIDDEN'
  | 'SQL_INTERNAL_NAMESPACE_WRITE_FORBIDDEN'
  | 'SQL_UNCLASSIFIED'
  | 'SQL_EFFECT_MISMATCH';

export type TPortableResourceSqlClassification =
  | Readonly<{
      allowed: true;
      effect: TPortableResourceSqlEffect;
      statement:
        | 'select'
        | 'values'
        | 'insert'
        | 'update'
        | 'delete'
        | 'replace'
        | 'create'
        | 'alter'
        | 'drop';
      hasReturning: boolean;
      hasCte: boolean;
    }>
  | Readonly<{
      allowed: false;
      code: TPortableResourceSqlRejectionCode;
      message: string;
    }>;

type TToken = Readonly<{
  kind: 'word' | 'quoted' | 'string' | 'number' | 'parameter' | 'symbol';
  text: string;
  upper: string;
}>;

type TTokenizeResult =
  | Readonly<{ ok: true; tokens: readonly TToken[] }>
  | Readonly<{
      ok: false;
      code: Extract<
        TPortableResourceSqlRejectionCode,
        'SQL_LIMIT_EXCEEDED' | 'SQL_MALFORMED'
      >;
      message: string;
    }>;

type TRootClassification = Readonly<{
  effect: TPortableResourceSqlEffect;
  statement: Extract<TPortableResourceSqlClassification, { allowed: true }>['statement'];
  hasCte: boolean;
  rootIndex: number;
}>;

const encoder = new TextEncoder();
const TRANSACTION_WORDS = new Set([
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'SAVEPOINT',
  'RELEASE',
]);
const ATTACHMENT_WORDS = new Set(['ATTACH', 'DETACH']);
const HOST_FILE_FUNCTIONS = new Set([
  'READFILE',
  'WRITEFILE',
  'SQLITE_READFILE',
  'SQLITE_WRITEFILE',
]);
const EXTENSION_WORDS = new Set([
  'LOAD_EXTENSION',
  'FTS3_TOKENIZER',
  'VIRTUAL',
]);
const READ_ROOTS = new Map<string, 'select' | 'values'>([
  ['SELECT', 'select'],
  ['VALUES', 'values'],
]);
const WRITE_ROOTS = new Map<string, Exclude<
  TRootClassification['statement'],
  'select' | 'values'
>>([
  ['INSERT', 'insert'],
  ['UPDATE', 'update'],
  ['DELETE', 'delete'],
  ['REPLACE', 'replace'],
  ['CREATE', 'create'],
  ['ALTER', 'alter'],
  ['DROP', 'drop'],
]);

function rejection(
  code: TPortableResourceSqlRejectionCode,
  message: string,
): Extract<TPortableResourceSqlClassification, { allowed: false }> {
  return Object.freeze({ allowed: false, code, message });
}

function token(
  kind: TToken['kind'],
  text: string,
  upper = text.toUpperCase(),
): TToken {
  return Object.freeze({ kind, text, upper });
}

function tokenize(sql: string): TTokenizeResult {
  const tokens: TToken[] = [];
  const push = (value: TToken): boolean => {
    tokens.push(value);
    return tokens.length <= PORTABLE_RESOURCE_SQL_LIMITS.maxTokens;
  };
  for (let index = 0; index < sql.length;) {
    const char = sql[index];
    const next = sql[index + 1];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '-' && next === '-') {
      index += 2;
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') {
        index += 1;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      const close = sql.indexOf('*/', index + 2);
      if (close < 0) {
        return {
          ok: false,
          code: 'SQL_MALFORMED',
          message: 'Portable SQL contains an unterminated block comment.',
        };
      }
      index = close + 2;
      continue;
    }
    if (char === "'") {
      let text = '';
      index += 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === "'") {
          if (sql[index + 1] === "'") {
            text += "'";
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        text += sql[index++];
      }
      if (!closed) {
        return {
          ok: false,
          code: 'SQL_MALFORMED',
          message: 'Portable SQL contains an unterminated string.',
        };
      }
      if (!push(token('string', text, ''))) break;
      continue;
    }
    if (char === '"' || char === '`' || char === '[') {
      const close = char === '[' ? ']' : char;
      let text = '';
      index += 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === close) {
          if (char !== '[' && sql[index + 1] === close) {
            text += close;
            index += 2;
            continue;
          }
          if (char === '[' && sql[index + 1] === ']') {
            text += ']';
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        text += sql[index++];
      }
      if (!closed || text.length === 0) {
        return {
          ok: false,
          code: 'SQL_MALFORMED',
          message: 'Portable SQL contains an invalid quoted identifier.',
        };
      }
      if (!push(token('quoted', text))) break;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index++;
      while (index < sql.length && /[A-Za-z0-9_$]/.test(sql[index])) index += 1;
      if (!push(token('word', sql.slice(start, index)))) break;
      continue;
    }
    if (/[0-9]/.test(char)) {
      const start = index++;
      while (index < sql.length && /[0-9A-Fa-f.eExX+-]/.test(sql[index])) index += 1;
      if (!push(token('number', sql.slice(start, index), ''))) break;
      continue;
    }
    if (char === '?' || char === ':' || char === '@' || char === '$') {
      const start = index++;
      while (index < sql.length && /[A-Za-z0-9_]/.test(sql[index])) index += 1;
      if (!push(token('parameter', sql.slice(start, index), ''))) break;
      continue;
    }
    const two = `${char}${next ?? ''}`;
    if (['<=', '>=', '<>', '!=', '==', '||', '->', '<<', '>>'].includes(two)) {
      if (!push(token('symbol', two, ''))) break;
      index += 2;
      continue;
    }
    if ('(),;.+-*/%<>=~&|'.includes(char)) {
      if (!push(token('symbol', char, ''))) break;
      index += 1;
      continue;
    }
    return {
      ok: false,
      code: 'SQL_MALFORMED',
      message: `Portable SQL contains unsupported token '${char}'.`,
    };
  }
  if (tokens.length > PORTABLE_RESOURCE_SQL_LIMITS.maxTokens) {
    return {
      ok: false,
      code: 'SQL_LIMIT_EXCEEDED',
      message: 'Portable SQL exceeds its token limit.',
    };
  }
  return { ok: true, tokens: Object.freeze(tokens) };
}

function matchingParen(
  tokens: readonly TToken[],
  open: number,
  end: number,
): number | null {
  if (tokens[open]?.text !== '(') return null;
  let depth = 0;
  for (let index = open; index < end; index += 1) {
    if (tokens[index].text === '(') {
      depth += 1;
      if (depth > PORTABLE_RESOURCE_SQL_LIMITS.maxNesting) return null;
    } else if (tokens[index].text === ')') {
      depth -= 1;
      if (depth === 0) return index;
      if (depth < 0) return null;
    }
  }
  return null;
}

function isIdentifier(
  value: TToken | undefined,
): value is TToken & Readonly<{ kind: 'word' | 'quoted' }> {
  return value?.kind === 'word' || value?.kind === 'quoted';
}

function classifyRoot(
  tokens: readonly TToken[],
  start: number,
  end: number,
  recursion = 0,
): TRootClassification | null {
  if (recursion > PORTABLE_RESOURCE_SQL_LIMITS.maxNesting || start >= end) return null;
  const first = tokens[start];
  if (first.kind !== 'word') return null;
  const read = READ_ROOTS.get(first.upper);
  if (read !== undefined) {
    return { effect: 'read', statement: read, hasCte: false, rootIndex: start };
  }
  const write = WRITE_ROOTS.get(first.upper);
  if (write !== undefined) {
    return { effect: 'write', statement: write, hasCte: false, rootIndex: start };
  }
  if (first.upper !== 'WITH') return null;
  let index = start + 1;
  if (tokens[index]?.upper === 'RECURSIVE') index += 1;
  let cteEffect: TPortableResourceSqlEffect = 'read';
  while (index < end) {
    if (!isIdentifier(tokens[index])) return null;
    index += 1;
    if (tokens[index]?.text === '(') {
      const columnsEnd = matchingParen(tokens, index, end);
      if (columnsEnd === null) return null;
      index = columnsEnd + 1;
    }
    if (tokens[index]?.upper !== 'AS') return null;
    index += 1;
    if (tokens[index]?.upper === 'NOT' && tokens[index + 1]?.upper === 'MATERIALIZED') {
      index += 2;
    } else if (tokens[index]?.upper === 'MATERIALIZED') {
      index += 1;
    }
    if (tokens[index]?.text !== '(') return null;
    const bodyEnd = matchingParen(tokens, index, end);
    if (bodyEnd === null) return null;
    const body = classifyRoot(tokens, index + 1, bodyEnd, recursion + 1);
    if (body === null) return null;
    if (body.effect === 'write') cteEffect = 'write';
    index = bodyEnd + 1;
    if (tokens[index]?.text === ',') {
      index += 1;
      continue;
    }
    break;
  }
  const root = classifyRoot(tokens, index, end, recursion + 1);
  if (root === null) return null;
  return {
    effect: root.effect === 'write' || cteEffect === 'write' ? 'write' : 'read',
    statement: root.statement,
    hasCte: true,
    rootIndex: root.rootIndex,
  };
}

function callableForbiddenWord(tokens: readonly TToken[], words: ReadonlySet<string>): boolean {
  return tokens.some((value, index) => (
    (value.kind === 'word' || value.kind === 'quoted')
    && words.has(value.upper)
    && tokens[index + 1]?.text === '('
  ));
}

function internalIdentifier(value: TToken): boolean {
  if (value.kind !== 'word' && value.kind !== 'quoted') return false;
  const name = value.text.normalize('NFC').toLowerCase();
  return name.startsWith('sqlite_')
    || name.startsWith('libsql_')
    || name.startsWith('_turso_')
    || name.startsWith('turso_')
    || /^_+omnidraw(?:_|$)/.test(name)
    || /^omnidraw(?:_|$)/.test(name);
}

function qualifiedTargetIsInternal(
  tokens: readonly TToken[],
  start: number,
): boolean {
  const first = tokens[start];
  if (!isIdentifier(first)) return false;
  if (internalIdentifier(first)) return true;
  if (tokens[start + 1]?.text !== '.' || !isIdentifier(tokens[start + 2])) {
    return false;
  }
  const schema = first.text.toLowerCase();
  return ['sqlite', 'libsql', 'turso', 'omnidraw'].includes(schema)
    || internalIdentifier(tokens[start + 2]);
}

function skipWords(
  tokens: readonly TToken[],
  start: number,
  words: ReadonlySet<string>,
): number {
  let index = start;
  while (tokens[index]?.kind === 'word' && words.has(tokens[index].upper)) index += 1;
  return index;
}

function writeTargetsInternal(tokens: readonly TToken[]): boolean {
  for (let root = 0; root < tokens.length; root += 1) {
    const keyword = tokens[root];
    if (keyword.kind !== 'word' || !WRITE_ROOTS.has(keyword.upper)) continue;
    let index = root + 1;
    if (keyword.upper === 'INSERT' || keyword.upper === 'REPLACE') {
      if (tokens[index]?.upper === 'OR') index += 2;
      if (tokens[index]?.upper === 'INTO') index += 1;
      if (qualifiedTargetIsInternal(tokens, index)) return true;
      continue;
    }
    if (keyword.upper === 'UPDATE') {
      if (tokens[index]?.upper === 'OR') index += 2;
      if (qualifiedTargetIsInternal(tokens, index)) return true;
      continue;
    }
    if (keyword.upper === 'DELETE') {
      if (tokens[index]?.upper === 'FROM') index += 1;
      if (qualifiedTargetIsInternal(tokens, index)) return true;
      continue;
    }
    if (keyword.upper === 'ALTER') {
      if (tokens[index]?.upper === 'TABLE') index += 1;
      if (qualifiedTargetIsInternal(tokens, index)) return true;
      continue;
    }
    if (keyword.upper === 'DROP') {
      index = skipWords(
        tokens,
        index,
        new Set(['TABLE', 'INDEX', 'VIEW', 'TRIGGER']),
      );
      if (tokens[index]?.upper === 'IF' && tokens[index + 1]?.upper === 'EXISTS') {
        index += 2;
      }
      if (qualifiedTargetIsInternal(tokens, index)) return true;
      continue;
    }
    if (keyword.upper === 'CREATE') {
      index = skipWords(
        tokens,
        index,
        new Set(['UNIQUE', 'TEMP', 'TEMPORARY', 'TABLE', 'INDEX', 'VIEW', 'TRIGGER']),
      );
      if (
        tokens[index]?.upper === 'IF'
        && tokens[index + 1]?.upper === 'NOT'
        && tokens[index + 2]?.upper === 'EXISTS'
      ) index += 3;
      if (qualifiedTargetIsInternal(tokens, index)) return true;
      for (let nested = index + 1; nested < tokens.length; nested += 1) {
        if (tokens[nested]?.upper === 'ON') {
          if (qualifiedTargetIsInternal(tokens, nested + 1)) return true;
          break;
        }
      }
    }
  }
  return false;
}

function usesTempNamespace(tokens: readonly TToken[], root: TRootClassification): boolean {
  if (
    root.statement === 'create'
    && (tokens[root.rootIndex + 1]?.upper === 'TEMP'
      || tokens[root.rootIndex + 1]?.upper === 'TEMPORARY')
  ) return true;
  return tokens.some((value, index) => (
    (value.kind === 'word' || value.kind === 'quoted')
    && value.text.toLowerCase() === 'temp'
    && tokens[index + 1]?.text === '.'
  ));
}

function isCreateTriggerStatement(tokens: readonly TToken[]): boolean {
  if (tokens[0]?.kind !== 'word' || tokens[0].upper !== 'CREATE') return false;
  let index = 1;
  if (tokens[index]?.upper === 'TEMP' || tokens[index]?.upper === 'TEMPORARY') {
    index += 1;
  }
  return tokens[index]?.kind === 'word' && tokens[index].upper === 'TRIGGER';
}

export function fnClassifyPortableResourceSql(
  sql: string,
): TPortableResourceSqlClassification {
  if (typeof sql !== 'string' || sql.trim().length === 0) {
    return rejection('SQL_EMPTY', 'Portable SQL must not be blank.');
  }
  if (encoder.encode(sql).byteLength > PORTABLE_RESOURCE_SQL_LIMITS.maxUtf8Bytes) {
    return rejection('SQL_LIMIT_EXCEEDED', 'Portable SQL exceeds its byte limit.');
  }
  const tokenized = tokenize(sql);
  if (!tokenized.ok) return rejection(tokenized.code, tokenized.message);
  const tokens = [...tokenized.tokens];
  if (tokens.length === 0) {
    return rejection('SQL_EMPTY', 'Portable SQL must contain a statement.');
  }
  if (isCreateTriggerStatement(tokens)) {
    return rejection(
      'SQL_TRIGGER_FORBIDDEN',
      'Portable SQL may not create database triggers.',
    );
  }
  const semicolons = tokens
    .map((value, index) => value.text === ';' ? index : -1)
    .filter((index) => index >= 0);
  if (
    semicolons.length > 1
    || (semicolons.length === 1 && semicolons[0] !== tokens.length - 1)
  ) {
    return rejection(
      'SQL_MULTIPLE_STATEMENTS',
      'Portable SQL must contain exactly one statement.',
    );
  }
  if (semicolons.length === 1) tokens.pop();
  if (tokens.length === 0) {
    return rejection('SQL_EMPTY', 'Portable SQL must contain a statement.');
  }
  const words = tokens.filter((value) => value.kind === 'word').map((value) => value.upper);
  if (words.some((value) => TRANSACTION_WORDS.has(value))) {
    return rejection(
      'SQL_TRANSACTION_CONTROL',
      'Portable SQL may not control transactions.',
    );
  }
  if (words.some((value) => ATTACHMENT_WORDS.has(value))) {
    return rejection(
      'SQL_ATTACHMENT_FORBIDDEN',
      'Portable SQL may not attach or detach databases.',
    );
  }
  if (words.includes('PRAGMA')) {
    return rejection('SQL_PRAGMA_FORBIDDEN', 'Portable SQL may not use PRAGMA.');
  }
  if (words.includes('VACUUM')) {
    return rejection('SQL_VACUUM_FORBIDDEN', 'Portable SQL may not use VACUUM.');
  }
  if (
    words.some((value) => EXTENSION_WORDS.has(value))
    || callableForbiddenWord(tokens, new Set(['LOAD_EXTENSION', 'FTS3_TOKENIZER']))
  ) {
    return rejection(
      'SQL_EXTENSION_FORBIDDEN',
      'Portable SQL may not load or select native extensions.',
    );
  }
  if (callableForbiddenWord(tokens, HOST_FILE_FUNCTIONS)) {
    return rejection(
      'SQL_HOST_FILE_FORBIDDEN',
      'Portable SQL may not access host files.',
    );
  }
  const root = classifyRoot(tokens, 0, tokens.length);
  if (root === null) {
    return rejection(
      'SQL_UNCLASSIFIED',
      'Portable SQL statement cannot be classified safely.',
    );
  }
  if (usesTempNamespace(tokens, root)) {
    return rejection(
      'SQL_TEMP_OBJECT_FORBIDDEN',
      'Portable SQL may not create or access temporary database objects.',
    );
  }
  if (root.effect === 'write' && writeTargetsInternal(tokens)) {
    return rejection(
      'SQL_INTERNAL_NAMESPACE_WRITE_FORBIDDEN',
      'Portable SQL may not write internal database namespaces.',
    );
  }
  return Object.freeze({
    allowed: true,
    effect: root.effect,
    statement: root.statement,
    hasReturning: words.includes('RETURNING'),
    hasCte: root.hasCte,
  });
}

export function fnValidatePortableResourceSql(args: Readonly<{
  sql: string;
  expectedEffect?: TPortableResourceSqlEffect;
}>): TPortableResourceSqlClassification {
  const classification = fnClassifyPortableResourceSql(args.sql);
  if (
    classification.allowed
    && args.expectedEffect !== undefined
    && classification.effect !== args.expectedEffect
  ) {
    return rejection(
      'SQL_EFFECT_MISMATCH',
      `Portable SQL is ${classification.effect}, not ${args.expectedEffect}.`,
    );
  }
  return classification;
}
