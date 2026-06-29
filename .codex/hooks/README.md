# Codex hooks

This repo defines project-local Codex hooks in `.codex/hooks.json`.

Codex only runs project hooks after the project `.codex/` layer and exact hook definitions are trusted. In Codex CLI, use `/hooks` to inspect, review, trust, or disable the configured hooks after changes.

## functional-core hooks

- `functional-core-session-start.ts` emits the shared `fn.*.ts`, `fx.*.ts`, and `tx.*.ts` rules from `.pi/extensions/functional-core/core/checks.ts`.
- `functional-core-eslint.ts` runs the canonical `bun run lint:functional-core` command and returns concise ESLint output to Codex.

Codex currently wires this through the available `PostToolUse` project hook for `Edit`, `Write`, and `apply_patch` events. The hook no longer preflights or blocks edits; it reports ESLint failures back into the agent flow after the tool sequence.

ESLint is the source of truth. Use normal ESLint disable comments with a reason for intentional legacy or dirty boundaries:

```ts
// eslint-disable-next-line functional-core/import-boundary -- temporary bridge to legacy runtime API
import { legacyRuntime } from "../legacy";
```

## Smoke tests

```bash
bun run .codex/hooks/functional-core-session-start.ts
bun run lint:functional-core
bun run lint:functional-core:agent
```
