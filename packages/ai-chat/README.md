# `@vibecanvas/ai-chat`

This package owns the AI Chat surface, AI canvas widget, generic widget host/runtime, published-widget discovery, workspace Sidebar, widget catalog/detail UI, and ToolIconPicker.

Canvas remains the drawing runtime. Integration is one-way: the frontend creates `createAiChatCanvasExtension(...)` and passes it to `Canvas`; `@vibecanvas/canvas` does not import this package.

## Public composition

- `createAiChatCanvasExtension` adapts injected chat/widget/browser/application ports to the public canvas extension contract.
- `Sidebar`, `WidgetCatalogProvider`, and `WidgetDetailPage` receive a `TSidebarController` from the frontend composition edge.
- `createCatalogInvalidation` is the typed resource, toolbar-group, and widget refresh channel shared by those adapters.
- `AiChat` and `WidgetManagerService` are exported for focused embedding and tests.

Production adapters live in `apps/frontend/src/ai-chat-adapters.ts`. Package source must not import frontend aliases, router hooks, stores, service singletons, or browser globals. Add browser, transport, navigation, cache, notification, theme, and invalidation effects to the narrow ports in `src/ports.ts` or `src/sidebar/ports.ts` instead.

## Lifecycle

The canvas extension registers the widget manager service and AI/published-widget plugins before scene hydration. Runtime shutdown stops actor iterators and reconnect timers, removes widget DOM portals and Solid roots, unregisters tools, and releases extension cleanup in reverse install order.

## Tests

Run `bun --filter @vibecanvas/ai-chat test`. Tests use jsdom and in-memory ports; they require neither the frontend singleton graph nor a server. `tests/canvas-extension` covers canvas composition and teardown, while `tests/boundaries` enforces the dependency and global-effect boundaries.
