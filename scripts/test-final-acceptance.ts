#!/usr/bin/env bun

/** Runs the complete final repository and packed-release acceptance surface. */

import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

type TAcceptanceSuite = Readonly<{
  name: string
  command: readonly string[]
}>

const ROOT = resolve(import.meta.dir, '..')
const cleanSnapshot = Bun.argv.slice(2).includes('--clean-snapshot')
const unknown = Bun.argv.slice(2).filter((argument) => argument !== '--clean-snapshot')
if (unknown.length > 0) throw new Error(`Unknown final-acceptance arguments: ${unknown.join(', ')}`)
if (cleanSnapshot && process.env.OMNIDRAW_CLEAN_TRACKED_SNAPSHOT !== '1') {
  throw new Error('--clean-snapshot is reserved for the immutable tracked Docker snapshot.')
}

async function runSuite(suite: TAcceptanceSuite, env: NodeJS.ProcessEnv): Promise<void> {
  console.log(`\n[final-acceptance] ${suite.name}`)
  const child = Bun.spawn([...suite.command], {
    cwd: ROOT,
    env,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`${suite.name} failed with exit code ${exitCode}`)
}

const acceptanceHome = await mkdtemp(join(tmpdir(), 'omnidraw-final-acceptance-home-'))
try {
  if ((await readdir(acceptanceHome)).length !== 0) {
    throw new Error(`Final-acceptance home was not empty: ${acceptanceHome}`)
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: process.env.CI ?? '1',
    OMNIDRAW_CLEAN_TRACKED_SNAPSHOT: cleanSnapshot ? '1' : process.env.OMNIDRAW_CLEAN_TRACKED_SNAPSHOT,
    OMNIDRAW_HOME: acceptanceHome,
    VITEST_MAX_WORKERS: process.env.VITEST_MAX_WORKERS ?? '2',
  }
  const suites: TAcceptanceSuite[] = []
  if (!cleanSnapshot) suites.push({ name: 'git whitespace gate', command: ['git', 'diff', '--check'] })
  suites.push(
    { name: 'complete workspace acceptance', command: ['bun', 'run', 'test'] },
    { name: 'standalone public package dists', command: ['bun', 'run', 'verify:package-dists'] },
  )
  for (const suite of suites) await runSuite(suite, env)
} finally {
  await rm(acceptanceHome, { recursive: true, force: true })
}

console.log('\n[final-acceptance] workspace, conformance, database, packed, and browser gates passed')
