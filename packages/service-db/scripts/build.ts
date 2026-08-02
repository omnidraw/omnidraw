#!/usr/bin/env bun

import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const packageDirectory = resolve(import.meta.dir, '..');
const sharedBuild = resolve(packageDirectory, '..', '..', 'scripts', 'build-typescript-package.ts');
const build = Bun.spawn(['bun', sharedBuild], {
  cwd: packageDirectory,
  stdin: 'ignore',
  stdout: 'inherit',
  stderr: 'inherit',
});
const exitCode = await build.exited;
if (exitCode !== 0) process.exit(exitCode);

const sourceMigrations = join(packageDirectory, 'src', 'migrations');
const outputMigrations = join(packageDirectory, 'dist', 'migrations');
await mkdir(outputMigrations, { recursive: true });
const migrationFiles = (await readdir(sourceMigrations))
  .filter((name) => name.endsWith('.sql'));
await Promise.all(migrationFiles.map((name) => (
  copyFile(join(sourceMigrations, name), join(outputMigrations, name))
)));
