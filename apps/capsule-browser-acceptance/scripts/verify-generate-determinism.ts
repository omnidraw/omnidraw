#!/usr/bin/env bun

/** @file Proves two fresh acceptance-fixture generations are byte-identical. */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const generatorPath = join(import.meta.dir, 'generate.ts');
const fixturePath = join(import.meta.dir, '..', 'generated', 'fixtures.json');

async function generate(): Promise<void> {
  const child = Bun.spawn([process.execPath, generatorPath], {
    cwd: join(import.meta.dir, '..'),
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'inherit',
    env: process.env,
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`Acceptance fixture generation failed with exit code ${exitCode}.`);
  }
}

async function digest(): Promise<string> {
  return createHash('sha256').update(await readFile(fixturePath)).digest('hex');
}

await generate();
const first = await digest();
await generate();
const second = await digest();
if (first !== second) {
  throw new Error('Fresh acceptance fixture generations are not byte-identical.');
}
process.stdout.write(`Acceptance fixtures are deterministic (${second}).\n`);
