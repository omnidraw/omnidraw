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

const RECURSIVELY_EXCLUDED_DIRECTORY_NAMES = new Set([
  '.git',
  'node_modules',
]);

const ROOT_EXCLUDED_DIRECTORY_NAMES = new Set([
  '.cache',
  '.next',
  '.output',
  '.turbo',
  '.vite',
  '.omnidraw',
  '.omnidraw-wizard',
  'build',
  'coverage',
  'dist',
  'out',
  'temp',
  'tmp',
]);

function isExcludedDirectory(name: string, atRoot: boolean): boolean {
  return RECURSIVELY_EXCLUDED_DIRECTORY_NAMES.has(name)
    || (
      atRoot
      && (
        ROOT_EXCLUDED_DIRECTORY_NAMES.has(name)
        || name.startsWith('.publish-backup-')
        || name.startsWith('.publish-staging-')
      )
    );
}

export async function fxWalkFiles(portal: TPortalWalkFiles, args: TArgsWalkFiles): Promise<string[]> {
  const current = args.current ?? args.root;
  const atRoot = current === args.root;
  const entries = (await portal.readdir(current, { withFileTypes: true }))
    .toSorted((left, right) => (
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    ));
  const files: string[] = [];

  for (const entry of entries) {
    const absPath = portal.join(current, entry.name);
    if (entry.isDirectory()) {
      if (isExcludedDirectory(entry.name, atRoot)) continue;
      files.push(...await fxWalkFiles(portal, { root: args.root, current: absPath }));
      continue;
    }

    if (entry.isFile()) {
      files.push(portal.relative(args.root, absPath));
    }
  }

  return files;
}
