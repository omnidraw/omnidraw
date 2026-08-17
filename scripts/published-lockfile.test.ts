import { describe, expect, test } from 'bun:test'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  assertCommittedLockfileUsesPublicNpm,
  assertQualificationPackagesPublished,
} from './check-published-lockfile'
import { EXACT_QUALIFICATION_VERSIONS } from './public-packages'
import {
  explainLocalLockfileUrls,
  explainUnpublishedPackage,
  localRegistryTarballUrls,
  publicPackageMetadataUrl,
  restorePublishedLockfileUrls,
} from './published-lockfile.mjs'

const ROOT = resolve(import.meta.dir, '..')

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

describe('committed lockfile public-npm policy', () => {
  test('finds and restores local Verdaccio tarball URLs', () => {
    const lockfile = [
      '    "@omnidraw/cangine": ["@omnidraw/cangine@0.6.1", "http://127.0.0.1:4873/@omnidraw/cangine/-/cangine-0.6.1.tgz", {}, "sha512-aaa=="],',
      '    "@omnidraw/capsule": ["@omnidraw/capsule@0.16.0", "http://127.0.0.1:4873/@omnidraw/capsule/-/capsule-0.16.0.tgz", {}, "sha512-bbb=="],',
    ].join('\n')

    expect(localRegistryTarballUrls(lockfile)).toEqual([
      'http://127.0.0.1:4873/@omnidraw/cangine/-/cangine-0.6.1.tgz',
      'http://127.0.0.1:4873/@omnidraw/capsule/-/capsule-0.16.0.tgz',
    ])
    expect(restorePublishedLockfileUrls(lockfile)).toContain(
      '"@omnidraw/cangine": ["@omnidraw/cangine@0.6.1", "", {}, "sha512-aaa=="]',
    )
    expect(localRegistryTarballUrls(restorePublishedLockfileUrls(lockfile))).toEqual([])
  })

  test('explains why CI refuses a local-registry lockfile', () => {
    const message = explainLocalLockfileUrls([
      'http://127.0.0.1:4873/@omnidraw/cangine/-/cangine-0.6.1.tgz',
    ])
    expect(message).toContain('ConnectionRefused')
    expect(message).toContain('git hooks strip these URLs')
    expect(message).not.toContain('link:local:reset')
  })

  test('explains an unpublished qualification package as a justified CI failure', () => {
    const message = explainUnpublishedPackage('@omnidraw/capsule', '0.99.0')
    expect(message).toContain('@omnidraw/capsule@0.99.0 is not published')
    expect(message).toContain('CI installs only published versions')
    expect(message).toContain('bun run link:local -- capsule')
    expect(message).toContain('Publish @omnidraw/capsule@0.99.0 from the capsule repository')
    expect(message).not.toContain('Do not commit')
  })

  test('rejects a lockfile that still points at loopback Verdaccio', async () => {
    await expect(assertCommittedLockfileUsesPublicNpm(
      '"@omnidraw/cangine": ["@omnidraw/cangine@0.6.1", "http://127.0.0.1:4873/@omnidraw/cangine/-/cangine-0.6.1.tgz", {}, "sha512-aaa=="]',
    )).rejects.toThrow('Committed bun.lock points at the local Verdaccio registry')
  })

  test('treats a public-registry 404 as an unpublished qualification package', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      expect(String(input)).toBe(publicPackageMetadataUrl('@omnidraw/cangine', '0.6.1'))
      return new Response('Not Found', { status: 404 })
    }
    await expect(assertQualificationPackagesPublished({
      fetchImpl,
      packages: {
        '@omnidraw/cangine': '0.6.1',
        '@omnidraw/capsule': '0.16.0',
      },
    })).rejects.toThrow('is not published')
  })

  test('accepts published qualification packages from public npm', async () => {
    const seen: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      seen.push(String(input))
      return new Response('{}', { status: 200 })
    }
    await assertQualificationPackagesPublished({
      fetchImpl,
      packages: EXACT_QUALIFICATION_VERSIONS,
    })
    expect(seen).toEqual([
      publicPackageMetadataUrl('@omnidraw/cangine', EXACT_QUALIFICATION_VERSIONS['@omnidraw/cangine']),
      publicPackageMetadataUrl('@omnidraw/capsule', EXACT_QUALIFICATION_VERSIONS['@omnidraw/capsule']),
    ])
  })

  test('the working-tree lockfile uses public npm unless link:local is active', async () => {
    if (await pathExists(join(ROOT, '.npmrc'))) return
    const lockfile = await readFile(join(ROOT, 'bun.lock'), 'utf8')
    expect(localRegistryTarballUrls(lockfile)).toEqual([])
  })
})
