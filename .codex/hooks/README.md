# Codex hooks

This repo defines project-local Codex hooks in `.codex/hooks.json`.

Codex only runs project hooks after the project `.codex/` layer and exact hook definitions are trusted. In Codex CLI, use `/hooks` to inspect, review, trust, or disable the configured hooks after changes.

## functional-core hooks

- `functional-core-session-start.ts` emits the shared `fn.*.ts`, `fx.*.ts`, and `tx.*.ts` rules from `.pi/extensions/functional-core/core/checks.ts`.
- `functional-core-post-tool-use.ts` validates edited `fn.*.ts`, `fx.*.ts`, and `tx.*.ts` paths exposed by the hook payload using `.pi/extensions/functional-core/core/lint.ts`.

The PostToolUse hook intentionally validates only paths exposed by the hook payload. It does not run the full repo lint because this repo currently has existing unrelated functional-core violations.

## Smoke tests

```bash
bun run .codex/hooks/functional-core-session-start.ts
printf '%s\n' '{"tool_input":{"path":"packages/canvas/src/core/fn.pretext.ts"}}' | bun run .codex/hooks/functional-core-post-tool-use.ts
printf '%s\n' '{"tool_input":{"path":"packages/api-pty/src/core/fn.extension-from-pty-image-format.ts"}}' | bun run .codex/hooks/functional-core-post-tool-use.ts
```
