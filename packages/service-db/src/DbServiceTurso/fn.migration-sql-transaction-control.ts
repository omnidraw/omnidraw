type TSqlToken =
  | Readonly<{ kind: 'other' }>
  | Readonly<{ kind: 'semicolon' }>
  | Readonly<{ kind: 'word'; value: string }>;

type TStatementState =
  | 'create'
  | 'create-temp'
  | 'explain'
  | 'explain-query'
  | 'explain-query-plan'
  | 'ordinary'
  | 'start'
  | 'trigger-body'
  | 'trigger-ended'
  | 'trigger-header';

function isSqlWhitespace(character: string): boolean {
  return character === ' '
    || character === '\t'
    || character === '\n'
    || character === '\v'
    || character === '\f'
    || character === '\r'
    || character === '\uFEFF';
}

function isIdentifierStart(character: string): boolean {
  const code = character.charCodeAt(0);
  return character === '_'
    || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || code >= 128;
}

function isIdentifierPart(character: string): boolean {
  const code = character.charCodeAt(0);
  return isIdentifierStart(character)
    || character === '$'
    || (code >= 48 && code <= 57);
}

function skipQuotedToken(sql: string, start: number, delimiter: "'" | '"' | '`'): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] !== delimiter) {
      index += 1;
      continue;
    }
    if (sql[index + 1] === delimiter) {
      index += 2;
      continue;
    }
    return index + 1;
  }
  return index;
}

function tokenizeSql(sql: string): readonly TSqlToken[] {
  const tokens: TSqlToken[] = [];
  let index = 0;

  while (index < sql.length) {
    const character = sql[index] ?? '';
    const next = sql[index + 1] ?? '';

    if (isSqlWhitespace(character)) {
      index += 1;
      continue;
    }
    if (character === '-' && next === '-') {
      index += 2;
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      index += 2;
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) index += 1;
      index = Math.min(index + 2, sql.length);
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      tokens.push({ kind: 'other' });
      index = skipQuotedToken(sql, index, character);
      continue;
    }
    if (character === '[') {
      tokens.push({ kind: 'other' });
      index += 1;
      while (index < sql.length && sql[index] !== ']') index += 1;
      index = Math.min(index + 1, sql.length);
      continue;
    }
    if (character === ';') {
      tokens.push({ kind: 'semicolon' });
      index += 1;
      continue;
    }
    if (isIdentifierStart(character)) {
      const start = index;
      index += 1;
      while (index < sql.length && isIdentifierPart(sql[index] ?? '')) index += 1;
      tokens.push({ kind: 'word', value: sql.slice(start, index).toUpperCase() });
      continue;
    }

    tokens.push({ kind: 'other' });
    index += 1;
  }

  return tokens;
}

function transactionControlKeyword(word: string): string | null {
  if (
    word === 'BEGIN'
    || word === 'COMMIT'
    || word === 'END'
    || word === 'ROLLBACK'
    || word === 'SAVEPOINT'
    || word === 'RELEASE'
  ) return word;
  return null;
}

function fnFindTopLevelMigrationTransactionControl(sql: string): string | null {
  let state: TStatementState = 'start';
  let triggerCaseDepth = 0;
  let triggerStatementStart = false;

  for (const token of tokenizeSql(sql)) {
    if (state === 'ordinary') {
      if (token.kind === 'semicolon') state = 'start';
      continue;
    }

    if (state === 'trigger-header') {
      if (token.kind === 'semicolon') {
        state = 'start';
      } else if (token.kind === 'word' && token.value === 'BEGIN') {
        state = 'trigger-body';
        triggerCaseDepth = 0;
        triggerStatementStart = true;
      }
      continue;
    }

    if (state === 'trigger-body') {
      if (token.kind === 'semicolon') {
        triggerStatementStart = true;
      } else if (token.kind === 'word' && token.value === 'CASE') {
        triggerCaseDepth += 1;
        triggerStatementStart = false;
      } else if (token.kind === 'word' && token.value === 'END') {
        if (triggerCaseDepth > 0) {
          triggerCaseDepth -= 1;
          triggerStatementStart = false;
        } else if (triggerStatementStart) {
          state = 'trigger-ended';
        } else {
          triggerStatementStart = false;
        }
      } else {
        triggerStatementStart = false;
      }
      continue;
    }

    if (state === 'trigger-ended') {
      state = token.kind === 'semicolon' ? 'start' : 'ordinary';
      continue;
    }

    if (token.kind === 'semicolon') {
      state = 'start';
      continue;
    }

    if (state === 'start') {
      if (token.kind !== 'word') {
        state = 'ordinary';
        continue;
      }
      const forbidden = transactionControlKeyword(token.value);
      if (forbidden) return forbidden;
      if (token.value === 'EXPLAIN') state = 'explain';
      else if (token.value === 'CREATE') state = 'create';
      else state = 'ordinary';
      continue;
    }

    if (state === 'explain') {
      if (token.kind !== 'word') {
        state = 'ordinary';
        continue;
      }
      const forbidden = transactionControlKeyword(token.value);
      if (forbidden) return forbidden;
      state = token.value === 'QUERY' ? 'explain-query' : 'ordinary';
      continue;
    }

    if (state === 'explain-query') {
      state = token.kind === 'word' && token.value === 'PLAN'
        ? 'explain-query-plan'
        : 'ordinary';
      continue;
    }

    if (state === 'explain-query-plan') {
      if (token.kind === 'word') {
        const forbidden = transactionControlKeyword(token.value);
        if (forbidden) return forbidden;
      }
      state = 'ordinary';
      continue;
    }

    if (state === 'create') {
      if (token.kind !== 'word') {
        state = 'ordinary';
      } else if (token.value === 'TRIGGER') {
        state = 'trigger-header';
      } else if (token.value === 'TEMP' || token.value === 'TEMPORARY') {
        state = 'create-temp';
      } else {
        state = 'ordinary';
      }
      continue;
    }

    state = token.kind === 'word' && token.value === 'TRIGGER'
      ? 'trigger-header'
      : 'ordinary';
  }

  return null;
}

export { fnFindTopLevelMigrationTransactionControl };
