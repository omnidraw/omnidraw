#!/usr/bin/env bun

/**
 * @file Verifies a built vibecanvas binary serves assets, websockets, and expected database paths.
 */

import path from "path"
import net from "node:net"
import { Glob } from "bun"

type TArgs = {
  binaryPath?: string
  port: number
  startupTimeoutMs: number
  requestTimeoutMs: number
}

type TBinaryScenario = {
  name: string
  port: number
  cmd: string[]
  env: NodeJS.ProcessEnv
  expectedDbPath?: string
  expectedAbsentPaths?: string[]
  cleanupPaths: string[]
}

type TActorIpcChildMessage =
  | { type: "ready" }
  | { type: "setData"; id: number; data: unknown }
  | { type: "emitMessage"; id: number; msg: unknown }
  | { type: "done"; id: number }
  | { type: "error"; id?: number; msg: unknown; error?: boolean }

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

  return { binaryPath, port, startupTimeoutMs, requestTimeoutMs }
}

async function resolveBinaryPath(inputPath?: string): Promise<string> {
  if (inputPath) return inputPath

  const rootDir = path.join(path.dirname(new URL(import.meta.url).pathname), "..")
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

function extractAssetUrls(html: string): string[] {
  const urls = new Set<string>()
  const regex = /(?:src|href)="([^"]+)"/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(html)) !== null) {
    const candidate = match[1]
    if (!candidate.startsWith("/")) continue
    if (candidate.startsWith("//")) continue
    if (candidate.startsWith("/api") || candidate.startsWith("/automerge")) continue
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

async function createPortBlocker(port: number): Promise<{ close: () => Promise<void> }> {
  const server = net.createServer()

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, () => {
      server.off("error", reject)
      resolve()
    })
  })

  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
  }
}

async function createActorIpcFixture(tempRoot: string): Promise<string> {
  const fixtureDir = path.join(tempRoot, "actor-ipc-fixture")
  await Bun.$`mkdir -p ${fixtureDir}`.quiet()
  const functionPath = path.join(fixtureDir, "functions.ts")
  await Bun.write(functionPath, `
export default {
  fn: {},
  fx: {},
  tx: {
    "tx.addFunds": async (portal, args) => {
      const data = { balance: args.data.balance + args.msg.amount };
      await portal.setData(data);
      await portal.emitMessage({
        type: "funds-added",
        payload: {
          accountId: args.msg.accountId,
          amount: args.msg.amount,
          balance: data.balance,
        },
      });
    },
  },
};
`)
  return functionPath
}

async function assertActorIpcBinary(binaryPath: string, tempRoot: string, timeoutMs: number): Promise<void> {
  const functionPath = await createActorIpcFixture(tempRoot)
  const messages: TActorIpcChildMessage[] = []

  console.log(`[test-binary] Scenario 'actor-ipc' using ${functionPath}`)

  let proc: Bun.Subprocess | null = null
  const done = withTimeout(new Promise<void>((resolve, reject) => {
    proc = Bun.spawn({
      cmd: [binaryPath, "--icp-client", "--functionPath", functionPath],
      cwd: path.dirname(functionPath),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
      ipc(message) {
        const childMessage = message as TActorIpcChildMessage
        messages.push(childMessage)

        if (childMessage.type === "ready") {
          proc?.send({
            type: "run",
            id: 1,
            func: ["tx.addFunds"],
            payload: { accountId: "compiled", amount: 29 },
            data: { balance: 13 },
          })
          return
        }

        if (childMessage.type === "setData") {
          proc?.send({ type: "ack", id: childMessage.id, action: "setData" })
          return
        }

        if (childMessage.type === "emitMessage") {
          proc?.send({ type: "ack", id: childMessage.id, action: "emitMessage" })
          return
        }

        if (childMessage.type === "done") {
          resolve()
          return
        }

        if (childMessage.type === "error") {
          reject(new Error(`actor-ipc child error: ${JSON.stringify(childMessage.msg)}`))
        }
      },
    })
  }), timeoutMs, "actor-ipc")

  try {
    await done
  } finally {
    proc?.kill()
    if (proc) {
      const result = await Promise.race([
        proc.exited,
        Bun.sleep(5000).then(() => "timeout"),
      ])
      if (result === "timeout") {
        proc.kill(9)
        await proc.exited
      }
    }
  }

  const types = messages.map((message) => message.type)
  if (JSON.stringify(types) !== JSON.stringify(["ready", "setData", "emitMessage", "done"])) {
    throw new Error(`actor-ipc message sequence mismatch: ${JSON.stringify(types)}`)
  }

  const setData = messages.find((message) => message.type === "setData")
  if (setData?.type !== "setData" || JSON.stringify(setData.data) !== JSON.stringify({ balance: 42 })) {
    throw new Error(`actor-ipc setData mismatch: ${JSON.stringify(setData)}`)
  }

  const emitMessage = messages.find((message) => message.type === "emitMessage")
  const expectedMsg = {
    type: "funds-added",
    payload: { accountId: "compiled", amount: 29, balance: 42 },
  }
  if (emitMessage?.type !== "emitMessage" || JSON.stringify(emitMessage.msg) !== JSON.stringify(expectedMsg)) {
    throw new Error(`actor-ipc emitMessage mismatch: ${JSON.stringify(emitMessage)}`)
  }

  console.log("[test-binary] PASS actor-ipc ready/setData/emitMessage/done")
}

async function runBinaryScenario(binaryPath: string, args: TArgs, scenario: TBinaryScenario): Promise<void> {
  const baseUrl = `http://127.0.0.1:${scenario.port}`
  console.log(`[test-binary] Scenario '${scenario.name}' using ${baseUrl}`)

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

    const automergeWs = await assertWsOpen(`ws://127.0.0.1:${scenario.port}/automerge`, args.requestTimeoutMs)
    await Bun.sleep(250)
    automergeWs.close(1000, "test done")
    console.log(`[test-binary] PASS ${scenario.name} ws /automerge`)

    if (scenario.expectedDbPath) {
      await assertPathExists(scenario.expectedDbPath, `${scenario.name} db path`)
      console.log(`[test-binary] PASS ${scenario.name} db path ${scenario.expectedDbPath}`)
    }

    for (const missingPath of scenario.expectedAbsentPaths ?? []) {
      await assertPathMissing(missingPath, `${scenario.name} fallback path`)
      console.log(`[test-binary] PASS ${scenario.name} did not touch ${missingPath}`)
    }

    console.log(`[test-binary] Scenario '${scenario.name}' passed`)
  } finally {
    proc.kill()

    const exitOrTimeout = Promise.race([
      proc.exited,
      Bun.sleep(5000).then(() => "timeout"),
    ])
    const result = await exitOrTimeout
    if (result === "timeout") {
      proc.kill(9)
      await proc.exited
    }

    for (const cleanupPath of scenario.cleanupPaths) {
      await Bun.$`rm -rf ${cleanupPath}`.quiet()
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
}

async function main() {
  const args = parseArgs()
  const binaryPath = await resolveBinaryPath(args.binaryPath)
  const expectedNativeAddonPath = getExpectedNativeAddonPath(binaryPath)
  const tempRoot = path.join(process.cwd(), `.tmp-binary-test-${Date.now()}`)
  const tempConfigDir = path.join(tempRoot, "config-mode")
  const tempCompiledConfigDir = path.join(tempRoot, "compiled-config-mode")
  const tempDbDir = path.join(tempRoot, "db-mode")
  const explicitDbPath = path.join(tempDbDir, "nested", "binary-test.sqlite")
  const xdgRoot = path.join(tempRoot, "xdg-root")

  console.log(`[test-binary] Using binary: ${binaryPath}`)
  await assertPathExists(expectedNativeAddonPath, "compiled Turso native addon")
  console.log(`[test-binary] PASS native addon ${expectedNativeAddonPath}`)
  console.log(`[test-binary] Temp root: ${tempRoot}`)

  await assertActorIpcBinary(binaryPath, tempRoot, args.requestTimeoutMs)

  await runBinaryScenario(binaryPath, args, {
    name: "config-env",
    port: args.port,
    cmd: ["serve", "--port", String(args.port)],
    env: {
      VIBECANVAS_CONFIG: tempConfigDir,
    },
    expectedDbPath: path.join(tempConfigDir, "vibecanvas.turso"),
    cleanupPaths: [tempConfigDir],
  })

  await runBinaryScenario(binaryPath, args, {
    name: "explicit-db-flag",
    port: args.port + 1,
    cmd: ["serve", "--port", String(args.port + 1), "--db", explicitDbPath],
    env: {
      XDG_DATA_HOME: path.join(xdgRoot, "data"),
      XDG_CONFIG_HOME: path.join(xdgRoot, "config"),
      XDG_STATE_HOME: path.join(xdgRoot, "state"),
      XDG_CACHE_HOME: path.join(xdgRoot, "cache"),
    },
    expectedDbPath: explicitDbPath,
    expectedAbsentPaths: [path.join(xdgRoot, "data", "vibecanvas", "vibecanvas.turso")],
    cleanupPaths: [tempDbDir, xdgRoot],
  })

  const defaultCompiledPort = 7496
  const blockedCompiledPort = await createPortBlocker(defaultCompiledPort)
  try {
    await runBinaryScenario(binaryPath, args, {
      name: "compiled-default-port-fallback",
      port: defaultCompiledPort + 1,
      cmd: [],
      env: {
        VIBECANVAS_CONFIG: tempCompiledConfigDir,
      },
      expectedDbPath: path.join(tempCompiledConfigDir, "vibecanvas.turso"),
      cleanupPaths: [tempCompiledConfigDir],
    })
  } finally {
    await blockedCompiledPort.close()
  }

  console.log("[test-binary] All checks passed")
}

main().catch((error) => {
  console.error(`[test-binary] FAIL ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
