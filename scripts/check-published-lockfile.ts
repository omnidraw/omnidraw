#!/usr/bin/env bun

/**
 * CI gate: committed bun.lock must not use the local registry, and the pinned
 * cangine/capsule versions must exist on the public npm registry.
 */

import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { readPublicPackageSet } from './public-packages'
import {
  explainLocalLockfileUrls,
  explainUnpublishedPackage,
  localRegistryTarballUrls,
  PUBLIC_NPM_REGISTRY,
  publicPackageMetadataUrl,
  QUALIFICATION_REGISTRY_PACKAGES,
} from './published-lockfile.mjs'

const ROOT = resolve(import.meta.dir, '..')
const LOCKFILE_PATH = join(ROOT, 'bun.lock')

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function assertCommittedLockfileUsesPublicNpm(lockfileText: string): Promise<void> {
  const urls = localRegistryTarballUrls(lockfileText)
  if (urls.length === 0) return
  throw new Error(explainLocalLockfileUrls(urls))
}

export async function assertQualificationPackagesPublished(args: Readonly<{
  fetchImpl?: typeof fetch
  packages: Readonly<Record<string, string>>
  registry?: string
}>): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch
  const registry = args.registry ?? PUBLIC_NPM_REGISTRY
  for (const name of QUALIFICATION_REGISTRY_PACKAGES) {
    const version = args.packages[name]
    if (typeof version !== 'string' || version === '') {
      throw new Error(`Qualification set is missing ${name}.`)
    }
    const url = publicPackageMetadataUrl(name, version, registry)
    let response: Response
    try {
      response = await fetchImpl(url)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `Could not reach ${url} to verify ${name}@${version} is published.\n${detail}`,
      )
    }
    if (response.status === 404) throw new Error(explainUnpublishedPackage(name, version))
    if (!response.ok) {
      throw new Error(
        `Public npm returned HTTP ${response.status} for ${name}@${version} at ${url}.`,
      )
    }
  }
}

async function main(): Promise<void> {
  const lockfileText = await readFile(LOCKFILE_PATH, 'utf8')
  await assertCommittedLockfileUsesPublicNpm(lockfileText)

  const packageSet = await readPublicPackageSet(ROOT)
  await assertQualificationPackagesPublished({
    packages: packageSet.qualification,
  })

  if (await pathExists(join(ROOT, '.npmrc'))) {
    console.log('[check-published-lockfile] gitignored .npmrc is present; local registry linking is fine.')
  }
  console.log(
    `[check-published-lockfile] bun.lock uses public npm; ${QUALIFICATION_REGISTRY_PACKAGES.join(' and ')} are published.`,
  )
}

if (import.meta.main) {
  await main()
}
