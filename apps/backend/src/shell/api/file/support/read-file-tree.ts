import type { join } from "path";

type TErrorCode = `${"FN" | "FX" | "TX" | "CTRL" | "API" | "SRV" | "CLI"}.${string}.${string}.${string}`;

type TFileTreeError = {
  code: TErrorCode;
  statusCode: 404 | 500;
  externalMessage: { en: string };
};

type TErrTuple<T> = [value: T, error: null] | [value: null, error: TFileTreeError];

const ERROR_CODES = {
  FILE_TREE_PATH_NOT_FOUND: "FX.PROJECT_FS.FILE_TREE.PATH_NOT_FOUND",
  FILE_TREE_EXEC_FAILED: "FX.PROJECT_FS.FILE_TREE.EXEC_FAILED",
} as const satisfies Record<string, TErrorCode>;

export type TEffects = {
  bun: {
    spawn: typeof Bun.spawn;
  };
  Response: typeof Response;
  fs: {
    exists: (path: string) => Promise<boolean>;
    join: typeof join;
  };
};

export type TArgs = {
  projectRoot: string;
};

type TFileTree = {
  projectRoot: string;
  files: string[];
};

async function runCommand(
  ResponseCtor: typeof Response,
  spawn: typeof Bun.spawn,
  cmd: string[],
  cwd: string
): Promise<{ stdout: string; exitCode: number }> {
  const proc = spawn(cmd, { cwd, stdout: "pipe" });
  const stdout = await new ResponseCtor(proc.stdout).text();
  await proc.exited;
  return { stdout, exitCode: proc.exitCode ?? 0 };
}

export async function readProjectFileTree(
  effects: TEffects,
  args: TArgs
): Promise<TErrTuple<TFileTree>> {
  const { projectRoot } = args;

  // Check if projectRoot exists
  const rootExists = await effects.fs.exists(projectRoot);
  if (!rootExists) {
    return [
      null,
      {
        code: ERROR_CODES.FILE_TREE_PATH_NOT_FOUND,
        statusCode: 404,
        externalMessage: { en: "Project root path not found" },
      },
    ];
  }

  // Check if it's a git repo
  const gitDirPath = effects.fs.join(projectRoot, ".git");
  const isGitRepo = await effects.fs.exists(gitDirPath);

  let files: string[];

  if (isGitRepo) {
    // Use git ls-files for git repos (respects .gitignore)
    const [trackedResult, untrackedResult] = await Promise.all([
      runCommand(effects.Response, effects.bun.spawn, ["git", "ls-files"], projectRoot),
      runCommand(
        effects.Response,
        effects.bun.spawn,
        ["git", "ls-files", "--others", "--exclude-standard"],
        projectRoot
      ),
    ]);

    if (trackedResult.exitCode !== 0 || untrackedResult.exitCode !== 0) {
      return [
        null,
        {
          code: ERROR_CODES.FILE_TREE_EXEC_FAILED,
          statusCode: 500,
          externalMessage: { en: "Failed to execute git ls-files" },
        },
      ];
    }

    const trackedFiles = trackedResult.stdout
      .split("\n")
      .filter((f) => f.length > 0);
    const untrackedFiles = untrackedResult.stdout
      .split("\n")
      .filter((f) => f.length > 0);

    files = [...new Set([...trackedFiles, ...untrackedFiles])];
  } else {
    // Fallback: use find for non-git repos
    const findResult = await runCommand(
      effects.Response,
      effects.bun.spawn,
      [
        "find",
        ".",
        "-type",
        "f",
        "-not",
        "-path",
        "*/node_modules/*",
        "-not",
        "-path",
        "*/.git/*",
      ],
      projectRoot
    );

    if (findResult.exitCode !== 0) {
      return [
        null,
        {
          code: ERROR_CODES.FILE_TREE_EXEC_FAILED,
          statusCode: 500,
          externalMessage: { en: "Failed to execute find command" },
        },
      ];
    }

    files = findResult.stdout
      .split("\n")
      .filter((f) => f.length > 0)
      .map((f) => (f.startsWith("./") ? f.slice(2) : f));
  }

  // Sort alphabetically
  files.sort((a, b) => a.localeCompare(b));

  return [
    {
      projectRoot,
      files,
    },
    null,
  ];
}
