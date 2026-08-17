import { describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installGitHooks, resolveGitDir } from './install-git-hooks.mjs'
import { sanitizeLockfileText } from './sanitize-published-lockfile.mjs'

describe('git hook lockfile sanitizer', () => {
  test('rewrites local Verdaccio tarball URLs in lockfile text', async () => {
    const dirty = '    "@omnidraw/cangine": ["@omnidraw/cangine@0.6.1", "http://127.0.0.1:4873/@omnidraw/cangine/-/cangine-0.6.1.tgz", {}, "sha512-aaa=="],'
    const { changed, restored } = await sanitizeLockfileText(dirty)
    expect(changed).toBe(true)
    expect(restored).toContain('["@omnidraw/cangine@0.6.1", "", {}, "sha512-aaa=="]')
    expect((await sanitizeLockfileText(restored)).changed).toBe(false)
  })
})

describe('git hook installer', () => {
  test('resolves a normal .git directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-git-hooks-'))
    const gitDir = join(root, '.git')
    await mkdir(gitDir)
    expect(await resolveGitDir(root)).toBe(gitDir)
  })

  test('resolves a linked worktree gitdir file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-git-worktree-'))
    await writeFile(join(root, '.git'), 'gitdir: /tmp/omnidraw.git/worktrees/task\n')
    expect(await resolveGitDir(root)).toBe('/tmp/omnidraw.git/worktrees/task')
  })

  test('copies executable pre-commit and pre-push hooks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-install-hooks-'))
    const sourceHooks = join(root, '.githooks')
    await mkdir(join(root, '.git', 'hooks'), { recursive: true })
    await mkdir(sourceHooks)
    for (const name of ['pre-commit', 'pre-push']) {
      const path = join(sourceHooks, name)
      await writeFile(path, `#!/bin/sh\necho ${name}\n`)
      await chmod(path, 0o644)
    }
    const result = await installGitHooks(root)
    expect(result.installed).toBe(true)
    const installed = await readFile(join(root, '.git', 'hooks', 'pre-commit'), 'utf8')
    expect(installed).toContain('pre-commit')
  })

  test('skips when there is no git checkout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'omnidraw-not-git-'))
    expect(await installGitHooks(root)).toEqual({
      installed: false,
      reason: 'not a git checkout',
    })
  })
})
