#!/usr/bin/env bun

function runGit(args: string[]): { exitCode: number; stdout: string } {
  const result = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "ignore",
  });

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString().trim(),
  };
}

function isDetachedLinkedWorktree(): boolean {
  const gitDir = runGit(["rev-parse", "--absolute-git-dir"]);
  const commonDir = runGit([
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);

  if (gitDir.exitCode !== 0 || commonDir.exitCode !== 0) {
    return false;
  }

  const head = runGit(["symbolic-ref", "--quiet", "HEAD"]);
  const isLinkedWorktree = gitDir.stdout !== commonDir.stdout;
  const isDetachedHead = head.exitCode !== 0;

  return isLinkedWorktree && isDetachedHead;
}

if (isDetachedLinkedWorktree()) {
  const context =
    "create a new branch name codex/<planNo> or codex/<task description>";

  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context,
    },
  })}\n`);
}
