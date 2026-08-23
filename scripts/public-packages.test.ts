import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  APPLICATION_DIRECTORIES,
  EXACT_QUALIFICATION_VERSIONS,
  PUBLIC_PACKAGE_DIRECTORIES,
  PUBLIC_PACKAGE_NAMES,
  PUBLICATION_ORDER,
  readPublicPackageSet,
} from './public-packages'

describe('qualified public package set', () => {
  test('pins the five independent releases and exact qualification inputs', async () => {
    const packageSet = await readPublicPackageSet()
    expect(Object.keys(packageSet.packages).sort()).toEqual([...PUBLIC_PACKAGE_NAMES].sort())
    expect(packageSet.qualification).toEqual(EXACT_QUALIFICATION_VERSIONS)
    expect(packageSet.publicationOrder).toEqual(PUBLICATION_ORDER)
    expect(Object.values(PUBLIC_PACKAGE_DIRECTORIES)).toHaveLength(5)
    expect(APPLICATION_DIRECTORIES).toHaveLength(2)
  })

  test('rejects incomplete package sets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-public-package-set-'))
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'public-package-set.json'), JSON.stringify({
      format: 'omnidraw.public-package-set.v1',
      packages: { '@omnidraw/sdk': '1.0.0' },
      qualification: EXACT_QUALIFICATION_VERSIONS,
      publicationOrder: ['@omnidraw/sdk'],
    }))
    await expect(readPublicPackageSet(root)).rejects.toThrow('Qualified public packages must be exactly')
  })
})
