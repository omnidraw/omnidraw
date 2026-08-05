import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { txRetireLegacyAgentDrafts } from '../src/services/tx.retire-legacy-agent-drafts';

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const portal = { readdirSync, mkdirSync, renameSync, join };

async function createHome() {
  const root = await mkdtemp(join(tmpdir(), 'omnidraw-retire-drafts-'));
  roots.push(root);
  return {
    agentRoot: join(root, 'agent'),
    trashRoot: join(root, 'widgets', '.trash'),
  };
}

describe('txRetireLegacyAgentDrafts', () => {
  test('moves the obsolete agent-private drafts root into the widget trash', async () => {
    const home = await createHome();
    const legacy = join(home.agentRoot, 'pi', 'agent', 'widgets', 'drafts');
    await mkdir(join(legacy, 'Hello App'), { recursive: true });
    await writeFile(join(legacy, 'Hello App', 'omnidraw.json'), '{}');

    const retired = txRetireLegacyAgentDrafts(portal, { ...home, token: '20260805' });

    expect(retired).toBe(true);
    expect(readdirSync(join(home.trashRoot, 'legacy-agent-drafts-20260805'))).toEqual(['Hello App']);
    expect(() => readdirSync(legacy)).toThrow();
  });

  test('does nothing when the legacy drafts root is absent or empty', async () => {
    const home = await createHome();
    expect(txRetireLegacyAgentDrafts(portal, { ...home, token: 'x' })).toBe(false);

    const legacy = join(home.agentRoot, 'pi', 'agent', 'widgets', 'drafts');
    await mkdir(legacy, { recursive: true });
    expect(txRetireLegacyAgentDrafts(portal, { ...home, token: 'x' })).toBe(false);
    expect(readdirSync(legacy)).toEqual([]);
  });
});
