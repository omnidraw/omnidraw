import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const APP_ROOT = resolve(import.meta.dir, '..');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )));
});

async function createDraft(): Promise<Readonly<{
  draftRoot: string;
  home: string;
}>> {
  const home = await mkdtemp(join(tmpdir(), 'omnidraw-widget-lab-'));
  temporaryDirectories.push(home);
  const widgetsRoot = join(home, 'widgets');
  await Promise.all([
    'drafts',
    'published',
    '.staging',
    '.preview',
    '.trash',
    '.quarantine',
  ].map((name) => mkdir(join(widgetsRoot, name), { recursive: true })));
  const draftRoot = join(widgetsRoot, 'drafts', 'fixture');
  await mkdir(join(draftRoot, 'ui'), { recursive: true });
  await writeFile(join(draftRoot, 'omnidraw.json'), `${JSON.stringify({
    $schema: 'https://omnidraw.dev/schemas/widget/v1.json',
    schemaVersion: 1,
    name: 'Fixture',
    slug: 'fixture',
    description: 'Widget debug lab fixture.',
    tool: { label: 'Fixture', group: null, priority: 0 },
    ui: { runtime: 'capsule', entry: 'ui/main.ts', apis: ['DOM'] },
  })}\n`);
  await writeFile(join(draftRoot, 'ui', 'main.ts'), 'document.body.textContent = "fixture";\n');
  return Object.freeze({ draftRoot, home });
}

async function inspect(home: string): Promise<Readonly<{
  exitCode: number;
  stderr: string;
  stdout: string;
}>> {
  const child = Bun.spawn([
    'bun',
    'run',
    'src/main.ts',
    '--home',
    home,
    'inspect',
    'fixture',
  ], {
    cwd: APP_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return Object.freeze({ exitCode, stdout, stderr });
}

describe('widget debug lab inspect', () => {
  test('ignores npm-generated links below root node_modules', async () => {
    const fixture = await createDraft();
    await mkdir(join(fixture.draftRoot, 'node_modules', '.bin'), { recursive: true });
    await symlink('../acorn/bin/acorn', join(fixture.draftRoot, 'node_modules', '.bin', 'acorn'));

    const result = await inspect(fixture.home);

    expect(result.exitCode, result.stderr).toBe(0);
    const observation = JSON.parse(result.stdout);
    expect(observation.slug).toBe('fixture');
    expect(observation.manifest.slug).toBe('fixture');
    expect(observation.manifestDigestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(observation.treeDigestSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test('still rejects an authored-tree symlink', async () => {
    const fixture = await createDraft();
    await symlink('/etc/passwd', join(fixture.draftRoot, 'ui', 'escape'));

    const result = await inspect(fixture.home);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Healthy widget draft 'fixture' was not found.");
  });
});
