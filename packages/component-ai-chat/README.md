# `@omnidraw/component-ai-chat`

Portable Solid AI Chat UI for Omnidraw hosts.

The package owns its request, action, stream, completion, cancellation, and
error DTOs. Hosts inject an `IAiChatPort` and translate their private transport
messages at the application boundary. The public interface exposes no Effect,
RPC, provider, database, or application-owned types.

```ts
import { AiChat } from "@omnidraw/component-ai-chat";
import "@omnidraw/component-ai-chat/styles.css";
```

The implementation uses Effect internally to own streaming cancellation and
lifecycle. Solid is a peer dependency so a host and the component always share
one reactive runtime.

`createAiChatCanvasExtension` owns the canonical `kind: "ai-chat"` Canvas
contribution. Its node payload durably stores the current session, model, and
thinking level plus its protected-operation approval policy. New chats start in
manual mode. The injected port may expose `subscribeReconnect` so each mounted
component can reinstall that exact chat-scoped semantic intent after a
transport generation changes.
