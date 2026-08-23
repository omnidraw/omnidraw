#!/usr/bin/env bun

/** Build one plain TypeScript library and finalize its standalone dist package. */

import { rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const packageDirectory = resolve(process.cwd())
const outputDirectory = join(packageDirectory, 'dist')
const project = process.argv[2] ?? 'tsconfig.build.json'

await rm(outputDirectory, { recursive: true, force: true })

const typescriptPackagePath = Bun.resolveSync(
  'typescript/package.json',
  join(import.meta.dir, '..', 'packages', 'sdk', 'package.json'),
)
const tscPath = join(dirname(typescriptPackagePath), 'bin', 'tsc')
const compile = Bun.spawn(['bun', tscPath, '-p', project], {
  cwd: packageDirectory,
  stdin: 'ignore',
  stdout: 'inherit',
  stderr: 'inherit',
})
const compileExitCode = await compile.exited
if (compileExitCode !== 0) process.exit(compileExitCode)

const prepare = Bun.spawn(['bun', join(import.meta.dir, 'prepare-package-dist.ts')], {
  cwd: packageDirectory,
  stdin: 'ignore',
  stdout: 'inherit',
  stderr: 'inherit',
})
process.exit(await prepare.exited)
