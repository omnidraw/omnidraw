#!/usr/bin/env bun

/**
 * @file Verifies a built vibecanvas binary serves assets, websockets, and expected database paths.
 */

import path from "path"
import net from "node:net"
import { createHash } from "node:crypto"
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { Glob } from "bun"
import {
  AGENT_AUTHORING_MIGRATION_NAME,
  DATABASE_APPLICATION_ID,
  DATABASE_SCHEMA_VERSION,
  DEFAULT_OSS_ACCOUNT_DISPLAY_NAME,
  DEFAULT_OSS_ACCOUNT_ID,
  DEFAULT_OSS_ORGANIZATION_ID,
  FUNCTION_RUNTIME_MIGRATION_NAME,
  INITIAL_MIGRATION_NAME,
  LIVE_WIDGET_PREVIEW_MIGRATION_NAME,
  WIDGET_REVISION_SEQUENCE_MIGRATION_NAME,
} from "../packages/service-db/src/CONSTANTS"
import { Database } from "../packages/service-db/src/DbServiceTurso/turso-native"
import { fnSerializeDatabaseSchemaFingerprint } from "../packages/service-db/src/DbServiceTurso/fn.database-schema-fingerprint"
import { EXPECTED_DATABASE_SCHEMA_CONTRACTS } from "../packages/service-db/src/schema/expected-schema"

const require = createRequire(import.meta.url)

type TArgs = {
  binaryPath?: string
  port: number
  startupTimeoutMs: number
  requestTimeoutMs: number
  widgetPrerequisitesOnly: boolean
}

type TBinaryScenario = {
  name: string
  port: number
  cmd: string[]
  env: NodeJS.ProcessEnv
  expectedDbPath?: string
  expectedAbsentPaths?: string[]
  verifyForeignKeysAfterShutdown?: boolean
  shutdownSignal?: number
  cleanupPaths: string[]
}

type TMigrationIdentity = Readonly<{
  version: number
  name: string
  checksumSha256: string
}>

type TManagedDatabaseSnapshot = Readonly<{
  applicationId: number
  userVersion: number
  schemaFingerprintSha256: string
  migrations: readonly TMigrationIdentity[]
  organizations: readonly Record<string, unknown>[]
  accounts: readonly Record<string, unknown>[]
  memberships: readonly Record<string, unknown>[]
  integrityCheck: "ok"
  foreignKeyCheck: "not-verified" | "ok"
}>

type TForeignKeyListRow = Readonly<{
  id: number
  seq: number
  table: string
  from: string
  to: string | null
}>

type TTableInfoRow = Readonly<{
  name: string
  pk: number
}>

const EXPECTED_MIGRATION_NAMES = Object.freeze([
  INITIAL_MIGRATION_NAME,
  WIDGET_REVISION_SEQUENCE_MIGRATION_NAME,
  FUNCTION_RUNTIME_MIGRATION_NAME,
  AGENT_AUTHORING_MIGRATION_NAME,
  LIVE_WIDGET_PREVIEW_MIGRATION_NAME,
])

function parseArgs(): TArgs {
  const args = Bun.argv.slice(2)
  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(name)
    if (idx === -1) return undefined
    return args[idx + 1]
  }

  const binaryPath = getArg("--binary")
  const port = Number(getArg("--port") ?? "3339")
  const startupTimeoutMs = Number(getArg("--startup-timeout") ?? "45000")
  const requestTimeoutMs = Number(getArg("--request-timeout") ?? "15000")
  const widgetPrerequisitesOnly = args.includes("--widget-prerequisites-only")

  return { binaryPath, port, startupTimeoutMs, requestTimeoutMs, widgetPrerequisitesOnly }
}

async function resolveBinaryPath(inputPath?: string): Promise<string> {
  const rootDir = path.join(path.dirname(new URL(import.meta.url).pathname), "..")
  if (inputPath) return path.resolve(rootDir, inputPath)

  const osMap: Record<string, string> = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  }
  const archMap: Record<string, string> = {
    arm64: "arm64",
    x64: "x64",
  }
  const os = osMap[process.platform]
  const arch = archMap[process.arch]
  if (!os || !arch) {
    throw new Error(`Unsupported platform for auto-detect: ${process.platform}-${process.arch}`)
  }

  const pattern = `dist/vibecanvas-${os}-${arch}/bin/vibecanvas${process.platform === "win32" ? ".exe" : ""}`
  const fullPath = path.join(rootDir, pattern)
  if (await Bun.file(fullPath).exists()) {
    return fullPath
  }

  const fallbackGlob = new Glob(`dist/vibecanvas-${os}-${arch}*/bin/vibecanvas${process.platform === "win32" ? ".exe" : ""}`)
  for await (const match of fallbackGlob.scan(rootDir)) {
    return path.join(rootDir, match)
  }

  throw new Error("Could not auto-detect built binary. Pass --binary <path>.")
}

function getExpectedNativeAddonPath(binaryPath: string): string {
  const fileNameByPlatform: Record<string, string> = {
    "darwin-arm64": "turso.darwin-arm64.node",
    "linux-arm64": "turso.linux-arm64-gnu.node",
    "linux-x64": "turso.linux-x64-gnu.node",
  }
  const key = `${process.platform}-${process.arch}`
  const fileName = fileNameByPlatform[key]
  if (!fileName) {
    throw new Error(`No Turso native binary test expectation for ${key}`)
  }

  return path.join(path.dirname(binaryPath), "..", "native", fileName)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

async function waitForHttpReady(baseUrl: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  let lastError: unknown = null

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/`, { method: "GET" })
      if (response.ok) return
      lastError = new Error(`Unexpected status: ${response.status}`)
    } catch (error) {
      lastError = error
    }

    await Bun.sleep(250)
  }

  throw new Error(`Server did not become ready in ${timeoutMs}ms. Last error: ${String(lastError)}`)
}

async function waitForHttpReachable(baseUrl: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  let lastError: unknown = null

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await fetch(`${baseUrl}/`, { method: "GET" })
      return
    } catch (error) {
      lastError = error
    }

    await Bun.sleep(100)
  }

  throw new Error(`Server did not become reachable in ${timeoutMs}ms. Last error: ${String(lastError)}`)
}

function extractAssetUrls(html: string): string[] {
  const urls = new Set<string>()
  const regex = /(?:src|href)="([^"]+)"/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(html)) !== null) {
    const candidate = match[1]
    if (!candidate.startsWith("/")) continue
    if (candidate.startsWith("//")) continue
    if (candidate.startsWith("/api")) continue
    urls.add(candidate)
  }

  return [...urls]
}

async function assertHttpAsset(baseUrl: string, assetPath: string, timeoutMs: number): Promise<void> {
  const response = await withTimeout(fetch(`${baseUrl}${assetPath}`), timeoutMs, `fetch ${assetPath}`)
  if (!response.ok) {
    throw new Error(`Asset ${assetPath} failed with status ${response.status}`)
  }

  const bytes = await response.arrayBuffer()
  if (bytes.byteLength === 0) {
    throw new Error(`Asset ${assetPath} returned empty body`)
  }
}

async function assertHealthDiagnostics(
  baseUrl: string,
  timeoutMs: number,
): Promise<void> {
  const response = await withTimeout(fetch(`${baseUrl}/health`), timeoutMs, "fetch /health")
  if (!response.ok) {
    throw new Error(`GET /health failed with ${response.status}`)
  }

  const health = await response.json() as Record<string, unknown>
  if (health.ok !== true || health.service !== "vibecanvas") {
    throw new Error(`GET /health returned an invalid service status: ${JSON.stringify(health)}`)
  }
}

async function assertWsOpen(url: string, timeoutMs: number): Promise<WebSocket> {
  return withTimeout(
    new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(url)

      ws.addEventListener("open", () => resolve(ws), { once: true })
      ws.addEventListener(
        "error",
        () => {
          reject(new Error(`WebSocket error at ${url}`))
        },
        { once: true },
      )
      ws.addEventListener(
        "close",
        (event) => {
          reject(new Error(`WebSocket closed before ready at ${url} (${event.code})`))
        },
        { once: true },
      )
    }),
    timeoutMs,
    `ws connect ${url}`,
  )
}

async function assertApiWebSocket(baseUrl: string, timeoutMs: number): Promise<void> {
  const wsUrl = baseUrl.replace(/^http/, "ws") + "/api"
  const rpcWs = await assertWsOpen(wsUrl, timeoutMs)
  await Bun.sleep(250)
  rpcWs.close(1000, "test done")
}

async function assertPathExists(targetPath: string, label: string): Promise<void> {
  if (!(await Bun.file(targetPath).exists())) {
    throw new Error(`${label} was not created: ${targetPath}`)
  }
}

async function assertPathMissing(targetPath: string, label: string): Promise<void> {
  if (await Bun.file(targetPath).exists()) {
    throw new Error(`${label} unexpectedly exists: ${targetPath}`)
  }
}

async function expectedMigrationLedger(): Promise<readonly TMigrationIdentity[]> {
  const migrationsRoot = path.join(import.meta.dir, "..", "packages", "service-db", "src", "migrations")
  return Promise.all(EXPECTED_MIGRATION_NAMES.map(async (name, version) => {
    const bytes = new Uint8Array(await Bun.file(path.join(migrationsRoot, name)).arrayBuffer())
    return Object.freeze({
      version,
      name,
      checksumSha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    })
  }))
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

async function resolveForeignKeyParentColumns(
  database: Database,
  parentTable: string,
  foreignKeyRows: readonly TForeignKeyListRow[],
): Promise<readonly string[]> {
  const explicitColumns = foreignKeyRows.map((row) => row.to)
  if (explicitColumns.every((column): column is string => column !== null && column.length > 0)) {
    return explicitColumns
  }
  if (explicitColumns.some((column) => column !== null && column.length > 0)) {
    throw new Error(`Compiled control database has a partially implicit foreign key to ${parentTable}`)
  }

  const parentTableInfo = await (
    await database.prepare(`PRAGMA table_info(${quoteSqlIdentifier(parentTable)})`)
  ).all() as TTableInfoRow[]
  const primaryKeyColumns = parentTableInfo
    .filter((row) => Number(row.pk) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map((row) => String(row.name))
  if (primaryKeyColumns.length !== foreignKeyRows.length) {
    throw new Error(
      `Compiled control database cannot resolve implicit foreign key to ${parentTable}`,
    )
  }
  return primaryKeyColumns
}

async function assertNativeForeignKeyIntegrity(database: Database): Promise<void> {
  const tables = await (await database.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'table'
      AND name NOT GLOB 'sqlite_*'
    ORDER BY name
  `)).all() as Array<{ name: string }>

  for (const table of tables) {
    const childTable = String(table.name)
    const foreignKeyRows = await (
      await database.prepare(`PRAGMA foreign_key_list(${quoteSqlIdentifier(childTable)})`)
    ).all() as TForeignKeyListRow[]
    const foreignKeys = Map.groupBy(
      foreignKeyRows,
      (row) => Number(row.id),
    )

    for (const rows of foreignKeys.values()) {
      const orderedRows = rows.toSorted((left, right) => Number(left.seq) - Number(right.seq))
      const parentTable = String(orderedRows[0]?.table ?? "")
      if (parentTable.length === 0) {
        throw new Error(`Compiled control database has a foreign key without a parent table on ${childTable}`)
      }
      const childColumns = orderedRows.map((row) => String(row.from))
      const parentColumns = await resolveForeignKeyParentColumns(database, parentTable, orderedRows)
      const childNotNull = childColumns
        .map((column) => `child.${quoteSqlIdentifier(column)} IS NOT NULL`)
        .join(" AND ")
      const parentMatch = parentColumns
        .map((column, index) => (
          `parent.${quoteSqlIdentifier(column)} = child.${quoteSqlIdentifier(childColumns[index])}`
        ))
        .join(" AND ")
      const violation = await (
        await database.prepare(`
          SELECT 1 AS violation
          FROM ${quoteSqlIdentifier(childTable)} AS child
          WHERE ${childNotNull}
            AND NOT EXISTS (
              SELECT 1
              FROM ${quoteSqlIdentifier(parentTable)} AS parent
              WHERE ${parentMatch}
            )
          LIMIT 1
        `)
      ).get()
      if (violation !== undefined) {
        throw new Error(
          `Compiled control database foreign_key_check failed: ${childTable}(${childColumns.join(", ")}) -> ${parentTable}(${parentColumns.join(", ")})`,
        )
      }
    }
  }
}

async function assertManagedSchema(
  databasePath: string,
  verifyForeignKeys = false,
): Promise<TManagedDatabaseSnapshot> {
  const database = new Database(databasePath, {
    experimental: [
      "custom_types",
      "triggers",
      "index_method",
      "generated_columns",
      "multiprocess_wal",
    ] as never,
  })
  try {
    await database.connect()
    const applicationId = Number((await (await database.prepare("PRAGMA application_id")).get())?.application_id)
    const userVersion = Number((await (await database.prepare("PRAGMA user_version")).get())?.user_version)
    if (applicationId !== DATABASE_APPLICATION_ID) {
      throw new Error(`Compiled control database application_id mismatch: ${applicationId}`)
    }
    if (userVersion !== DATABASE_SCHEMA_VERSION) {
      throw new Error(`Compiled control database user_version mismatch: ${userVersion}`)
    }

    const schemaRows = await (await database.prepare(`
      SELECT type, name, tbl_name AS table_name, sql
      FROM sqlite_schema
      WHERE type IN ('table', 'index', 'view', 'trigger')
        AND name NOT GLOB 'sqlite_*'
      ORDER BY type, name, tbl_name
    `)).all() as Array<{
      type: "index" | "table" | "trigger" | "view"
      name: string
      table_name: string
      sql: string | null
    }>
    const schemaFingerprintSha256 = new Bun.CryptoHasher("sha256")
      .update(fnSerializeDatabaseSchemaFingerprint(schemaRows.map((row) => ({
        type: row.type,
        name: row.name,
        tableName: row.table_name,
        sql: row.sql,
      }))))
      .digest("hex")
    const expectedSchema = EXPECTED_DATABASE_SCHEMA_CONTRACTS[DATABASE_SCHEMA_VERSION]
    if (!expectedSchema || schemaFingerprintSha256 !== expectedSchema.fingerprintSha256) {
      throw new Error(
        `Compiled control database whole-schema fingerprint mismatch: ${schemaFingerprintSha256}`,
      )
    }

    const migrations = (await (await database.prepare(`
      SELECT version, name, checksum_sha256
      FROM schema_migrations
      ORDER BY version
    `)).all()).map((row) => Object.freeze({
      version: Number(row.version),
      name: String(row.name),
      checksumSha256: String(row.checksum_sha256),
    }))
    const expectedMigrations = await expectedMigrationLedger()
    if (JSON.stringify(migrations) !== JSON.stringify(expectedMigrations)) {
      throw new Error(`Compiled control database migration ledger mismatch: ${JSON.stringify(migrations)}`)
    }

    const organizations = await (await database.prepare(`
      SELECT id, slug, name, status, created_at_ms, updated_at_ms
      FROM organizations ORDER BY id
    `)).all()
    const accounts = await (await database.prepare(`
      SELECT id, kind, display_name, status, is_autogenerated, created_at_ms, updated_at_ms
      FROM accounts ORDER BY id
    `)).all()
    const memberships = await (await database.prepare(`
      SELECT org_id, account_id, role, status, is_billable_seat, created_at_ms, updated_at_ms
      FROM organization_memberships
      ORDER BY org_id, account_id
    `)).all()
    const expectedOrganizations = [{
      id: DEFAULT_OSS_ORGANIZATION_ID,
      slug: "local",
      name: "Local",
      status: "active",
      created_at_ms: 0,
      updated_at_ms: 0,
    }]
    const expectedAccounts = [{
      id: DEFAULT_OSS_ACCOUNT_ID,
      kind: "user",
      display_name: DEFAULT_OSS_ACCOUNT_DISPLAY_NAME,
      status: "active",
      is_autogenerated: 1,
      created_at_ms: 0,
      updated_at_ms: 0,
    }]
    const expectedMemberships = [{
      org_id: DEFAULT_OSS_ORGANIZATION_ID,
      account_id: DEFAULT_OSS_ACCOUNT_ID,
      role: "owner",
      status: "active",
      is_billable_seat: 1,
      created_at_ms: 0,
      updated_at_ms: 0,
    }]
    if (JSON.stringify(organizations) !== JSON.stringify(expectedOrganizations)) {
      throw new Error(`Compiled control database default organization seed mismatch: ${JSON.stringify(organizations)}`)
    }
    if (JSON.stringify(accounts) !== JSON.stringify(expectedAccounts)) {
      throw new Error(`Compiled control database default account seed mismatch: ${JSON.stringify(accounts)}`)
    }
    if (JSON.stringify(memberships) !== JSON.stringify(expectedMemberships)) {
      throw new Error(`Compiled control database default membership seed mismatch: ${JSON.stringify(memberships)}`)
    }

    const integrity = await (await database.prepare("PRAGMA integrity_check")).all()
    if (JSON.stringify(integrity) !== JSON.stringify([{ integrity_check: "ok" }])) {
      throw new Error(`Compiled control database integrity_check failed: ${JSON.stringify(integrity)}`)
    }
    if (verifyForeignKeys) {
      await assertNativeForeignKeyIntegrity(database)
    }
    return Object.freeze({
      applicationId,
      userVersion,
      schemaFingerprintSha256,
      migrations,
      organizations,
      accounts,
      memberships,
      integrityCheck: "ok",
      foreignKeyCheck: verifyForeignKeys ? "ok" : "not-verified",
    })
  } finally {
    await database.close()
  }
}

async function assertFileForeignKeyIntegrity(
  databasePath: string,
): Promise<TManagedDatabaseSnapshot> {
  const verificationRoot = await mkdtemp(path.join(tmpdir(), "vibecanvas-binary-fk-"))
  try {
    const databaseDirectory = path.dirname(databasePath)
    const databaseName = path.basename(databasePath)
    for (const entry of await readdir(databaseDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || (entry.name !== databaseName && !entry.name.startsWith(`${databaseName}-`))) {
        continue
      }
      await Bun.write(
        path.join(verificationRoot, entry.name),
        Bun.file(path.join(databaseDirectory, entry.name)),
      )
    }

    const verificationPath = path.join(verificationRoot, databaseName)
    // The native Turso verifier understands the managed domain types and
    // replays the copied multiprocess WAL before auditing foreign keys.
    return await assertManagedSchema(verificationPath, true)
  } finally {
    await rm(verificationRoot, { recursive: true, force: true })
  }
}

function assertSameManagedDatabaseSnapshot(
  first: TManagedDatabaseSnapshot | undefined,
  second: TManagedDatabaseSnapshot | undefined,
): void {
  if (!first || !second || JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error(
      `Compiled same-home restart changed deterministic database state: ${JSON.stringify({ first, second })}`,
    )
  }
}

async function assertNativeEncryptionSupport(nativeAddonPath: string): Promise<void> {
  const nativeAddon = Buffer.from(await Bun.file(nativeAddonPath).arrayBuffer()).toString("latin1")
  if (!nativeAddon.includes("EncryptionCipher") || !nativeAddon.includes("Aegis256")) {
    throw new Error(`Compiled Turso native addon does not expose AEGIS-256 encryption: ${nativeAddonPath}`)
  }
  const nativeBinding = require(nativeAddonPath) as {
    EncryptionCipher?: { Aegis256?: unknown };
  }
  if (nativeBinding.EncryptionCipher?.Aegis256 === undefined) {
    throw new Error(`Compiled Turso native addon does not export EncryptionCipher.Aegis256: ${nativeAddonPath}`)
  }
}

async function createWidgetNpmFixtures(tempRoot: string): Promise<{
  availablePath: string
  missingPath: string
}> {
  const availablePath = path.join(tempRoot, "widget-npm-available")
  const missingPath = path.join(tempRoot, "widget-npm-missing")
  await Promise.all([mkdir(availablePath, { recursive: true }), mkdir(missingPath, { recursive: true })])

  const npmPath = path.join(availablePath, "npm")
  await Bun.write(npmPath, "#!/bin/sh\nprintf '11.0.0\\n'\n")
  await chmod(npmPath, 0o755)

  return { availablePath, missingPath }
}

async function assertWidgetPrerequisiteBinaryScenario(args: {
  binaryPath: string
  executablePath: string
  homePath: string
  port: number
  warningExpected: boolean
  timeoutMs: number
}): Promise<void> {
  const proc = Bun.spawn({
    cmd: [args.binaryPath, "serve", "--port", String(args.port)],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      PATH: args.executablePath,
      VIBECANVAS_HOME: args.homePath,
    },
  })
  const stdoutPromise = new Response(proc.stdout).text()
  const stderrPromise = new Response(proc.stderr).text()
  let reachabilityError: unknown

  try {
    await waitForHttpReachable(`http://127.0.0.1:${args.port}`, args.timeoutMs)
    await Bun.sleep(250)
  } catch (error) {
    reachabilityError = error
  } finally {
    proc.kill()
    await proc.exited
  }

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
  if (reachabilityError !== undefined) {
    throw new Error(
      `Widget prerequisite binary server was unreachable: ${String(reachabilityError)}\nstdout: ${stdout || "<empty>"}\nstderr: ${stderr || "<empty>"}`,
    )
  }
  const warningText = "Widget tooling prerequisites unavailable"
  if (!stdout.includes(`Server listening on http://localhost:${args.port}`)) {
    throw new Error(`Widget prerequisite binary server did not finish startup: ${stdout || "<empty>"}`)
  }
  if (args.warningExpected) {
    for (const expected of [
      warningText,
      "npm (missing)",
      "Install npm",
    ]) {
      if (!stderr.includes(expected)) {
        throw new Error(`Widget prerequisite binary stderr did not include ${JSON.stringify(expected)}: ${stderr || "<empty>"}`)
      }
    }
  } else if (stderr.includes(warningText)) {
    throw new Error(`Widget prerequisite binary emitted an unexpected warning: ${stderr}`)
  }
}

async function assertLegacyMarkerIgnoredBinaryScenario(args: {
  binaryPath: string
  homePath: string
  port: number
  timeoutMs: number
}): Promise<void> {
  const actorEraDatabasePath = path.join(args.homePath, "vibecanvas.turso")
  const originalContents = "actor-era-database-marker\n"
  await mkdir(args.homePath, { recursive: true })
  await Bun.write(actorEraDatabasePath, originalContents)

  const proc = Bun.spawn({
    cmd: [args.binaryPath, "serve", "--port", String(args.port)],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      VIBECANVAS_HOME: args.homePath,
    },
  })
  const stdoutPromise = new Response(proc.stdout).text()
  const stderrPromise = new Response(proc.stderr).text()
  let reachabilityError: unknown

  try {
    await waitForHttpReachable(`http://127.0.0.1:${args.port}`, args.timeoutMs)
    await Bun.sleep(250)
  } catch (error) {
    reachabilityError = error
  } finally {
    proc.kill()
    await proc.exited
  }

  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
  if (reachabilityError !== undefined) {
    throw new Error(
      `Compiled binary did not ignore the legacy marker: ${String(reachabilityError)}\n`
        + `stdout: ${stdout || "<empty>"}\nstderr: ${stderr || "<empty>"}`,
    )
  }
  if (!stdout.includes(`Server listening on http://localhost:${args.port}`)) {
    throw new Error(`Compiled legacy-marker server did not finish startup: ${stdout || "<empty>"}`)
  }
  if (/actor-era/i.test(stderr)) {
    throw new Error(`Compiled legacy-marker server emitted a retired actor warning: ${stderr}`)
  }
  if (await Bun.file(actorEraDatabasePath).text() !== originalContents) {
    throw new Error(`Compiled server modified the legacy marker: ${actorEraDatabasePath}`)
  }
  await assertPathExists(path.join(args.homePath, "main.db"), "compiled legacy-marker main.db")
  const sqliteShmSentinel = path.join(args.homePath, "main.db-shm")
  if (!(await lstat(sqliteShmSentinel)).isDirectory()) {
    throw new Error(`Compiled server did not reserve the SQLite shm sentinel: ${sqliteShmSentinel}`)
  }
}

async function createPortBlocker(port: number): Promise<{ close: () => Promise<void> }> {
  const server = net.createServer()
  const sockets = new Set<net.Socket>()

  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.on("close", () => {
      sockets.delete(socket)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, () => {
      server.off("error", reject)
      resolve()
    })
  })

  return {
    close: () => {
      for (const socket of sockets) {
        socket.destroy()
      }
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    },
  }
}

async function runBinaryScenario(
  binaryPath: string,
  args: TArgs,
  scenario: TBinaryScenario,
): Promise<TManagedDatabaseSnapshot | undefined> {
  const baseUrl = `http://127.0.0.1:${scenario.port}`
  console.log(`[test-binary] Scenario '${scenario.name}' using ${baseUrl}`)
  let databaseSnapshot: TManagedDatabaseSnapshot | undefined
  let scenarioPassed = false

  const proc = Bun.spawn({
    cmd: [binaryPath, ...scenario.cmd],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      ...scenario.env,
    },
  })

  const stdoutPromise = new Response(proc.stdout).text()
  const stderrPromise = new Response(proc.stderr).text()

  try {
    await waitForHttpReady(baseUrl, args.startupTimeoutMs)
    console.log(`[test-binary] PASS ${scenario.name} server startup`)

    const rootResponse = await withTimeout(fetch(`${baseUrl}/`), args.requestTimeoutMs, `fetch / (${scenario.name})`)
    if (!rootResponse.ok) {
      throw new Error(`GET / failed with ${rootResponse.status}`)
    }

    const rootHtml = await rootResponse.text()
    const contentType = rootResponse.headers.get("content-type") ?? ""
    if (!contentType.includes("text/html")) {
      throw new Error(`GET / has invalid content-type: ${contentType}`)
    }
    if (!rootHtml.includes("<div id=\"root\">")) {
      throw new Error("GET / html does not include root mount node")
    }
    console.log(`[test-binary] PASS ${scenario.name} GET /`)

    await assertHealthDiagnostics(baseUrl, args.requestTimeoutMs)
    console.log(`[test-binary] PASS ${scenario.name} GET /health`)

    const assetUrls = extractAssetUrls(rootHtml)
    if (assetUrls.length === 0) {
      throw new Error("No static assets found in index.html")
    }

    for (const assetUrl of assetUrls) {
      await assertHttpAsset(baseUrl, assetUrl, args.requestTimeoutMs)
      console.log(`[test-binary] PASS ${scenario.name} asset ${assetUrl}`)
    }

    await assertApiWebSocket(baseUrl, args.requestTimeoutMs)
    console.log(`[test-binary] PASS ${scenario.name} ws /api`)

    if (scenario.expectedDbPath) {
      await assertPathExists(scenario.expectedDbPath, `${scenario.name} db path`)
      console.log(`[test-binary] PASS ${scenario.name} db path ${scenario.expectedDbPath}`)
      databaseSnapshot = await assertManagedSchema(scenario.expectedDbPath)
      console.log(`[test-binary] PASS ${scenario.name} exact managed schema, migrations, seed, and integrity`)
    }

    for (const missingPath of scenario.expectedAbsentPaths ?? []) {
      await assertPathMissing(missingPath, `${scenario.name} fallback path`)
      console.log(`[test-binary] PASS ${scenario.name} did not touch ${missingPath}`)
    }

    console.log(`[test-binary] Scenario '${scenario.name}' passed`)
    scenarioPassed = true
  } finally {
    if (scenario.shutdownSignal === 9 && proc.exitCode !== null) {
      throw new Error(
        `${scenario.name} exited before the required SIGKILL fault injection (exit ${proc.exitCode}).`,
      )
    }
    proc.kill(scenario.shutdownSignal)

    const exitOrTimeout = Promise.race([
      proc.exited,
      Bun.sleep(5000).then(() => "timeout"),
    ])
    const result = await exitOrTimeout
    if (result === "timeout") {
      proc.kill(9)
      await proc.exited
    }
    if (scenario.shutdownSignal === 9) {
      if (proc.signalCode !== "SIGKILL") {
        throw new Error(
          `${scenario.name} did not exit through SIGKILL: ${String(proc.signalCode)}`,
        )
      }
      console.log(`[test-binary] PASS ${scenario.name} terminated with SIGKILL for crash recovery`)
    }

    try {
      if (
        scenarioPassed
        && scenario.verifyForeignKeysAfterShutdown === true
        && scenario.expectedDbPath
      ) {
        const verifiedSnapshot = await assertFileForeignKeyIntegrity(scenario.expectedDbPath)
        if (
          databaseSnapshot
          && JSON.stringify({ ...databaseSnapshot, foreignKeyCheck: "ok" })
            !== JSON.stringify(verifiedSnapshot)
        ) {
          throw new Error(
            `${scenario.name} copied WAL snapshot differs from the live Turso view.`,
          )
        }
        databaseSnapshot = verifiedSnapshot
        console.log(`[test-binary] PASS ${scenario.name} foreign_key_check after shutdown`)
      }
    } finally {
      for (const cleanupPath of scenario.cleanupPaths) {
        await Bun.$`rm -rf ${cleanupPath}`.quiet()
      }
    }

    const [stdout, stderr] = await Promise.allSettled([stdoutPromise, stderrPromise])
    const stdoutText = stdout.status === "fulfilled" ? stdout.value : ""
    const stderrText = stderr.status === "fulfilled" ? stderr.value : ""
    if (stdoutText.trim()) {
      console.log(`[test-binary] ${scenario.name} server stdout:`)
      console.log(stdoutText)
    }
    if (stderrText.trim()) {
      console.log(`[test-binary] ${scenario.name} server stderr:`)
      console.log(stderrText)
    }
  }

  return databaseSnapshot
}

async function main() {
  const args = parseArgs()
  const binaryPath = await resolveBinaryPath(args.binaryPath)
  const expectedNativeAddonPath = getExpectedNativeAddonPath(binaryPath)
  const tempRoot = path.join(process.cwd(), `.tmp-binary-test-${Date.now()}`)
  try {
  const envHome = path.join(tempRoot, "env-home")
  const compiledHome = path.join(tempRoot, "compiled-home")
  const explicitHome = path.join(tempRoot, "explicit-home")
  const ignoredEnvHome = path.join(tempRoot, "ignored-env-home")
  const widgetNpm = await createWidgetNpmFixtures(tempRoot)

  console.log(`[test-binary] Using binary: ${binaryPath}`)
  await assertPathExists(expectedNativeAddonPath, "compiled Turso native addon")
  await assertNativeEncryptionSupport(expectedNativeAddonPath)
  console.log(`[test-binary] PASS native addon ${expectedNativeAddonPath}`)
  console.log(`[test-binary] Temp root: ${tempRoot}`)

  await assertLegacyMarkerIgnoredBinaryScenario({
    binaryPath,
    homePath: path.join(tempRoot, "legacy-marker-home"),
    port: args.port + 2,
    timeoutMs: args.startupTimeoutMs,
  })
  console.log("[test-binary] PASS compiled server ignores the legacy marker and reserves SQLite shm")

  await assertWidgetPrerequisiteBinaryScenario({
    binaryPath,
    executablePath: widgetNpm.availablePath,
    homePath: path.join(tempRoot, "widget-npm-available-home"),
    port: args.port,
    warningExpected: false,
    timeoutMs: args.startupTimeoutMs,
  })
  console.log("[test-binary] PASS compiled widget prerequisite check with npm")

  await assertWidgetPrerequisiteBinaryScenario({
    binaryPath,
    executablePath: widgetNpm.missingPath,
    homePath: path.join(tempRoot, "widget-npm-missing-home"),
    port: args.port + 1,
    warningExpected: true,
    timeoutMs: args.startupTimeoutMs,
  })
  console.log("[test-binary] PASS compiled widget prerequisite warning with missing npm")

  if (args.widgetPrerequisitesOnly) {
    return
  }

  const firstHomeBoot = await runBinaryScenario(binaryPath, args, {
    name: "home-env-first-boot",
    port: args.port,
    cmd: ["serve", "--port", String(args.port)],
    env: {
      VIBECANVAS_HOME: envHome,
    },
    expectedDbPath: path.join(envHome, "main.db"),
    verifyForeignKeysAfterShutdown: true,
    shutdownSignal: 9,
    cleanupPaths: [],
  })

  const secondHomeBoot = await runBinaryScenario(binaryPath, args, {
    name: "home-env-second-boot",
    port: args.port,
    cmd: ["serve", "--port", String(args.port)],
    env: {
      VIBECANVAS_HOME: envHome,
    },
    expectedDbPath: path.join(envHome, "main.db"),
    verifyForeignKeysAfterShutdown: true,
    cleanupPaths: [envHome],
  })
  assertSameManagedDatabaseSnapshot(firstHomeBoot, secondHomeBoot)
  console.log("[test-binary] PASS same fresh home boots twice with deterministic schema, migration, and seed state")

  await runBinaryScenario(binaryPath, args, {
    name: "explicit-data-dir-flag",
    port: args.port + 1,
    cmd: ["serve", "--port", String(args.port + 1), "--data-dir", explicitHome],
    env: {
      VIBECANVAS_HOME: ignoredEnvHome,
    },
    expectedDbPath: path.join(explicitHome, "main.db"),
    expectedAbsentPaths: [ignoredEnvHome],
    cleanupPaths: [explicitHome, ignoredEnvHome],
  })

  const defaultCompiledPort = 7496
  const blockedCompiledPort = await createPortBlocker(defaultCompiledPort)
  try {
    await runBinaryScenario(binaryPath, args, {
      name: "compiled-default-port-fallback",
      port: defaultCompiledPort + 1,
      cmd: [],
      env: {
        VIBECANVAS_HOME: compiledHome,
      },
      expectedDbPath: path.join(compiledHome, "main.db"),
      cleanupPaths: [compiledHome],
    })
  } finally {
    await blockedCompiledPort.close()
  }

  console.log("[test-binary] All checks passed")
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`[test-binary] FAIL ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
