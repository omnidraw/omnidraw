export type TEffects = {
  readdir(path: string, options: { withFileTypes: true }): Promise<Array<{ name: string; isFile(): boolean }>>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, content: string, encoding: 'utf8'): Promise<unknown>;
  rename(from: string, to: string): Promise<unknown>;
  rm(path: string, options: { force: true }): Promise<unknown>;
  join(...parts: string[]): string;
};

export type TArgs = {
  sessionDir: string;
  cwd: string;
};

export async function normalizeSessionCwd(effects: TEffects, args: TArgs): Promise<number> {
  const entries = await effects.readdir(args.sessionDir, { withFileTypes: true }).catch(() => []);
  let normalized = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const path = effects.join(args.sessionDir, entry.name);
    const content = await effects.readFile(path, 'utf8').catch(() => null);
    if (content === null) continue;
    const lines = content.split('\n');
    let changed = false;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) continue;
      try {
        const value = JSON.parse(line) as { type?: unknown; cwd?: unknown };
        if (value.type !== 'session') continue;
        if (value.cwd !== args.cwd) {
          lines[index] = JSON.stringify({ ...value, cwd: args.cwd });
          changed = true;
        }
        break;
      } catch {
        break;
      }
    }
    if (!changed) continue;
    const temporary = `${path}.normalized-cwd.tmp`;
    try {
      await effects.writeFile(temporary, lines.join('\n'), 'utf8');
      await effects.rename(temporary, path);
      normalized += 1;
    } finally {
      await effects.rm(temporary, { force: true }).catch(() => undefined);
    }
  }
  return normalized;
}
