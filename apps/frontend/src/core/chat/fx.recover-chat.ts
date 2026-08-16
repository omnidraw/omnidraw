import { Context, Effect } from "effect";
import type { TFrontendTransportFailure } from "../app/service.frontend-transport";

export type TChatScope = Readonly<{
  canvasId: string;
  componentId: string;
  sessionId: string;
  approvalPolicy:
    | Readonly<{ mode: "always-approve" | "manual" }>
    | Readonly<{
        mode: "ai-review";
        reviewerModel: Readonly<{ provider: string; modelId: string }>;
      }>;
}>;

export class ChatRecoveryBackend extends Context.Service<ChatRecoveryBackend, {
  connectReuse(scope: TChatScope): Effect.Effect<void, TFrontendTransportFailure>;
  history(scope: Pick<TChatScope, "componentId" | "sessionId">): Effect.Effect<readonly unknown[], TFrontendTransportFailure>;
}>()("omnidraw/frontend/core/chat/ChatRecoveryBackend") {}

export type TRecoveredChatEvent = Readonly<{
  kind: "recovered-history";
  componentId: string;
  sessionId: string;
  history: readonly unknown[];
}>;

/** Re-establishes backend session ownership before reading recovery history. */
export const fxRecoverChat = Effect.fn('fxRecoverChat')(function*(
  scope: TChatScope,
): Effect.fn.Return<TRecoveredChatEvent, TFrontendTransportFailure, ChatRecoveryBackend> {
  const backend = yield* ChatRecoveryBackend;
  yield* backend.connectReuse(scope);
  const history = yield* backend.history({
    componentId: scope.componentId,
    sessionId: scope.sessionId,
  });
  return Object.freeze({
    kind: "recovered-history" as const,
    componentId: scope.componentId,
    sessionId: scope.sessionId,
    history,
  });
});
