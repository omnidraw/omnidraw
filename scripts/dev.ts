#!/usr/bin/env bun
/**
 * @file Starts the local dev stack on a matched backend/frontend port pair.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import net from "net"
import os from "os"
import path from "path"

const rootDir = path.resolve(import.meta.dir, "..")
const cliDir = path.join(rootDir, "apps/cli")
const frontendDir = path.join(rootDir, "apps/frontend")
const webDir = path.join(rootDir, "apps/web")
const lockRootDir = path.join(os.tmpdir(), "vibecanvas-dev-ports")
const bunExec = process.execPath

type TPortLease = {
  port: number
  release: () => void
}

type TDevProcess = {
  name: string
  process: ReturnType<typeof Bun.spawn>
}

function parsePortEnv(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback

  const port = Number.parseInt(value, 10)
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`[dev] ${name} must be a valid TCP port. Received: ${value}`)
  }
  return port
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function cleanupStaleLock(lockDir: string): void {
  if (!existsSync(lockDir)) return

  try {
    const pid = Number.parseInt(readFileSync(path.join(lockDir, "pid"), "utf8"), 10)
    if (Number.isFinite(pid) && isProcessAlive(pid)) return
  } catch {
    // Invalid lock metadata is treated as stale.
  }

  rmSync(lockDir, { recursive: true, force: true })
}

function canConnectToHost(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    let settled = false

    function done(result: boolean): void {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(200)
    socket.once("connect", () => done(true))
    socket.once("timeout", () => done(false))
    socket.once("error", () => done(false))
  })
}

function canListenOnHost(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()

    server.once("error", () => {
      resolve(false)
    })

    server.listen({ host, port }, () => {
      server.close(() => {
        resolve(true)
      })
    })
  })
}

async function isPortAvailable(port: number): Promise<boolean> {
  if (await canConnectToHost("127.0.0.1", port)) return false
  if (await canConnectToHost("::1", port)) return false
  return await canListenOnHost("127.0.0.1", port) && await canListenOnHost("::1", port)
}

async function acquirePortLease(kind: string, startPort: number): Promise<TPortLease> {
  mkdirSync(lockRootDir, { recursive: true })

  for (let offset = 0; offset < 100; offset += 1) {
    const port = startPort + offset
    const lockDir = path.join(lockRootDir, `${port}.lock`)

    cleanupStaleLock(lockDir)

    try {
      mkdirSync(lockDir)
      writeFileSync(path.join(lockDir, "pid"), `${process.pid}\n`)
      writeFileSync(path.join(lockDir, "kind"), `${kind}\n`)
    } catch {
      continue
    }

    if (await isPortAvailable(port)) {
      return {
        port,
        release: () => {
          rmSync(lockDir, { recursive: true, force: true })
        },
      }
    }

    rmSync(lockDir, { recursive: true, force: true })
  }

  throw new Error(`[dev] No available ${kind} port found starting from ${startPort}`)
}

function spawnDevProcess(args: {
  name: string
  cwd: string
  cmd: string[]
  env?: Record<string, string>
  output?: "inherit" | "pipe"
}): TDevProcess {
  console.log(`[dev] ${args.name}: ${args.cmd.join(" ")}`)
  const output = args.output ?? "inherit"

  return {
    name: args.name,
    process: Bun.spawn({
      cmd: args.cmd,
      cwd: args.cwd,
      env: {
        ...process.env,
        ...args.env,
      },
      stdin: "inherit",
      stdout: output,
      stderr: output,
    }),
  }
}

async function pipeLines(args: {
  child: TDevProcess
  stream: ReadableStream<Uint8Array> | null
  sink: (line: string) => void
  write: (text: string) => void
}): Promise<void> {
  if (!args.stream) return

  const reader = args.stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const result = await reader.read()
    if (result.done) break

    buffer += decoder.decode(result.value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      args.sink(line)
      args.write(`[${args.child.name}] ${line}\n`)
    }
  }

  if (buffer) {
    args.sink(buffer)
    args.write(`[${args.child.name}] ${buffer}\n`)
  }
}

async function waitForBackendPort(child: TDevProcess): Promise<number> {
  let resolved = false

  const portPromise = new Promise<number>((resolve, reject) => {
    const readLine = (line: string) => {
      const match = line.match(/Server listening on http:\/\/localhost:(\d+)/)
      if (!match) return

      resolved = true
      resolve(Number.parseInt(match[1]!, 10))
    }

    void pipeLines({
      child,
      stream: child.process.stdout,
      sink: readLine,
      write: (text) => process.stdout.write(text),
    })

    void pipeLines({
      child,
      stream: child.process.stderr,
      sink: readLine,
      write: (text) => process.stderr.write(text),
    })

    child.process.exited.then((exitCode) => {
      if (resolved) return
      reject(new Error(`[dev] cli exited before the backend became ready with code ${exitCode}`))
    })
  })

  return await Promise.race([
    portPromise,
    Bun.sleep(30_000).then(() => {
      throw new Error("[dev] Timed out waiting for backend startup")
    }),
  ])
}

async function stopProcesses(processes: TDevProcess[], exitCode: number): Promise<never> {
  for (const child of processes) {
    child.process.kill("SIGTERM")
  }

  await Promise.race([
    Promise.allSettled(processes.map((child) => child.process.exited)),
    Bun.sleep(2_000),
  ])

  for (const child of processes) {
    if (child.process.exitCode === null) {
      child.process.kill("SIGKILL")
    }
  }

  process.exit(exitCode)
}

const backendPort = parsePortEnv("VIBECANVAS_BACKEND_PORT", 3000)
const frontendPort = parsePortEnv("VIBECANVAS_FRONTEND_PORT", 3002)
const leases: TPortLease[] = []
const processes: TDevProcess[] = []
let stopping = false

function releaseLeases(): void {
  for (const lease of leases) {
    lease.release()
  }
}

async function shutdown(exitCode: number): Promise<void> {
  if (stopping) return
  stopping = true
  releaseLeases()
  await stopProcesses(processes, exitCode)
}

process.on("SIGINT", () => {
  void shutdown(130)
})

process.on("SIGTERM", () => {
  void shutdown(143)
})

process.on("exit", releaseLeases)

try {
  const backendLease = await acquirePortLease("backend", backendPort)
  leases.push(backendLease)

  const cliProcess = spawnDevProcess({
    name: "cli",
    cwd: cliDir,
    cmd: [bunExec, "run", "--watch", "./src/main.ts", "serve", "--port", String(backendLease.port)],
    env: {
      NODE_ENV: "development",
      VIBECANVAS_CHANNEL: "dev",
      VIBECANVAS_COMPILED: "false",
      VIBECANVAS_VERSION: "0.0.0",
    },
    output: "pipe",
  })
  processes.push(cliProcess)

  const actualBackendPort = await waitForBackendPort(cliProcess)
  const frontendLease = await acquirePortLease("frontend", frontendPort)
  leases.push(frontendLease)

  const backendTarget = `http://127.0.0.1:${actualBackendPort}`

  console.log(`[dev] Backend: ${backendTarget}`)
  console.log(`[dev] Frontend: http://127.0.0.1:${frontendLease.port}`)
  console.log(`[dev] Frontend proxy target: ${backendTarget}`)

  processes.push(spawnDevProcess({
    name: "frontend",
    cwd: frontendDir,
    cmd: [bunExec, "run", "dev", "--", "--host", "127.0.0.1", "--port", String(frontendLease.port), "--strictPort"],
    env: {
      VIBECANVAS_BACKEND_HOST: "127.0.0.1",
      VIBECANVAS_BACKEND_PORT: String(actualBackendPort),
      VIBECANVAS_FRONTEND_PORT: String(frontendLease.port),
    },
  }))

  processes.push(spawnDevProcess({
    name: "web",
    cwd: webDir,
    cmd: [bunExec, "run", "dev"],
    // Astro 7 otherwise detaches automatically when it detects an agentic
    // environment, which makes this supervisor think the web process exited.
    env: { ASTRO_DEV_BACKGROUND: "1" },
  }))

  for (const child of processes) {
    child.process.exited.then((exitCode) => {
      if (stopping) return
      console.error(`[dev] ${child.name} exited with code ${exitCode}`)
      void shutdown(exitCode === 0 ? 0 : exitCode || 1)
    })
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  if (processes.length > 0) {
    await shutdown(1)
  }
  releaseLeases()
  process.exit(1)
}
