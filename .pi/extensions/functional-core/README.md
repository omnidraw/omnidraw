# functional-core extension

Project-local functional-core guidance plus post-turn ESLint repair hooks.

## What it does

This extension enforces the shared rules for:
- `fn.*.ts`
- `fx.*.ts`
- `tx.*.ts`

ESLint is the source of truth for enforcement. The Pi adapter no longer blocks invalid `write` and `edit` tool calls before they hit disk. Instead, it adds optional prompt guidance and runs the canonical ESLint command after an agent turn finishes. If lint fails, Pi sends a follow-up repair message with concise ESLint output.

Shared `CONSTANTS.ts` and `GUARDS.ts` runtime imports stay allowed inside functional-core files. Normal ESLint disable comments are the escape hatch for intentionally dirty legacy code.

The reusable core has no Pi dependency. Use it from CLI tools, Codex hooks, or future adapters when you need:
- file detection for `fn.*.ts`, `fx.*.ts`, and `tx.*.ts`
- rule text and system-prompt snippets
- content validators and violation report formatting
- edit-preview helpers for applying proposed edits before validation
- lint path collection and report formatting

## Adapter/core boundary

Reusable modules live in `core/`:
- `core/checks.ts`: rules, path matching, validator functions, prompt snippets, and block report formatting
- `core/eslint.ts`: shared post-turn ESLint runner and agent-friendly report formatting
- `core/lint.ts`: repo path traversal, lint result objects, and lint report formatting
- `core/edit-preview.ts`: shared edit-preview builder used before validating edits
- `core/runtime-global-usage.ts`: direct runtime-global detection
- `core/text.ts`: parser/text masking helpers

Pi-specific behavior lives outside `core/`:
- `index.ts`: Pi extension entrypoint
- `pi-adapter.ts`: `ExtensionAPI` event registration, prompt guidance, post-turn ESLint, and loop guard
- `lib/blocked-tool-log.ts`: legacy blocked-call logging retained for compatibility with old tests and imports

Compatibility entrypoints remain:
- `fn-check.ts`
- `fx-check.ts`
- `tx-check.ts`
- `functional-core-lint.ts`

These files keep the old exports while delegating Pi registration to the post-turn adapter.

## Included checks

### fn.*.ts
- ignore `fn.*.test.ts` files
- exported functions must start with `fn`
- imports must be type-only unless imported module leaf starts with `fn.`, `fx.`, `tx.`, is exactly `CONSTANTS` or `GUARDS`, or the imported runtime binding name is UPPER_CASE / underscore style
- `CONSTANTS.ts` and `GUARDS.ts` imports are allowed for shared local constants and runtime guards
- UPPER_CASE runtime value imports like `THEME_STROKE_WIDTH_VALUE_MAP` are allowed from any module
- no direct use of runtime globals like `window`, `fetch`, `Bun`, `process`, `console`, `globalThis`
- do not export classes or other runtime values; only functions and types
- `portal` and `args` params are optional in `fn.*.ts` files; pure helpers may take direct domain args

### fx.*.ts
- ignore `fx.*.test.ts` files
- exported functions must start with `fx`
- imports must be type-only unless imported module leaf starts with `fn.`, `fx.`, is exactly `CONSTANTS` or `GUARDS`, or the imported runtime binding name is UPPER_CASE / underscore style
- `CONSTANTS.ts` and `GUARDS.ts` imports are allowed for shared local constants and runtime guards
- UPPER_CASE runtime value imports like `THEME_STROKE_WIDTH_VALUE_MAP` are allowed from any module
- no direct use of runtime globals like `window`, `fetch`, `Bun`, `process`, `console`, `globalThis`
- do not export classes or other runtime values; only functions and types
- exported `fx*` functions must have 1 or 2 params: required `portal`, optional `args`
- exported `fx*` functions: first param must be named `portal` and typed as `TPortal*`
- exported `fx*` functions: second param is optional; when present, it must be named `args` and typed; inline arg types are allowed

### tx.*.ts
- ignore `tx.*.test.ts` files
- exported functions must start with `tx`
- imports must be type-only unless imported module leaf starts with `fn.`, `fx.`, `tx.`, is exactly `CONSTANTS` or `GUARDS`, or the imported runtime binding name is UPPER_CASE / underscore style
- `CONSTANTS.ts` and `GUARDS.ts` imports are allowed for shared local constants and runtime guards
- UPPER_CASE runtime value imports like `THEME_STROKE_WIDTH_VALUE_MAP` are allowed from any module
- no direct use of runtime globals like `window`, `fetch`, `Bun`, `process`, `console`, `globalThis`
- do not export classes or other runtime values; only functions and types
- exported `tx*` functions must have 1 or 2 params: required `portal`, optional `args`
- exported `tx*` functions: first param must be named `portal` and typed as `TPortal*`
- exported `tx*` functions: second param is optional; when present, it must be named `args` and typed; inline arg types are allowed
- `tx.*.ts` may runtime-import `fn.*`, `fx.*`, `tx.*`, `CONSTANTS`, and `GUARDS`

## CONSTANTS, GUARDS, and UPPER_CASE import exceptions

All import forms from uppercase `CONSTANTS` are allowed, for example:

```ts
import MY_CONSTANTS from "./CONSTANTS";
import { a, b, c } from "./CONSTANTS";
import * as myconst from "../../folder/CONSTANTS";
```

All import forms from uppercase `GUARDS` are also allowed, for example:

```ts
import isEditorNode from "./GUARDS";
import { isEditorNode, isGroupNode } from "./GUARDS";
import * as guards from "../../folder/GUARDS";
```

The module leaf must be exactly `CONSTANTS` or `GUARDS`.

Use `GUARDS.ts` for runtime guard helpers like:
- `instanceof`
- identity / brand checks
- reusable narrowing helpers

`GUARDS.ts` functions may take whatever args they need. The `fn.*`, `fx.*`, and `tx.*` parameter-shape rules do not apply to `GUARDS.ts` because it is a separate file type.

If a functional-core file only needs a runtime class/value import for `instanceof` or identity checks, move that logic into `GUARDS.ts` and import the guard from there. The blocker now points to `GUARDS.ts` when it detects `instanceof` in a blocked file.

Runtime value imports are also allowed when the local imported binding name is UPPER_CASE / underscore style, for example:

```ts
import { THEME_STROKE_WIDTH_VALUE_MAP } from "@vibecanvas/service-theme";
import DEFAULT_THEME from "@vibecanvas/service-theme";
import * as THEME_VALUES from "@vibecanvas/service-theme";
import { themeMap as THEME_MAP } from "@vibecanvas/service-theme";
```

The allowed binding-name pattern is `^[A-Z0-9_]+$`.

## Layout

```text
.pi/extensions/
└── functional-core/
    ├── README.md
    ├── index.ts
    ├── pi-adapter.ts
    ├── fn-check.ts
    ├── fx-check.ts
    ├── tx-check.ts
    ├── functional-core-lint.ts
    ├── core/
    │   ├── checks.ts
    │   ├── edit-preview.ts
    │   ├── lint.ts
    │   ├── runtime-global-usage.ts
    │   └── text.ts
    ├── lib/
    │   ├── blocked-tool-log.ts
    │   ├── edit-preview.ts
    │   └── runtime-global-usage.ts
    └── tests/
        └── *.test.ts
```
