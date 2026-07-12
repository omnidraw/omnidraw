import type { DbServiceTurso } from '@vibecanvas/service-db/DbServiceTurso/DbServiceTurso';
import { Database } from '@vibecanvas/service-db/DbServiceTurso/turso-native';
import type {
  TActorResource,
  TDbResourceConfiguration,
  TDbResourceSchemaMigration,
  TJson,
} from '@vibecanvas/service-db/model';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { ActorResourceError, toActorResourceError } from './ActorResourceError';
import type { TActorDbResourceRequirement, TActorResourceRequirement } from '../core/types';
import type {
  IActorResourceProvider,
  TActorResolvedResourceCall,
  TActorResourceProviderCreateArgs,
} from './resource-types';

const RESOURCE_ID_MAX_LENGTH = 128;
const OPERATION_NAME_MAX_LENGTH = 128;
const ACTOR_SQL_MAX_LENGTH = 65_536;
const MIGRATION_SQL_MAX_LENGTH = 1_048_576;
const MIGRATION_MAX_COUNT = 256;
const MIGRATION_STATEMENT_MAX_COUNT = 256;
const PARAMETER_MAX_COUNT = 128;
const PARAMETER_BYTES_MAX = 1_048_576;
const RESULT_ROW_MAX_COUNT = 1_000;
const RESULT_COLUMN_MAX_COUNT = 128;
const RESULT_BYTES_MAX = 4_194_304;
const QUERY_TIMEOUT_MS = 5_000;

const MIGRATION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS \`_vibecanvas_migrations\` (
  \`schema_id\` TEXT NOT NULL,
  \`version\` INTEGER NOT NULL CHECK (\`version\` >= 1),
  \`name\` TEXT NOT NULL,
  \`checksum\` TEXT NOT NULL,
  \`applied_at\` TIMESTAMP NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (\`schema_id\`, \`version\`)
) STRICT;
`;

const RESOURCE_PRAGMAS_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = FULL;
PRAGMA temp_store = 2;
`;

type TDatabaseFactory = (
  databasePath: string,
  options: ConstructorParameters<typeof Database>[1],
) => Database;

export type TDbResourceConfig = {
  readonly db: DbServiceTurso;
  readonly dataRoot: string;
  readonly databaseFactory?: TDatabaseFactory;
};

type TDbBindValue = null | string | number | bigint | Uint8Array;
type TDbBindParameters = Record<string, TDbBindValue>;

function validateResourceId(id: string): string {
  if (
    typeof id !== 'string'
    || id.length === 0
    || id.length > RESOURCE_ID_MAX_LENGTH
    || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)
  ) {
    throw new ActorResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource has an invalid host identity.');
  }
  return id;
}

function recordArgs(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ActorResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database operation arguments must be an object.');
  }
  return value as Record<string, unknown>;
}

function operationName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > OPERATION_NAME_MAX_LENGTH) {
    throw new ActorResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Named database operation has an invalid name.');
  }
  return value;
}

function boundedSql(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > ACTOR_SQL_MAX_LENGTH) {
    throw new ActorResourceError(
      'DB_OPERATION_PARAMETERS_INVALID',
      `Database SQL must be non-blank and no longer than ${ACTOR_SQL_MAX_LENGTH} characters.`,
    );
  }
  const summary = sqlLexicalSummary(value);
  if (summary.statementCount !== 1) {
    throw new ActorResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Arbitrary database calls require exactly one SQL statement.');
  }
  if (hasHostPathSql(summary.tokens)) {
    throw new ActorResourceError('DB_ARBITRARY_SQL_NOT_ALLOWED', 'Database SQL may not control host files or load extensions.');
  }
  return value;
}

type TSqlLexicalSummary = {
  readonly statementCount: number;
  readonly tokens: string[];
};

function sqlLexicalSummary(sql: string): TSqlLexicalSummary {
  const tokens: string[] = [];
  let token = '';
  let statementCount = 0;
  let hasStatementContent = false;
  let mode: 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'lineComment' | 'blockComment' = 'normal';

  const finishToken = () => {
    if (token.length > 0) tokens.push(token.toUpperCase());
    token = '';
  };

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (mode === 'lineComment') {
      if (char === '\n' || char === '\r') mode = 'normal';
      continue;
    }
    if (mode === 'blockComment') {
      if (char === '*' && next === '/') {
        mode = 'normal';
        index += 1;
      }
      continue;
    }
    if (mode === 'single' || mode === 'double' || mode === 'backtick') {
      const closing = mode === 'single' ? "'" : mode === 'double' ? '"' : '`';
      if (char === closing) {
        if (next === closing) {
          index += 1;
        } else {
          mode = 'normal';
        }
      }
      continue;
    }
    if (mode === 'bracket') {
      if (char === ']') mode = 'normal';
      continue;
    }

    if (char === '-' && next === '-') {
      finishToken();
      mode = 'lineComment';
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      finishToken();
      mode = 'blockComment';
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      finishToken();
      hasStatementContent = true;
      mode = char === "'" ? 'single' : char === '"' ? 'double' : char === '`' ? 'backtick' : 'bracket';
      continue;
    }
    if (char === ';') {
      finishToken();
      if (hasStatementContent) statementCount += 1;
      hasStatementContent = false;
      continue;
    }
    if (/[A-Za-z_]/.test(char) || (token.length > 0 && /[0-9]/.test(char))) {
      token += char;
      hasStatementContent = true;
      continue;
    }
    finishToken();
    if (!/\s/.test(char)) hasStatementContent = true;
  }

  finishToken();
  if (hasStatementContent) statementCount += 1;
  return { statementCount, tokens };
}

function hasHostPathSql(tokens: readonly string[]): boolean {
  if (tokens.some((token) => (
    token === 'ATTACH'
    || token === 'DETACH'
    || token === 'LOAD_EXTENSION'
    || token === 'READFILE'
    || token === 'WRITEFILE'
    || token === 'TEMP_STORE_DIRECTORY'
    || token === 'DATA_STORE_DIRECTORY'
  ))) return true;
  const vacuumIndex = tokens.indexOf('VACUUM');
  return vacuumIndex !== -1 && tokens.slice(vacuumIndex + 1).includes('INTO');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, seen))
    : isPlainObject(value) && Object.values(value).every((item) => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

function jsonParameter(value: unknown): string {
  if (!isJsonValue(value)) {
    throw new ActorResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database JSON parameter is invalid.');
  }
  return JSON.stringify(value);
}

function parameterBytes(value: TDbBindValue): number {
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (value instanceof Uint8Array) return value.byteLength;
  if (typeof value === 'bigint') return value.toString().length;
  return 8;
}

function convertArbitraryParameter(value: unknown): TDbBindValue {
  if (value === null || typeof value === 'bigint') return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) || isPlainObject(value)) return jsonParameter(value);
  throw new ActorResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database parameter has an unsupported value.');
}

function parameterRecord(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    throw new ActorResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database parameters must be an object.');
  }
  const entries = Object.entries(value);
  if (entries.length > PARAMETER_MAX_COUNT) {
    throw new ActorResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database operation has too many parameters.');
  }
  return value;
}

function boundArbitraryParameters(value: unknown): TDbBindParameters {
  const raw = parameterRecord(value);
  const bound: TDbBindParameters = {};
  let bytes = 0;
  for (const [name, parameter] of Object.entries(raw)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name.length > 128) {
      throw new ActorResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database parameter has an invalid name.');
    }
    const converted = convertArbitraryParameter(parameter);
    bytes += Buffer.byteLength(name) + parameterBytes(converted);
    if (bytes > PARAMETER_BYTES_MAX) {
      throw new ActorResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database parameters exceed the size limit.');
    }
    bound[name] = converted;
  }
  return bound;
}

function boundNamedParameters(
  requirement: TActorDbResourceRequirement,
  name: string,
  value: unknown,
): TDbBindParameters {
  const operation = requirement.operations?.[name];
  if (!operation) {
    throw new ActorResourceError('DB_NAMED_OPERATION_UNKNOWN', `Named database operation "${name}" is not declared.`);
  }
  const declarations = operation.parameters ?? {};
  const raw = parameterRecord(value);
  for (const key of Object.keys(raw)) {
    if (!(key in declarations)) {
      throw new ActorResourceError('DB_OPERATION_PARAMETERS_INVALID', `Unknown parameter "${key}" for database operation "${name}".`);
    }
  }

  const bound: TDbBindParameters = {};
  let bytes = 0;
  for (const [parameterName, declaration] of Object.entries(declarations)) {
    const present = Object.prototype.hasOwnProperty.call(raw, parameterName) && raw[parameterName] !== undefined;
    if (!present) {
      if (declaration.required !== false) {
        throw new ActorResourceError('DB_OPERATION_PARAMETERS_INVALID', `Required parameter "${parameterName}" is missing.`);
      }
      continue;
    }
    const parameter = raw[parameterName];
    let converted: TDbBindValue;
    if (parameter === null) {
      if (declaration.nullable !== true) {
        throw new ActorResourceError('DB_OPERATION_PARAMETERS_INVALID', `Parameter "${parameterName}" cannot be null.`);
      }
      converted = null;
    } else if (declaration.type === 'string' && typeof parameter === 'string') {
      converted = parameter;
    } else if (declaration.type === 'number' && typeof parameter === 'number' && Number.isFinite(parameter)) {
      converted = parameter;
    } else if (declaration.type === 'boolean' && typeof parameter === 'boolean') {
      converted = parameter ? 1 : 0;
    } else if (declaration.type === 'bigint' && typeof parameter === 'bigint') {
      converted = parameter;
    } else if (declaration.type === 'bytes' && parameter instanceof Uint8Array) {
      converted = parameter;
    } else if (declaration.type === 'json' && isJsonValue(parameter)) {
      converted = jsonParameter(parameter);
    } else {
      throw new ActorResourceError(
        'DB_OPERATION_PARAMETERS_INVALID',
        `Parameter "${parameterName}" must have type ${declaration.type}.`,
      );
    }
    bytes += Buffer.byteLength(parameterName) + parameterBytes(converted);
    if (bytes > PARAMETER_BYTES_MAX) {
      throw new ActorResourceError('DB_OPERATION_PARAMETERS_INVALID', 'Database parameters exceed the size limit.');
    }
    // Turso's named binder accepts unprefixed keys for :name, $name, and @name.
    bound[parameterName] = converted;
  }
  return bound;
}

function checksum(sql: string): string {
  return `sha256:${createHash('sha256').update(sql, 'utf8').digest('hex')}`;
}

function assertPublishedMigrations(
  migrations: readonly TDbResourceSchemaMigration[],
  firstVersion: number,
  targetVersion: number,
): void {
  if (migrations.length > MIGRATION_MAX_COUNT) {
    throw new ActorResourceError('DB_RESOURCE_MIGRATION_FAILED', 'DbResource migration count exceeds the host limit.');
  }
  let expectedVersion = firstVersion;
  for (const migration of migrations) {
    const sqlSummary = sqlLexicalSummary(migration.sql);
    if (
      migration.status !== 'published'
      || migration.version !== expectedVersion
      || migration.sql.length > MIGRATION_SQL_MAX_LENGTH
      || sqlSummary.statementCount < 1
      || sqlSummary.statementCount > MIGRATION_STATEMENT_MAX_COUNT
      || hasHostPathSql(sqlSummary.tokens)
    ) {
      throw new ActorResourceError('DB_RESOURCE_MIGRATION_FAILED', 'DbResource published migration sequence is invalid.');
    }
    if (checksum(migration.sql) !== migration.checksum) {
      throw new ActorResourceError('DB_RESOURCE_MIGRATION_CHANGED', 'A published DbResource migration checksum does not match its SQL.');
    }
    expectedVersion += 1;
  }
  if (expectedVersion - 1 !== targetVersion) {
    throw new ActorResourceError('DB_RESOURCE_MIGRATION_FAILED', 'DbResource published migrations are incomplete.');
  }
}

function normalizeRow(raw: unknown): Record<string, null | string | number | bigint | Uint8Array> {
  if (!isPlainObject(raw)) {
    throw new ActorResourceError('DB_QUERY_FAILED', 'Database returned an invalid row.');
  }
  const entries = Object.entries(raw);
  if (entries.length > RESULT_COLUMN_MAX_COUNT) {
    throw new ActorResourceError('DB_RESULT_LIMIT_EXCEEDED', 'Database result has too many columns.');
  }
  const row: Record<string, null | string | number | bigint | Uint8Array> = {};
  for (const [column, value] of entries) {
    if (
      value === null
      || typeof value === 'string'
      || typeof value === 'bigint'
      || (typeof value === 'number' && Number.isFinite(value))
      || value instanceof Uint8Array
    ) {
      row[column] = value;
      continue;
    }
    if (value instanceof ArrayBuffer) {
      row[column] = new Uint8Array(value);
      continue;
    }
    throw new ActorResourceError('DB_QUERY_FAILED', 'Database returned an unsupported value type.');
  }
  return row;
}

function rowBytes(row: Record<string, null | string | number | bigint | Uint8Array>): number {
  let bytes = 0;
  for (const [key, value] of Object.entries(row)) {
    bytes += Buffer.byteLength(key) + parameterBytes(value);
  }
  return bytes;
}

export class DbResource implements IActorResourceProvider {
  readonly kind = 'db' as const;
  readonly #db: DbServiceTurso;
  readonly #dataRoot: string;
  readonly #databaseFactory: TDatabaseFactory;
  readonly #handles = new Map<string, Promise<Database>>();
  readonly #writeTails = new Map<string, Promise<void>>();
  readonly #inflight = new Map<string, Set<Promise<unknown>>>();
  readonly #blocked = new Set<string>();
  #closed = false;

  constructor(config: TDbResourceConfig) {
    this.#db = config.db;
    this.#dataRoot = config.dataRoot;
    this.#databaseFactory = config.databaseFactory ?? ((databasePath, options) => new Database(databasePath, options));
  }

  async provision(
    resource: TActorResource,
    args: TActorResourceProviderCreateArgs,
  ): Promise<void> {
    this.#assertAvailable();
    if (resource.kind !== 'db' || !args.db) {
      throw new ActorResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource provisioning requires a schema and version.');
    }
    const resourceId = validateResourceId(resource.id);
    const { schemaId, version } = args.db;
    if (!Number.isInteger(version) || version < 0) {
      throw new ActorResourceError('DB_RESOURCE_VERSION_MISMATCH', 'DbResource version must be a non-negative integer.');
    }
    const schema = await this.#db.dbResource.schema.get({ id: schemaId });
    if (!schema || schema.status !== 'published') {
      throw new ActorResourceError('DB_RESOURCE_SCHEMA_MISMATCH', 'DbResource schema must be published before provisioning.');
    }
    const migrations = version === 0
      ? []
      : await this.#db.dbResource.migration.list({ schemaId, status: 'published', throughVersion: version });
    assertPublishedMigrations(migrations, 1, version);

    const configuration = await this.#db.dbResource.configuration.create({
      resourceId,
      schemaId,
      appliedVersion: 0,
      targetVersion: version,
    });

    const directory = this.#resourceDirectory(resourceId);
    let directoryCreated = false;
    try {
      await mkdir(join(this.#dataRoot, 'actor-resources', 'db'), { recursive: true });
      await mkdir(directory);
      directoryCreated = true;
      const database = await this.#open(resourceId, false);
      await database.exec(MIGRATION_TABLE_SQL);
      if (migrations.length > 0) {
        await this.#serializeWrite(resourceId, () => this.#applyMigrations(database, migrations));
      }
      await this.#closeHandle(resourceId);
      await this.#verifyDatabaseFile(this.#databasePath(resourceId), {
        ...configuration,
        applied_version: version,
        target_version: version,
      });
      await this.#db.dbResource.configuration.setVersions({
        resourceId,
        appliedVersion: version,
        targetVersion: version,
      });
    } catch (error) {
      await this.#closeHandle(resourceId).catch(() => undefined);
      if (directoryCreated) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw toActorResourceError(error, 'DB_RESOURCE_UNAVAILABLE', 'DbResource provisioning failed.');
    }
  }

  async delete(resource: TActorResource): Promise<void> {
    const resourceId = validateResourceId(resource.id);
    this.#blocked.add(resourceId);
    try {
      await this.#drain(resourceId);
      await this.#writeTails.get(resourceId);
      await this.#closeHandle(resourceId);
      await rm(this.#resourceDirectory(resourceId), { recursive: true, force: true });
    } catch (error) {
      throw toActorResourceError(error, 'DB_RESOURCE_DELETE_FAILED', 'DbResource physical deletion failed.');
    } finally {
      this.#blocked.delete(resourceId);
    }
  }

  effect(
    operation: string,
    requirement: TActorResourceRequirement,
    rawArgs: unknown,
  ): 'read' | 'write' | null {
    if (requirement.kind !== 'db') return null;
    if (operation === 'query') return 'read';
    if (operation === 'execute') return 'write';
    if (operation !== 'invoke') return null;
    const args = recordArgs(rawArgs);
    const name = operationName(args.operation);
    const named = requirement.operations?.[name];
    if (named) return named.effect;
    return requirement.scope.includes('read') ? 'read' : 'write';
  }

  async dispatch(
    context: TActorResolvedResourceCall,
    operation: string,
    rawArgs: unknown,
  ): Promise<unknown> {
    const resourceId = validateResourceId(context.resource.id);
    this.#assertAvailable(resourceId);
    const requirement = context.requirement;
    if (requirement.kind !== 'db') {
      throw new ActorResourceError('DB_RESOURCE_UNAVAILABLE', 'Bound resource is not a DbResource.');
    }
    const call = this.#dispatchDb(context, requirement, operation, rawArgs);
    return this.#track(resourceId, call);
  }

  async compatibility(requirement: TActorResourceRequirement, resource: TActorResource) {
    if (requirement.kind !== 'db' || resource.kind !== 'db') {
      return { compatible: false, code: 'DB_RESOURCE_SCHEMA_MISMATCH', message: 'Resource kind does not match the database slot.' };
    }
    const configuration = await this.#db.dbResource.configuration.get({ resourceId: resource.id });
    if (!configuration) {
      return { compatible: false, code: 'DB_RESOURCE_UNAVAILABLE', message: 'DbResource configuration is unavailable.' };
    }
    const common = {
      actualSchemaId: configuration.schema_id,
      actualVersion: configuration.applied_version,
      targetVersion: configuration.target_version,
    };
    if (configuration.schema_id !== requirement.schema.id) {
      return {
        compatible: false,
        code: 'DB_RESOURCE_SCHEMA_MISMATCH',
        message: `DbResource "${resource.name}" provides ${configuration.schema_id}@${configuration.applied_version}, but the widget expects ${requirement.schema.id}@${requirement.schema.version}. Update and republish the widget definition before restarting its actors.`,
        ...common,
      };
    }
    if (
      configuration.applied_version !== requirement.schema.version
      || configuration.target_version !== configuration.applied_version
    ) {
      return {
        compatible: false,
        code: 'DB_RESOURCE_VERSION_MISMATCH',
        message: `DbResource "${resource.name}" is at ${configuration.schema_id}@${configuration.applied_version}, but the widget expects ${requirement.schema.id}@${requirement.schema.version}. Update and republish the widget definition before restarting its actors.`,
        ...common,
      };
    }
    return { compatible: true, ...common };
  }

  async migrate(resourceIdValue: string, targetVersion: number): Promise<TDbResourceConfiguration> {
    const resourceId = validateResourceId(resourceIdValue);
    this.#assertAvailable(resourceId);
    this.#blocked.add(resourceId);
    const backupPath = `${this.#databasePath(resourceId)}.pre-migration`;
    let backupReady = false;
    let migrationApplied = false;
    let originalVerified = false;
    let recoveryNeeded = false;
    let configuration: TDbResourceConfiguration | null = null;
    try {
      if (!Number.isInteger(targetVersion) || targetVersion < 1) {
        throw new ActorResourceError('DB_RESOURCE_VERSION_MISMATCH', 'Migration target must be a positive integer.');
      }
      const currentConfiguration = await this.#requireConfiguration(resourceId);
      configuration = currentConfiguration;
      if (targetVersion <= currentConfiguration.applied_version) {
        throw new ActorResourceError('DB_RESOURCE_VERSION_MISMATCH', 'DbResource migrations must move forward.');
      }
      const migrations = await this.#db.dbResource.migration.list({
        schemaId: currentConfiguration.schema_id,
        status: 'published',
        throughVersion: targetVersion,
      });
      const pending = migrations.filter((migration) => migration.version > currentConfiguration.applied_version);
      assertPublishedMigrations(pending, currentConfiguration.applied_version + 1, targetVersion);
      await this.#db.dbResource.configuration.setTargetVersion({ resourceId, targetVersion });
      recoveryNeeded = true;
      await this.#drain(resourceId);
      await this.#serializeWrite(resourceId, async () => {
        const database = await this.#open(resourceId, true);
        await this.#verifyPhysicalHistory(database, currentConfiguration);
        originalVerified = true;
        await database.exec('PRAGMA wal_checkpoint(TRUNCATE);', { queryTimeout: QUERY_TIMEOUT_MS });
        await this.#closeHandle(resourceId);
        await this.#copyDatabaseFiles(this.#databasePath(resourceId), backupPath);
        await this.#verifyDatabaseFile(backupPath, currentConfiguration);
        backupReady = true;
        const migrationDatabase = await this.#open(resourceId, true);
        await this.#applyMigrations(migrationDatabase, pending);
        await this.#verifyPhysicalHistory(migrationDatabase, {
          ...currentConfiguration,
          applied_version: targetVersion,
          target_version: targetVersion,
        });
        await this.#closeHandle(resourceId);
        await this.#verifyDatabaseFile(this.#databasePath(resourceId), {
          ...currentConfiguration,
          applied_version: targetVersion,
          target_version: targetVersion,
        });
        migrationApplied = true;
      });
      const updated = await this.#db.dbResource.configuration.setVersions({
        resourceId,
        appliedVersion: targetVersion,
        targetVersion,
      });
      return updated;
    } catch (error) {
      if (!recoveryNeeded) throw error;
      let restored = originalVerified && !migrationApplied;
      if (backupReady && configuration) {
        try {
          await this.#closeHandle(resourceId).catch(() => undefined);
          await this.#verifyDatabaseFile(backupPath, configuration);
          await this.#copyDatabaseFiles(backupPath, this.#databasePath(resourceId));
          await this.#verifyDatabaseFile(this.#databasePath(resourceId), configuration);
          restored = true;
          await this.#removeDatabaseFiles(backupPath);
        } catch {
          restored = false;
        }
      }
      if (restored && configuration) {
        try {
          await this.#db.dbResource.configuration.setVersions({
            resourceId,
            appliedVersion: configuration.applied_version,
            targetVersion: configuration.applied_version,
          });
        } catch {
          throw new ActorResourceError('DB_RESOURCE_RECOVERY_FAILED', 'DbResource data was restored but its control state could not be reconciled.');
        }
        throw toActorResourceError(error, 'DB_RESOURCE_MIGRATION_FAILED', 'DbResource migration failed.');
      }
      throw new ActorResourceError('DB_RESOURCE_RECOVERY_FAILED', 'DbResource migration failed and the previous database could not be restored.');
    } finally {
      this.#blocked.delete(resourceId);
    }
  }

  async commitMigration(resourceIdValue: string): Promise<void> {
    const resourceId = validateResourceId(resourceIdValue);
    await this.#removeDatabaseFiles(`${this.#databasePath(resourceId)}.pre-migration`).catch(() => undefined);
  }

  async restoreMigration(
    resourceIdValue: string,
    configuration: TDbResourceConfiguration,
  ): Promise<TDbResourceConfiguration> {
    const resourceId = validateResourceId(resourceIdValue);
    this.#assertAvailable(resourceId);
    this.#blocked.add(resourceId);
    try {
      await this.#drain(resourceId);
      await this.#writeTails.get(resourceId);
      await this.#closeHandle(resourceId).catch(() => undefined);
      const backupPath = `${this.#databasePath(resourceId)}.pre-migration`;
      await this.#verifyDatabaseFile(backupPath, configuration);
      await this.#copyDatabaseFiles(backupPath, this.#databasePath(resourceId));
      await this.#verifyDatabaseFile(this.#databasePath(resourceId), configuration);
      const restored = await this.#db.dbResource.configuration.setVersions({
        resourceId,
        appliedVersion: configuration.applied_version,
        targetVersion: configuration.applied_version,
      });
      await this.#removeDatabaseFiles(backupPath);
      return restored;
    } catch {
      throw new ActorResourceError('DB_RESOURCE_RECOVERY_FAILED', 'DbResource could not restore its retained pre-migration snapshot.');
    } finally {
      this.#blocked.delete(resourceId);
    }
  }

  async reconcile(resource: TActorResource) {
    if (resource.kind !== this.kind) {
      return {
        status: 'error' as const,
        lastError: { code: 'DB_RESOURCE_SCHEMA_MISMATCH', message: 'DbResource catalog kind is invalid.' },
      };
    }
    const resourceId = validateResourceId(resource.id);
    const configuration = await this.#db.dbResource.configuration.get({ resourceId });
    if (!configuration) {
      return {
        status: 'error' as const,
        lastError: { code: 'DB_RESOURCE_RECOVERY_FAILED', message: 'DbResource configuration is missing.' },
      };
    }

    this.#assertAvailable(resourceId);
    this.#blocked.add(resourceId);
    try {
      await this.#closeHandle(resourceId).catch(() => undefined);
      const databasePath = this.#databasePath(resourceId);
      const backupPath = `${databasePath}.pre-migration`;
      const appliedConfiguration = {
        ...configuration,
        target_version: configuration.applied_version,
      };
      if (await this.#canVerifyDatabaseFile(databasePath, appliedConfiguration)) {
        if (configuration.target_version !== configuration.applied_version) {
          await this.#db.dbResource.configuration.setVersions({
              resourceId,
              appliedVersion: configuration.applied_version,
              targetVersion: configuration.applied_version,
            });
        }
        await this.#removeDatabaseFiles(backupPath);
        return { status: 'ready' as const };
      }

      if (configuration.target_version > configuration.applied_version) {
        const targetConfiguration = {
          ...configuration,
          applied_version: configuration.target_version,
        };
        if (await this.#canVerifyDatabaseFile(databasePath, targetConfiguration)) {
          await this.#db.dbResource.configuration.setVersions({
            resourceId,
            appliedVersion: configuration.target_version,
            targetVersion: configuration.target_version,
          });
          await this.#removeDatabaseFiles(backupPath);
          return { status: 'ready' as const };
        }
      }

      if (await this.#canVerifyDatabaseFile(backupPath, appliedConfiguration)) {
        await this.#copyDatabaseFiles(backupPath, databasePath);
        await this.#verifyDatabaseFile(databasePath, appliedConfiguration);
        await this.#db.dbResource.configuration.setVersions({
          resourceId,
          appliedVersion: configuration.applied_version,
          targetVersion: configuration.applied_version,
        });
        await this.#removeDatabaseFiles(backupPath);
        return { status: 'ready' as const };
      }
    } catch {
      // Persist one stable recovery state below; native errors and paths stay host-local.
    } finally {
      this.#blocked.delete(resourceId);
    }

    return {
      status: 'error' as const,
      lastError: {
        code: 'DB_RESOURCE_RECOVERY_FAILED',
        message: 'DbResource physical state could not be reconciled safely.',
      },
    };
  }

  async close(): Promise<void> {
    this.#closed = true;
    await Promise.all([...this.#inflight.keys()].map((resourceId) => this.#drain(resourceId)));
    await Promise.allSettled([...this.#writeTails.values()]);
    const ids = [...this.#handles.keys()];
    await Promise.allSettled(ids.map((resourceId) => this.#closeHandle(resourceId)));
  }

  async #dispatchDb(
    context: TActorResolvedResourceCall,
    requirement: TActorDbResourceRequirement,
    operation: string,
    rawArgs: unknown,
  ): Promise<unknown> {
    try {
      const args = recordArgs(rawArgs);
      if (operation === 'invoke') {
        const name = operationName(args.operation);
        const named = requirement.operations?.[name];
        if (!named) {
          throw new ActorResourceError('DB_NAMED_OPERATION_UNKNOWN', `Named database operation "${name}" is not declared.`);
        }
        if (named.effect === 'read' && !context.canRead) {
          throw new ActorResourceError('DB_READ_NOT_ALLOWED', 'Read access is not allowed for this DbResource slot.');
        }
        if (named.effect === 'write' && !context.canWrite) {
          throw new ActorResourceError('DB_WRITE_NOT_ALLOWED', 'Write access is not allowed for this DbResource slot.');
        }
        const parameters = boundNamedParameters(requirement, name, args.parameters);
        const sql = boundedSql(named.sql);
        const invoke = async () => named.result === 'rows'
          ? this.#query(context.resource.id, sql, parameters)
          : this.#execute(context.resource.id, sql, parameters);
        return named.effect === 'write'
          ? this.#serializeWrite(context.resource.id, invoke)
          : invoke();
      }
      if (operation === 'query') {
        if (requirement.arbitrarySql !== true) {
          throw new ActorResourceError('DB_ARBITRARY_SQL_NOT_ALLOWED', 'Arbitrary SQL is not enabled for this DbResource slot.');
        }
        if (!context.canRead) throw new ActorResourceError('DB_READ_NOT_ALLOWED', 'Read access is not allowed for this DbResource slot.');
        return this.#query(context.resource.id, boundedSql(args.sql), boundArbitraryParameters(args.parameters));
      }
      if (operation === 'execute') {
        if (requirement.arbitrarySql !== true) {
          throw new ActorResourceError('DB_ARBITRARY_SQL_NOT_ALLOWED', 'Arbitrary SQL is not enabled for this DbResource slot.');
        }
        if (!context.canWrite) throw new ActorResourceError('DB_WRITE_NOT_ALLOWED', 'Write access is not allowed for this DbResource slot.');
        return this.#serializeWrite(
          context.resource.id,
          () => this.#execute(context.resource.id, boundedSql(args.sql), boundArbitraryParameters(args.parameters)),
        );
      }
      throw new ActorResourceError('DB_RESOURCE_UNAVAILABLE', `Unknown DbResource operation "${operation}".`);
    } catch (error) {
      if (error instanceof ActorResourceError) throw error;
      throw new ActorResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource operation failed.');
    }
  }

  async #query(resourceId: string, sql: string, parameters: TDbBindParameters) {
    try {
      const database = await this.#open(resourceId, true);
      const statement = await database.prepare(sql);
      statement.safeIntegers(true);
      try {
        if (!statement.reader) {
          throw new ActorResourceError('DB_READ_NOT_ALLOWED', 'Database query operation requires a row-producing statement.');
        }
        const rows: Record<string, null | string | number | bigint | Uint8Array>[] = [];
        let bytes = 0;
        for await (const raw of statement.iterate(parameters, { queryTimeout: QUERY_TIMEOUT_MS })) {
          if (rows.length >= RESULT_ROW_MAX_COUNT) {
            throw new ActorResourceError('DB_RESULT_LIMIT_EXCEEDED', 'Database result has too many rows.');
          }
          const row = normalizeRow(raw);
          bytes += rowBytes(row);
          if (bytes > RESULT_BYTES_MAX) {
            throw new ActorResourceError('DB_RESULT_LIMIT_EXCEEDED', 'Database result exceeds the size limit.');
          }
          rows.push(row);
        }
        return rows;
      } finally {
        statement.close();
      }
    } catch (error) {
      if (error instanceof ActorResourceError) throw error;
      throw new ActorResourceError('DB_QUERY_FAILED', 'Database query failed.');
    }
  }

  async #execute(resourceId: string, sql: string, parameters: TDbBindParameters) {
    try {
      const database = await this.#open(resourceId, true);
      const statement = await database.prepare(sql);
      statement.safeIntegers(true);
      try {
        const result = await statement.run(parameters, { queryTimeout: QUERY_TIMEOUT_MS });
        const rowId = result.lastInsertRowid as number | bigint;
        return {
          rowsAffected: result.changes,
          ...(typeof rowId === 'bigint'
            ? { lastInsertRowId: rowId }
            : Number.isSafeInteger(rowId) ? { lastInsertRowId: BigInt(rowId) } : {}),
        };
      } finally {
        statement.close();
      }
    } catch {
      throw new ActorResourceError('DB_EXECUTE_FAILED', 'Database execute failed.');
    }
  }

  async #applyMigrations(database: Database, migrations: readonly TDbResourceSchemaMigration[]): Promise<void> {
    if (migrations.length === 0) return;
    const apply = database.transaction(async () => {
      for (const migration of migrations) {
        await database.exec(migration.sql, { queryTimeout: QUERY_TIMEOUT_MS });
        await database.run(
          `INSERT INTO \`_vibecanvas_migrations\` (schema_id, version, name, checksum) VALUES (?, ?, ?, ?)`,
          migration.schema_id,
          migration.version,
          migration.name,
          migration.checksum,
          { queryTimeout: QUERY_TIMEOUT_MS },
        );
      }
    });
    try {
      await apply();
    } catch {
      throw new ActorResourceError('DB_RESOURCE_MIGRATION_FAILED', 'DbResource migration SQL failed.');
    }
  }

  async #verifyPhysicalHistory(database: Database, configuration: TDbResourceConfiguration): Promise<void> {
    const rows = await database.all(
      `SELECT schema_id, version, name, checksum FROM \`_vibecanvas_migrations\` ORDER BY version ASC`,
      { queryTimeout: QUERY_TIMEOUT_MS },
    ) as Array<{ schema_id: unknown; version: unknown; name: unknown; checksum: unknown }>;
    if (rows.length !== configuration.applied_version) {
      throw new ActorResourceError('DB_RESOURCE_MIGRATION_CHANGED', 'DbResource physical migration history does not match its configuration.');
    }
    const published = configuration.applied_version === 0 ? [] : await this.#db.dbResource.migration.list({
      schemaId: configuration.schema_id,
      status: 'published',
      throughVersion: configuration.applied_version,
    });
    assertPublishedMigrations(published, 1, configuration.applied_version);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const migration = published[index];
      if (
        row.schema_id !== configuration.schema_id
        || Number(row.version) !== migration.version
        || row.name !== migration.name
        || row.checksum !== migration.checksum
      ) {
        throw new ActorResourceError('DB_RESOURCE_MIGRATION_CHANGED', 'DbResource physical migration history was changed.');
      }
    }
  }

  async #verifyDatabaseFile(databasePath: string, configuration: TDbResourceConfiguration): Promise<void> {
    const database = this.#databaseFactory(databasePath, {
      readonly: true,
      fileMustExist: true,
      defaultQueryTimeout: QUERY_TIMEOUT_MS,
      // @ts-expect-error Turso's runtime supports these features ahead of its public union type.
      experimental: ['custom_types', 'triggers', 'index_method', 'multiprocess_wal'],
    });
    try {
      await database.connect();
      const healthRows = await database.all('PRAGMA quick_check;', { queryTimeout: QUERY_TIMEOUT_MS }) as unknown[];
      const healthy = healthRows.length === 1
        && typeof healthRows[0] === 'object'
        && healthRows[0] !== null
        && Object.values(healthRows[0] as Record<string, unknown>).some((value) => value === 'ok');
      if (!healthy) {
        throw new ActorResourceError('DB_RESOURCE_RECOVERY_FAILED', 'DbResource database health check failed.');
      }
      await this.#verifyPhysicalHistory(database, configuration);
    } finally {
      await database.close().catch(() => undefined);
    }
  }

  async #canVerifyDatabaseFile(databasePath: string, configuration: TDbResourceConfiguration): Promise<boolean> {
    try {
      await this.#verifyDatabaseFile(databasePath, configuration);
      return true;
    } catch {
      return false;
    }
  }

  async #removeDatabaseFiles(databasePath: string): Promise<void> {
    const directory = dirname(databasePath);
    const fileName = basename(databasePath);
    const entries = await readdir(directory).catch(() => [] as string[]);
    await Promise.all(entries
      .filter((entry) => entry === fileName || entry.startsWith(`${fileName}-`))
      .map((entry) => rm(join(directory, entry), { force: true })));
  }

  async #copyDatabaseFiles(sourcePath: string, destinationPath: string): Promise<void> {
    const sourceDirectory = dirname(sourcePath);
    const sourceName = basename(sourcePath);
    const destinationDirectory = dirname(destinationPath);
    const destinationName = basename(destinationPath);
    const entries = await readdir(sourceDirectory);
    const sourceEntries = entries.filter((entry) => entry === sourceName || entry.startsWith(`${sourceName}-`));
    if (!sourceEntries.includes(sourceName)) {
      throw new ActorResourceError('DB_RESOURCE_RECOVERY_FAILED', 'DbResource snapshot source is missing its database file.');
    }
    await this.#removeDatabaseFiles(destinationPath);
    await Promise.all(sourceEntries.map((entry) => {
      const suffix = entry.slice(sourceName.length);
      return copyFile(join(sourceDirectory, entry), join(destinationDirectory, `${destinationName}${suffix}`));
    }));
  }

  async #requireConfiguration(resourceId: string): Promise<TDbResourceConfiguration> {
    const configuration = await this.#db.dbResource.configuration.get({ resourceId });
    if (!configuration) throw new ActorResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource configuration is unavailable.');
    return configuration;
  }

  #resourceDirectory(resourceId: string): string {
    return join(this.#dataRoot, 'actor-resources', 'db', validateResourceId(resourceId));
  }

  #databasePath(resourceId: string): string {
    return join(this.#resourceDirectory(resourceId), 'data.db');
  }

  #open(resourceId: string, fileMustExist: boolean): Promise<Database> {
    const cached = this.#handles.get(resourceId);
    if (cached) return cached;
    const opening = (async () => {
      const database = this.#databaseFactory(this.#databasePath(resourceId), {
        defaultQueryTimeout: QUERY_TIMEOUT_MS,
        fileMustExist,
        // @ts-expect-error Turso's runtime supports these features ahead of its public union type.
        experimental: ['custom_types', 'triggers', 'index_method', 'multiprocess_wal'],
      });
      try {
        await database.connect();
        await database.exec(RESOURCE_PRAGMAS_SQL);
        return database;
      } catch (error) {
        await database.close().catch(() => undefined);
        throw error;
      }
    })();
    this.#handles.set(resourceId, opening);
    void opening.catch(() => {
      if (this.#handles.get(resourceId) === opening) this.#handles.delete(resourceId);
    });
    return opening;
  }

  async #closeHandle(resourceId: string): Promise<void> {
    const opening = this.#handles.get(resourceId);
    this.#handles.delete(resourceId);
    if (!opening) return;
    const database = await opening;
    await database.close();
  }

  #serializeWrite<T>(resourceId: string, write: () => Promise<T>): Promise<T> {
    const previous = this.#writeTails.get(resourceId) ?? Promise.resolve();
    const result = previous.then(write, write);
    const tail = result.then(() => undefined, () => undefined);
    this.#writeTails.set(resourceId, tail);
    void tail.finally(() => {
      if (this.#writeTails.get(resourceId) === tail) this.#writeTails.delete(resourceId);
    });
    return result;
  }

  #track<T>(resourceId: string, call: Promise<T>): Promise<T> {
    let calls = this.#inflight.get(resourceId);
    if (!calls) {
      calls = new Set();
      this.#inflight.set(resourceId, calls);
    }
    calls.add(call);
    void call.finally(() => {
      calls?.delete(call);
      if (calls?.size === 0) this.#inflight.delete(resourceId);
    }).catch(() => undefined);
    return call;
  }

  async #drain(resourceId: string): Promise<void> {
    const calls = this.#inflight.get(resourceId);
    if (calls?.size) await Promise.allSettled([...calls]);
  }

  #assertAvailable(resourceId?: string): void {
    if (this.#closed) throw new ActorResourceError('DB_RESOURCE_UNAVAILABLE', 'DbResource provider is closed.');
    if (resourceId && this.#blocked.has(resourceId)) {
      throw new ActorResourceError('DB_RESOURCE_MIGRATING', 'DbResource is unavailable during migration or deletion.');
    }
  }
}

export type { TDatabaseFactory };
