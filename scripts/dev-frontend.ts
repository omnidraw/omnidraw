#!/usr/bin/env bun
/**
 * @file Runs the frontend with live builds for its public UI dependencies.
 */

import path from "node:path"

const rootDir = path.resolve(import.meta.dir, "..")
const bunExec = process.execPath

type TDevProcess = {
  name: string
  process: ReturnType<typeof Bun.spawn>
}

function spawnDevProcess(args: {
  name: string
  cwd: string
  command: string[]
  output?: "inherit" | "pipe"
}): TDevProcess {
  console.log(`[dev] ${args.name}: ${args.command.join(" ")}`)
  return {
    name: args.name,
    process: Bun.spawn({
      cmd: args.command,
      cwd: args.cwd,
      env: process.env,
      stdin: "inherit",
      stdout: args.output ?? "inherit",
      stderr: args.output ?? "inherit",
    }),
  }
}

function readableProcessStream(value: unknown): ReadableStream<Uint8Array> | null {
  return value instanceof ReadableStream ? value as ReadableStream<Uint8Array> : null
}

async function pipeLines(args: {
  child: TDevProcess
  stream: ReadableStream<Uint8Array> | null
  onLine(line: string): void
  write(text: string): void
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
      args.onLine(line)
      args.write(`[${args.child.name}] ${line}\n`)
    }
  }
  if (buffer) {
    args.onLine(buffer)
    args.write(`[${args.child.name}] ${buffer}\n`)
  }
}

async function waitForInspectionReady(child: TDevProcess): Promise<void> {
  let ready = false
  const readiness = new Promise<void>((resolve, reject) => {
    const onLine = (line: string): void => {
      if (!line.includes("[inspection-shell] ready")) return
      ready = true
      resolve()
    }
    void pipeLines({
      child,
      stream: readableProcessStream(child.process.stdout),
      onLine,
      write: (text) => process.stdout.write(text),
    })
    void pipeLines({
      child,
      stream: readableProcessStream(child.process.stderr),
      onLine,
      write: (text) => process.stderr.write(text),
    })
    void child.process.exited.then((exitCode) => {
      if (!ready) reject(new Error(`[dev] inspection-shell exited before its verified build became ready with code ${exitCode}`))
    })
  })
  await Promise.race([
    readiness,
    Bun.sleep(60_000).then(() => { throw new Error("[dev] Timed out waiting for the verified inspection shell") }),
  ])
}

const frontendArgs = process.argv.slice(2)
const processes: TDevProcess[] = []
let stopping = false

async function stopProcesses(exitCode: number): Promise<never> {
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

async function shutdown(exitCode: number): Promise<void> {
  if (stopping) return
  stopping = true
  await stopProcesses(processes.length === 0 ? 1 : exitCode)
}

process.on("SIGINT", () => {
  void shutdown(130)
})

process.on("SIGTERM", () => {
  void shutdown(143)
})

try {
  const inspection = spawnDevProcess({
    name: "inspection-shell",
    cwd: path.join(rootDir, "apps/frontend"),
    command: [bunExec, "run", "dev:inspection:ready"],
    output: "pipe",
  })
  processes.push(inspection)
  await waitForInspectionReady(inspection)

  processes.push(spawnDevProcess({
    name: "canvas-contract",
    cwd: path.join(rootDir, "packages/canvas-contract"),
    command: [bunExec, "run", "dev"],
  }))
  processes.push(spawnDevProcess({
    name: "theme",
    cwd: path.join(rootDir, "packages/theme"),
    command: [bunExec, "run", "dev"],
  }))
  processes.push(spawnDevProcess({
    name: "canvas-bundle",
    cwd: path.join(rootDir, "packages/canvas"),
    command: [bunExec, "run", "dev:bundle"],
  }))
  processes.push(spawnDevProcess({
    name: "canvas-types",
    cwd: path.join(rootDir, "packages/canvas"),
    command: [bunExec, "x", "tsc", "-b", "tsconfig.dev.json", "--watch", "--preserveWatchOutput"],
  }))
  processes.push(spawnDevProcess({
    name: "ai-chat-bundle",
    cwd: path.join(rootDir, "packages/component-ai-chat"),
    command: [bunExec, "x", "vite", "build", "--watch", "--mode", "dev-watch"],
  }))
  processes.push(spawnDevProcess({
    name: "ai-chat-types",
    cwd: path.join(rootDir, "packages/component-ai-chat"),
    command: [bunExec, "x", "tsc", "-p", "tsconfig.dev.json", "--watch", "--preserveWatchOutput"],
  }))
  processes.push(spawnDevProcess({
    name: "frontend",
    cwd: path.join(rootDir, "apps/frontend"),
    command: [
      bunExec,
      "run",
      "dev",
      ...(frontendArgs.length > 0 ? ["--", ...frontendArgs] : []),
    ],
  }))

  const firstExit = await Promise.race(
    processes.map(async (child) => ({
      child,
      exitCode: await child.process.exited,
    })),
  )

  if (!stopping) {
    console.error(
      `[dev] ${firstExit.child.name} exited with code ${firstExit.exitCode}`,
    )
    await shutdown(firstExit.exitCode === 0 ? 0 : firstExit.exitCode || 1)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  await shutdown(1)
}
