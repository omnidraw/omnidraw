# Codex hooks

This repo defines project-local Codex hooks in `.codex/hooks.json`.

Codex only runs project hooks after the project `.codex/` layer and exact hook definitions are trusted. In Codex CLI, use `/hooks` to inspect, review, trust, or disable the configured hooks after changes.

## worktree branch hook

`worktree-branch-session-start.ts` runs only for a new session startup. When the
session is in a linked Git worktree with a detached HEAD, it adds this developer
context before Codex starts work:

> create a new branch name codex/\<planNo\> or codex/\<task description\>

Codex-managed worktrees start with a detached HEAD. Existing branch-backed
worktrees and the repository's main checkout do not receive the instruction.

## Smoke tests

```bash
bun run .codex/hooks/worktree-branch-session-start.ts
```
