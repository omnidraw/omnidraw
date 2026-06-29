/* eslint-disable functional-core/export-shape, functional-core/no-runtime-globals -- legacy fx file exports error constants and uses Response for stream decoding */
import type { join } from "path";

export const ErrorCodes = {
  FILE_TREE_PATH_NOT_FOUND: "FX.PROJECT_FS.FILE_TREE.PATH_NOT_FOUND",
  FILE_TREE_EXEC_FAILED: "FX.PROJECT_FS.FILE_TREE.EXEC_FAILED",
} as const satisfies Record<string, TErrorCode>;

export type TPortal = {
  bun: {
    spawn: typeof Bun.spawn;
  };
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
  spawn: typeof Bun.spawn,
  cmd: string[],
  cwd: string
): Promise<{ stdout: string; exitCode: number }> {
  const proc = spawn(cmd, { cwd, stdout: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return { stdout, exitCode: proc.exitCode ?? 0 };
}

export async function fxProjectFsFileTree(
  portal: TPortal,
  args: TArgs
): Promise<TErrTuple<TFileTree>> {
  const { projectRoot } = args;

  // Check if projectRoot exists
  const rootExists = await portal.fs.exists(projectRoot);
  if (!rootExists) {
    return [
      null,
      {
        code: ErrorCodes.FILE_TREE_PATH_NOT_FOUND,
        statusCode: 404,
        externalMessage: { en: "Project root path not found" },
      },
    ];
  }

  // Check if it's a git repo
  const gitDirPath = portal.fs.join(projectRoot, ".git");
  const isGitRepo = await portal.fs.exists(gitDirPath);

  let files: string[];

  if (isGitRepo) {
    // Use git ls-files for git repos (respects .gitignore)
    const [trackedResult, untrackedResult] = await Promise.all([
      runCommand(portal.bun.spawn, ["git", "ls-files"], projectRoot),
      runCommand(
        portal.bun.spawn,
        ["git", "ls-files", "--others", "--exclude-standard"],
        projectRoot
      ),
    ]);

    if (trackedResult.exitCode !== 0 || untrackedResult.exitCode !== 0) {
      return [
        null,
        {
          code: ErrorCodes.FILE_TREE_EXEC_FAILED,
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
      portal.bun.spawn,
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
          code: ErrorCodes.FILE_TREE_EXEC_FAILED,
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
