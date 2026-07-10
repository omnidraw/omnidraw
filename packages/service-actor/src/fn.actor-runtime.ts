import type {
    TActorActivity,
    TActorErrorHandler,
    TActorState,
    TResolvedActorStateConfig,
    TResolvedTransition,
} from "./core/types";

export type TActorFailurePhase = "startup.enter" | "state.exit" | "transition" | "state.enter" | "activity";

export function fnIsActorJobStale(args: {
    acceptedState: TActorState;
    currentState: TActorState;
    acceptedGeneration: number;
    currentGeneration: number;
}): boolean {
    return args.acceptedState !== args.currentState || args.acceptedGeneration !== args.currentGeneration;
}

export function fnGetActorStateTimeoutMessage(args: { messageNames: string[] }): { msgName: string; delayMs: number } | null {
    const entries = args.messageNames
        .map((msgName) => {
            const match = /^(?:timeout|timout):(\d+)ms$/.exec(msgName);
            if (!match) return null;
            return { msgName, delayMs: Number(match[1]) };
        })
        .filter((item): item is { msgName: string; delayMs: number } => item !== null && Number.isFinite(item.delayMs) && item.delayMs >= 0)
        .sort((left, right) => left.delayMs - right.delayMs);
    return entries[0] ?? null;
}

export function fnSelectActorErrorHandler(args: {
    phase: TActorFailurePhase;
    activity?: TActorActivity;
    transition?: TResolvedTransition;
    sourceState: TActorState;
    currentState: TActorState;
    states: Partial<Record<TActorState, TResolvedActorStateConfig>>;
}): TActorErrorHandler | undefined {
    if (args.phase === "activity") {
        return args.activity?.onError ?? args.states[args.currentState]?.onError;
    }
    if (args.phase === "state.exit" || args.phase === "transition") {
        return args.transition?.onError ?? args.states[args.sourceState]?.onError;
    }
    if (args.phase === "state.enter") {
        return args.transition?.onError ?? args.states[args.currentState]?.onError;
    }
    return args.states[args.currentState]?.onError;
}

export function fnSerializeActorError(error: Error & { code?: unknown }) {
    return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: typeof error.code === "string" || typeof error.code === "number" ? error.code : undefined,
    };
}

export function fnBuildActorErrorPayload(args: {
    phase: TActorFailurePhase;
    job: unknown;
    sourceState: TActorState;
    targetState?: TActorState;
    currentState: TActorState;
    error: Error;
}) {
    return {
        kind: "actor.error",
        phase: args.phase,
        job: args.job,
        sourceState: args.sourceState,
        targetState: args.targetState,
        currentState: args.currentState,
        error: fnSerializeActorError(args.error),
    };
}

export function fnGetActorFailureCode(phase: TActorFailurePhase): "ACTOR_ACTIVITY_FAILED" | "ACTOR_TRANSITION_FAILED" {
    return phase === "activity" ? "ACTOR_ACTIVITY_FAILED" : "ACTOR_TRANSITION_FAILED";
}
