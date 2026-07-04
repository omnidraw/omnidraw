export type TDirent = {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
};

export type TPortalWalkFiles = {
  readdir: (path: string, options: { withFileTypes: true }) => Promise<TDirent[]>;
  join: (...paths: string[]) => string;
  relative: (from: string, to: string) => string;
};

export type TArgsWalkFiles = {
  root: string;
  current?: string;
};

export async function fxWalkFiles(portal: TPortalWalkFiles, args: TArgsWalkFiles): Promise<string[]> {
  const current = args.current ?? args.root;
  const entries = await portal.readdir(current, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name === '.vibecanvas-wizard') {
      continue;
    }

    const absPath = portal.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...await fxWalkFiles(portal, { root: args.root, current: absPath }));
      continue;
    }

    if (entry.isFile()) {
      files.push(portal.relative(args.root, absPath));
    }
  }

  return files;
}
