#!/usr/bin/env bun

import { resolve } from 'node:path';
import { sealSourceReleaseBuild } from '../apps/backend/src/shell/release/source-release-build';

const repositoryRoot = resolve(import.meta.dir, '..');
const receipt = await sealSourceReleaseBuild(repositoryRoot);
console.log(`[source-release] sealed ${receipt.outputs.length} built files for build-free startup.`);
