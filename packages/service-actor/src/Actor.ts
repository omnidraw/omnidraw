/**
 * @file Runs one in-memory widget actor instance through a Bun child process.
 * @remarks Actor owns one serialized startup/input/activity lane plus state lifecycle scheduling.
 */

import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { join } from "node:path";
import type {
    TActorActivity,
    TActorData,
    TActorErrorHandler,
    TActorState,
    TFunctionName,
    TInputMessage,
    TJsonSchema,
    TResolvedTransition,
    TResolvedVibecanvasJson,
    TVibecanvasJson,
} from "./core/types";
import type { TActorStatus } from "@vibecanvas/service-db/model";
import { buildActorIpcCommand } from "./actor-ipc-command";
import { fnNormalizeVibecanvasJson } from "./core/fn.normalize-actor-manifest";
import {
    fnBuildActorErrorPayload,
    fnGetActorFailureCode,
    fnGetActorStateTimeoutMessage,
    fnIsActorJobStale,
    fnSelectActorErrorHandler,
    fnSerializeActorError,
    type TActorFailurePhase,
} from "./fn.actor-runtime";
import { toSafeActorResourceError } from './resources/ActorResourceError';
import type { TActorResourceCall, TActorResourceFunctionClass, TActorResourceGateway } from './resources/resource-types';

type TSnapshotCause = "startup" | "input" | "activity" | "error";

export type TActorSystemEvent =
    | { readonly kind: "system"; readonly actorId: string; readonly type: "ack"; readonly messageId: string; readonly inputName: string }
    | { readonly kind: "system"; readonly actorId: string; readonly type: "state.changed"; readonly from: TActorState; readonly to: TActorState; readonly messageId?: string }
    | { readonly kind: "system"; readonly actorId: string; readonly type: "status.changed"; readonly from: TActorStatus | null; readonly to: TActorStatus }
    | { readonly kind: "system"; readonly actorId: string; readonly type: "data.changed"; readonly data: TActorData; readonly messageId?: string }
    | { readonly kind: "system"; readonly actorId: string; readonly type: "snapshot"; readonly revision: number; readonly state: TActorState; readonly data: TActorData; readonly cause: TSnapshotCause; readonly jobId?: string }
    | { readonly kind: "system"; readonly actorId: string; readonly type: "error"; readonly code: string; readonly message: string; readonly details?: unknown; readonly messageId?: string };

export type TActorMessageEvent = {
    readonly kind: "actor";
    readonly actorId: string;
    readonly name: string;
    readonly payload: unknown;
    readonly messageId?: string;
};

export type TActorEvent = TActorSystemEvent | TActorMessageEvent;

type TActorSystemEventInput = TActorSystemEvent extends infer TEvent
    ? TEvent extends TActorSystemEvent
        ? Omit<TEvent, "kind" | "actorId">
        : never
    : never;

interface IActorConfig {
    readonly id: string
    readonly vsJson: TVibecanvasJson
    readonly rootDir: string
    readonly state?: TActorState
    readonly data?: TActorData
    readonly resourceGateway?: TActorResourceGateway
}

type TStartupJob = {
    readonly kind: "startup";
    readonly jobId: string;
};

type TInputJob = {
    readonly kind: "input";
    readonly source: "external" | "timeout";
    readonly jobId: string;
    readonly messageId: string;
    readonly msgName: TInputMessage;
    readonly msgPayload: unknown;
    readonly acceptedState: TActorState;
    readonly acceptedGeneration: number | null;
};

type TActivityJob = {
    readonly kind: "activity";
    readonly jobId: string;
    readonly state: TActorState;
    readonly generation: number;
    readonly tick: number;
    readonly scheduledAt: string;
};

type TActorJob = TStartupJob | TInputJob | TActivityJob;

type TActorChildMessage =
    | { type: "ready" }
    | { type: "next"; id: number }
    | { type: "setData"; id: number; data: TActorData }
    | { type: "emitMessage"; id: number; msg: unknown }
    | { type: "done"; id: number }
    | { type: "resourceCall"; id: number; callId: string; slot: string; kind: TActorResourceCall['kind']; operation: string; args: unknown }
    | { type: "error"; id?: number; msg: unknown }
    | { error: boolean; id?: number; msg: unknown };

type TRunMeta = {
    readonly jobId: string;
    readonly messageId?: string;
    readonly inputName?: string;
};

type TPendingRun = TRunMeta & {
    readonly resolve: () => void;
    readonly reject: (error: unknown) => void;
    readonly functionClasses: readonly TActorResourceFunctionClass[];
    activeFunctionIndex: number;
};

type TFailureContext = {
    readonly phase: TActorFailurePhase;
    readonly job: TActorJob;
    readonly sourceState: TActorState;
    readonly targetState?: TActorState;
    readonly transition?: TResolvedTransition;
    readonly activity?: TActorActivity;
    readonly deactivationStarted: boolean;
    readonly currentStateFullyActive: boolean;
};

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

export function compileJsonSchema(schema: TJsonSchema) {
    return ajv.compile(schema as object);
}

export class Actor {
    readonly #id: string;
    #state: TActorState;
    readonly #functionPath: string;
    readonly #rootDir: string;
    readonly #vsJson: TResolvedVibecanvasJson;
    readonly #definitionWarnings: string[];
    #inputMessage: Record<string, ValidateFunction<unknown>> = {};
    #outputMessage: Record<string, ValidateFunction<unknown>> = {};
    #data: TActorData;
    #proc: Bun.Subprocess | null = null;
    #queue: TActorJob[] = [];
    #isProcessing = false;
    #isChildReady = false;
    #isActivated = false;
    #didEmitRunning = false;
    #startupQueued = false;
    #isClosing = false;
    #childFailure: Error | null = null;
    #nextRunId = 1;
    #activationGeneration = 0;
    #activityTick = 0;
    #snapshotRevision = 0;
    #activityPendingGeneration: number | null = null;
    #pendingRuns = new Map<number, TPendingRun>();
    #listeners = new Set<(event: TActorEvent) => void>();
    #stateTimeout: ReturnType<typeof setTimeout> | null = null;
    #activityTimer: ReturnType<typeof setTimeout> | null = null;
    readonly #resourceGateway?: TActorResourceGateway;
    #readyWaiters = new Set<{ resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

    constructor(config: IActorConfig) {
        const normalized = fnNormalizeVibecanvasJson(config.vsJson);
        this.#id = config.id;
        this.#state = config.state ?? normalized.manifest.actor.initialState;
        this.#vsJson = normalized.manifest;
        this.#definitionWarnings = normalized.warnings;
        this.#data = config.data ?? normalized.manifest.actor.initialData;
        Object.entries(normalized.manifest.actor.inputMsgSchema ?? {}).forEach(([name, schema]) => {
            this.#inputMessage[name] = compileJsonSchema(schema);
        });
        Object.entries(normalized.manifest.actor.outputMsgSchema ?? {}).forEach(([name, schema]) => {
            this.#outputMessage[name] = compileJsonSchema(schema);
        });
        this.#rootDir = config.rootDir;
        this.#functionPath = join(config.rootDir, normalized.manifest.actor.relFunctionPath);
        this.#resourceGateway = config.resourceGateway;
    }

    start() {
        if (this.#proc) return;
        this.#isClosing = false;
        this.#childFailure = null;
        this.#startupQueued = false;
        this.#spawnActorFunctionsProcess();
    }

    #spawnActorFunctionsProcess() {
        const proc = Bun.spawn(buildActorIpcCommand({ functionPath: this.#functionPath }), {
            cwd: this.#rootDir,
            env: { ...process.env },
            stdout: "pipe",
            stderr: "pipe",
            ipc: (message) => {
                this.#handleChildMessage(message as TActorChildMessage);
            },
        });
        this.#proc = proc;

        void proc.exited.then((exitCode) => {
            this.#handleChildExit(exitCode);
        });

        proc.stdout?.pipeTo(new WritableStream({
            write(chunk) {
                process.stdout.write(chunk);
            },
        }));

        proc.stderr?.pipeTo(new WritableStream({
            write(chunk) {
                process.stderr.write(chunk);
            },
        }));
    }

    getId() {
        return this.#id;
    }

    getState() {
        return this.#state;
    }

    getData() {
        return this.#data;
    }

    getDefinitionWarnings() {
        return [...this.#definitionWarnings];
    }

    waitUntilReady(timeoutMs = 5_000): Promise<void> {
        if (this.#isActivated) return Promise.resolve();
        if (this.#childFailure) return Promise.reject(this.#childFailure);
        if (!this.#proc) return Promise.reject(new Error('Actor child process is not running'));

        return new Promise((resolve, reject) => {
            let waiter!: { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
            waiter = {
                resolve: () => {
                    clearTimeout(waiter.timer);
                    this.#readyWaiters.delete(waiter);
                    resolve();
                },
                reject: (error: Error) => {
                    clearTimeout(waiter.timer);
                    this.#readyWaiters.delete(waiter);
                    reject(error);
                },
                timer: setTimeout(() => waiter.reject(new Error(`Actor was not activated within ${timeoutMs}ms`)), timeoutMs),
            };
            this.#readyWaiters.add(waiter);
        });
    }

    isIdle() {
        const activationSettled = this.#proc === null || this.#isActivated;
        return activationSettled && !this.#isProcessing && this.#queue.length === 0 && this.#pendingRuns.size === 0;
    }

    inbox(msgName: string, msgPayload: unknown): string {
        const messageId = crypto.randomUUID();
        const validFn = this.#inputMessage[msgName];
        if (!validFn) {
            return this.#dropInboxMessage({
                messageId,
                msgName,
                msgPayload,
                code: "UNKNOWN_INPUT_MESSAGE",
                message: `Unknown message name ${msgName}. Allowed message name: ${JSON.stringify(Object.keys(this.#inputMessage))}`,
            });
        }
        if (!validFn(msgPayload)) {
            return this.#dropInboxMessage({
                messageId,
                msgName,
                msgPayload,
                code: "INVALID_INPUT_MESSAGE_PAYLOAD",
                message: "Invalid message payload.",
                details: validFn.errors,
            });
        }

        if (!this.#getTransition(msgName as TInputMessage)) {
            return this.#dropInboxMessage({
                messageId,
                msgName,
                msgPayload,
                code: "NO_STATE_TRANSITION",
                message: `No transition for message ${msgName} in state ${this.#state}`,
                details: { state: this.#state },
            });
        }

        this.#queue.push({
            kind: "input",
            source: "external",
            jobId: messageId,
            messageId,
            msgName: msgName as TInputMessage,
            msgPayload,
            acceptedState: this.#state,
            acceptedGeneration: this.#isActivated ? this.#activationGeneration : null,
        });
        void this.#processQueue();
        return messageId;
    }

    listen(cb: (event: TActorEvent) => void) {
        this.#listeners.add(cb);
        return () => this.#listeners.delete(cb);
    }

    close() {
        const wasRunning = this.#didEmitRunning;
        this.#isClosing = true;
        this.#isChildReady = false;
        this.#isActivated = false;
        this.#startupQueued = false;
        this.#clearSchedules();
        this.#queue = [];
        const closeError = new Error('Actor child process was closed');
        for (const waiter of [...this.#readyWaiters]) waiter.reject(closeError);
        this.#rejectPending(undefined, closeError);
        this.#proc?.kill();
        this.#proc = null;
        if (wasRunning) {
            this.#emitSystemEvent({ type: "status.changed", from: "running", to: "stopped" });
            this.#didEmitRunning = false;
        }
    }

    async closeAndWait(timeoutMs = 5_000): Promise<boolean> {
        const proc = this.#proc;
        this.close();
        if (!proc) return true;

        if (await this.#waitForExit(proc, timeoutMs)) return true;
        try {
            proc.kill(9);
        } catch {
            return false;
        }
        return this.#waitForExit(proc, Math.min(timeoutMs, 1_000));
    }

    #waitForExit(proc: Bun.Subprocess, timeoutMs: number): Promise<boolean> {
        return new Promise((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                resolve(false);
            }, timeoutMs);
            void proc.exited.then(() => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(true);
            }, () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(false);
            });
        });
    }

    #getTransition(msgName: TInputMessage): TResolvedTransition | null {
        return this.#vsJson.actor.states[this.#state]?.on[msgName] ?? null;
    }

    async #processQueue() {
        if (this.#isProcessing || !this.#isChildReady || this.#childFailure || this.#isClosing) return;
        this.#isProcessing = true;
        try {
            while (this.#isChildReady && !this.#childFailure && !this.#isClosing) {
                const job = this.#queue.shift();
                if (!job) break;
                if (job.kind === "startup") await this.#processStartup(job);
                if (job.kind === "input") await this.#processInput(job);
                if (job.kind === "activity") await this.#processActivity(job);
            }
        } finally {
            this.#isProcessing = false;
            if (this.#queue.length > 0 && this.#isChildReady && !this.#childFailure && !this.#isClosing) {
                void this.#processQueue();
            }
        }
    }

    async #processStartup(job: TStartupJob) {
        if (this.#isActivated) return;
        const startupState = this.#state;
        this.#emitSystemEvent({ type: "state.changed", from: "booting", to: startupState });
        this.#activationGeneration += 1;

        let recovered = false;
        let failed = false;
        try {
            await this.#runEnter(startupState, "booting", "startup", job.jobId);
            this.#scheduleForActiveState();
        } catch (error) {
            failed = true;
            recovered = await this.#handleFailure({
                phase: "startup.enter",
                job,
                sourceState: startupState,
                targetState: startupState,
                deactivationStarted: false,
                currentStateFullyActive: false,
            }, error);
        }

        if (this.#isClosing) return;

        this.#emitSnapshot(failed && !recovered ? "error" : "startup", job.jobId);
        this.#isActivated = true;
        if (!this.#didEmitRunning) {
            this.#didEmitRunning = true;
            this.#emitSystemEvent({ type: "status.changed", from: null, to: "running" });
        }
        for (const waiter of [...this.#readyWaiters]) waiter.resolve();
    }

    async #processInput(job: TInputJob) {
        const generation = job.acceptedGeneration ?? this.#activationGeneration;
        const stale = fnIsActorJobStale({
            acceptedState: job.acceptedState,
            currentState: this.#state,
            acceptedGeneration: generation,
            currentGeneration: this.#activationGeneration,
        });
        if (stale) {
            if (job.source === "external") {
                this.#dropInboxMessage({
                    messageId: job.messageId,
                    msgName: job.msgName,
                    msgPayload: job.msgPayload,
                    code: "STALE_STATE_MESSAGE",
                    message: `Message ${job.msgName} was accepted in state ${job.acceptedState} but actor is now in ${this.#state}`,
                    details: { acceptedState: job.acceptedState, currentState: this.#state },
                });
            }
            return;
        }

        const transition = this.#getTransition(job.msgName);
        if (!transition) {
            if (job.source === "external") {
                this.#dropInboxMessage({
                    messageId: job.messageId,
                    msgName: job.msgName,
                    msgPayload: job.msgPayload,
                    code: "NO_STATE_TRANSITION",
                    message: `No transition for message ${job.msgName} in state ${this.#state}`,
                    details: { state: this.#state },
                });
            }
            return;
        }

        const sourceState = this.#state;
        const targetState = transition.targetState;
        if (sourceState === targetState) {
            try {
                await this.#runPipeline(transition.func, job.msgPayload, this.#metaForInput(job));
                this.#ackInput(job);
                this.#emitSnapshot("input", job.jobId);
            } catch (error) {
                await this.#finishInputFailure(job, transition, {
                    phase: "transition",
                    job,
                    sourceState,
                    targetState,
                    transition,
                    deactivationStarted: false,
                    currentStateFullyActive: true,
                }, error);
            }
            return;
        }

        this.#beginDeactivation();
        try {
            await this.#runExit(sourceState, targetState, "transition", job.jobId);
        } catch (error) {
            await this.#finishInputFailure(job, transition, {
                phase: "state.exit",
                job,
                sourceState,
                targetState,
                transition,
                deactivationStarted: true,
                currentStateFullyActive: false,
            }, error);
            return;
        }

        try {
            await this.#runPipeline(transition.func, job.msgPayload, this.#metaForInput(job));
        } catch (error) {
            await this.#finishInputFailure(job, transition, {
                phase: "transition",
                job,
                sourceState,
                targetState,
                transition,
                deactivationStarted: true,
                currentStateFullyActive: false,
            }, error);
            return;
        }

        this.#applyState(targetState, job.messageId);
        this.#activationGeneration += 1;
        try {
            await this.#runEnter(targetState, sourceState, "transition", job.jobId, job.messageId);
            this.#scheduleForActiveState();
        } catch (error) {
            await this.#finishInputFailure(job, transition, {
                phase: "state.enter",
                job,
                sourceState,
                targetState,
                transition,
                deactivationStarted: true,
                currentStateFullyActive: false,
            }, error);
            return;
        }

        this.#ackInput(job);
        this.#emitSnapshot("input", job.jobId);
    }

    async #finishInputFailure(job: TInputJob, transition: TResolvedTransition, context: TFailureContext, error: unknown) {
        const recovered = await this.#handleFailure({ ...context, transition }, error);
        if (this.#isClosing) return;
        if (recovered) this.#ackInput(job);
        this.#emitSnapshot(recovered ? "input" : "error", job.jobId);
    }

    async #processActivity(job: TActivityJob) {
        if (job.state !== this.#state || job.generation !== this.#activationGeneration) {
            if (this.#activityPendingGeneration === job.generation) this.#activityPendingGeneration = null;
            return;
        }

        const activity = this.#vsJson.actor.states[job.state]?.activity;
        if (!activity) {
            if (this.#activityPendingGeneration === job.generation) this.#activityPendingGeneration = null;
            return;
        }

        let successful = false;
        let recovered = false;
        try {
            await this.#runPipeline(activity.func, {
                kind: "activity.tick",
                state: job.state,
                generation: job.generation,
                tick: job.tick,
                scheduledAt: job.scheduledAt,
            }, { jobId: job.jobId });
            successful = true;
        } catch (error) {
            recovered = await this.#handleFailure({
                phase: "activity",
                job,
                sourceState: job.state,
                targetState: job.state,
                activity,
                deactivationStarted: false,
                currentStateFullyActive: true,
            }, error);
        } finally {
            if (this.#activityPendingGeneration === job.generation) this.#activityPendingGeneration = null;
        }

        if (this.#isClosing) return;
        this.#emitSnapshot(successful || recovered ? "activity" : "error", job.jobId);
        if ((successful || recovered) && this.#state === job.state && this.#activationGeneration === job.generation) {
            this.#scheduleNextActivity(job.state, job.generation);
        }
    }

    #beginDeactivation() {
        this.#clearSchedules();
        this.#activationGeneration += 1;
    }

    async #runEnter(state: TActorState, fromState: TActorState, cause: "startup" | "transition" | "recovery" | "error", jobId: string, messageId?: string) {
        const functions = this.#vsJson.actor.states[state]?.onEnter ?? [];
        await this.#runPipeline(functions, {
            kind: "lifecycle.enter",
            state,
            fromState,
            cause,
            messageId,
        }, { jobId, messageId });
    }

    async #runExit(state: TActorState, toState: TActorState, cause: "transition" | "recovery", jobId: string, messageId?: string) {
        const functions = this.#vsJson.actor.states[state]?.onExit ?? [];
        await this.#runPipeline(functions, {
            kind: "lifecycle.exit",
            state,
            toState,
            cause,
            messageId,
        }, { jobId, messageId });
    }

    async #handleFailure(context: TFailureContext, failure: unknown): Promise<boolean> {
        const error = this.#toError(failure);
        if (this.#isClosing) return false;
        if (this.#childFailure) {
            this.#applyImplicitErrorWithoutHooks(this.#messageIdForJob(context.job));
            this.#emitFailure(context, error, false);
            return false;
        }

        const handler = fnSelectActorErrorHandler({
            phase: context.phase,
            activity: context.activity,
            transition: context.transition,
            sourceState: context.sourceState,
            currentState: this.#state,
            states: this.#vsJson.actor.states,
        });
        if (!handler) {
            await this.#applyImplicitError(context.job, context.sourceState);
            this.#emitFailure(context, error, false);
            return false;
        }

        try {
            await this.#runPipeline(handler.func, fnBuildActorErrorPayload({
                phase: context.phase,
                job: context.job,
                sourceState: context.sourceState,
                targetState: context.targetState,
                currentState: this.#state,
                error,
            }), {
                jobId: context.job.jobId,
                messageId: this.#messageIdForJob(context.job),
            });
        } catch (handlerFailure) {
            await this.#applyImplicitError(context.job, context.sourceState);
            this.#emitError({
                code: "ACTOR_ERROR_HANDLER_FAILED",
                message: this.#toError(handlerFailure).message,
                messageId: this.#messageIdForJob(context.job),
                details: { phase: context.phase, originalError: fnSerializeActorError(error) },
            });
            this.#emitFailure(context, error, false);
            return false;
        }

        const recovered = await this.#applyRecovery(handler, context);
        this.#emitFailure(context, error, recovered);
        return recovered;
    }

    async #applyRecovery(handler: TActorErrorHandler, context: TFailureContext): Promise<boolean> {
        if (handler.recover === "stay") {
            const needsReactivation = context.deactivationStarted || context.phase === "startup.enter" || context.phase === "state.enter";
            if (!needsReactivation) return true;
            const state = this.#state;
            try {
                this.#activationGeneration += 1;
                await this.#runEnter(state, state, "recovery", context.job.jobId, this.#messageIdForJob(context.job));
                this.#scheduleForActiveState();
                return true;
            } catch (error) {
                await this.#applyImplicitError(context.job, state);
                this.#emitError({
                    code: "ACTOR_RECOVERY_ENTER_FAILED",
                    message: this.#toError(error).message,
                    messageId: this.#messageIdForJob(context.job),
                    details: { state },
                });
                return false;
            }
        }

        const recoveryTarget = handler.recover.targetState;
        if (context.currentStateFullyActive && !context.deactivationStarted) {
            const currentState = this.#state;
            this.#beginDeactivation();
            try {
                await this.#runExit(currentState, recoveryTarget, "recovery", context.job.jobId, this.#messageIdForJob(context.job));
            } catch (error) {
                await this.#applyImplicitError(context.job, currentState);
                this.#emitError({
                    code: "ACTOR_RECOVERY_EXIT_FAILED",
                    message: this.#toError(error).message,
                    messageId: this.#messageIdForJob(context.job),
                    details: { state: currentState, recoveryTarget },
                });
                return false;
            }
        } else {
            this.#clearSchedules();
        }

        const fromState = this.#state;
        this.#applyState(recoveryTarget, this.#messageIdForJob(context.job));
        this.#activationGeneration += 1;
        try {
            await this.#runEnter(recoveryTarget, fromState, "recovery", context.job.jobId, this.#messageIdForJob(context.job));
            this.#scheduleForActiveState();
            return true;
        } catch (error) {
            await this.#applyImplicitError(context.job, recoveryTarget);
            this.#emitError({
                code: "ACTOR_RECOVERY_ENTER_FAILED",
                message: this.#toError(error).message,
                messageId: this.#messageIdForJob(context.job),
                details: { state: recoveryTarget },
            });
            return false;
        }
    }

    async #applyImplicitError(job: TActorJob, fromState: TActorState) {
        const messageId = this.#messageIdForJob(job);
        this.#clearSchedules();
        this.#activationGeneration += 1;
        if (this.#state === "error") return;
        this.#applyState("error", messageId);
        this.#activationGeneration += 1;
        try {
            await this.#runEnter("error", fromState, "error", job.jobId, messageId);
            this.#scheduleForActiveState();
        } catch (error) {
            this.#clearSchedules();
            this.#emitError({
                code: "ACTOR_ERROR_ENTER_FAILED",
                message: this.#toError(error).message,
                messageId,
            });
        }
    }

    #applyImplicitErrorWithoutHooks(messageId?: string) {
        this.#clearSchedules();
        this.#activationGeneration += 1;
        if (this.#state === "error") return;
        this.#applyState("error", messageId);
    }

    #applyState(nextState: TActorState, messageId?: string) {
        if (nextState === this.#state) return;
        const prevState = this.#state;
        this.#state = nextState;
        this.#emitSystemEvent({ type: "state.changed", from: prevState, to: nextState, messageId });
    }

    #scheduleForActiveState() {
        this.#scheduleStateTimeout();
        const activity = this.#vsJson.actor.states[this.#state]?.activity;
        if (!activity) return;
        if (activity.runImmediately) {
            this.#enqueueActivity(this.#state, this.#activationGeneration);
            return;
        }
        this.#scheduleNextActivity(this.#state, this.#activationGeneration);
    }

    #scheduleNextActivity(state: TActorState, generation: number) {
        this.#clearActivityTimer();
        const activity = this.#vsJson.actor.states[state]?.activity;
        if (!activity) return;
        this.#activityTimer = setTimeout(() => {
            this.#activityTimer = null;
            if (this.#state !== state || this.#activationGeneration !== generation) return;
            this.#enqueueActivity(state, generation);
        }, activity.everyMs);
    }

    #enqueueActivity(state: TActorState, generation: number) {
        if (this.#activityPendingGeneration === generation) return;
        this.#activityPendingGeneration = generation;
        this.#activityTick += 1;
        const jobId = crypto.randomUUID();
        this.#queue.push({
            kind: "activity",
            jobId,
            state,
            generation,
            tick: this.#activityTick,
            scheduledAt: new Date().toISOString(),
        });
        void this.#processQueue();
    }

    #scheduleStateTimeout() {
        this.#clearStateTimeout();
        const timeout = fnGetActorStateTimeoutMessage({
            messageNames: Object.keys(this.#vsJson.actor.states[this.#state]?.on ?? {}),
        });
        if (!timeout) return;
        const state = this.#state;
        const generation = this.#activationGeneration;
        this.#stateTimeout = setTimeout(() => {
            this.#stateTimeout = null;
            if (this.#state !== state || this.#activationGeneration !== generation) return;
            const messageId = crypto.randomUUID();
            this.#queue.push({
                kind: "input",
                source: "timeout",
                jobId: messageId,
                messageId,
                msgName: timeout.msgName as TInputMessage,
                msgPayload: {},
                acceptedState: state,
                acceptedGeneration: generation,
            });
            void this.#processQueue();
        }, timeout.delayMs);
    }

    #clearSchedules() {
        this.#clearStateTimeout();
        this.#clearActivityTimer();
    }

    #clearStateTimeout() {
        if (!this.#stateTimeout) return;
        clearTimeout(this.#stateTimeout);
        this.#stateTimeout = null;
    }

    #clearActivityTimer() {
        if (!this.#activityTimer) return;
        clearTimeout(this.#activityTimer);
        this.#activityTimer = null;
    }

    #runPipeline(functions: TFunctionName[], payload: unknown, meta: TRunMeta): Promise<void> {
        if (functions.length === 0) return Promise.resolve();
        const proc = this.#proc;
        if (!proc) return Promise.reject(new Error("Actor child process is not running"));
        if (this.#childFailure) return Promise.reject(this.#childFailure);
        if (!this.#isChildReady) return Promise.reject(new Error("Actor child process is not ready"));

        const id = this.#nextRunId++;
        return new Promise((resolve, reject) => {
            this.#pendingRuns.set(id, {
                ...meta,
                resolve,
                reject,
                functionClasses: functions.map((name) => name.startsWith('fn.') ? 'fn' : name.startsWith('fx.') ? 'fx' : 'tx'),
                activeFunctionIndex: 0,
            });
            try {
                proc.send({
                    type: "run",
                    id,
                    func: functions,
                    payload: this.#toIpcValue(payload),
                    data: this.#toIpcValue(this.#data),
                });
            } catch (error) {
                this.#pendingRuns.delete(id);
                reject(error);
            }
        });
    }

    #toIpcValue(value: unknown): unknown {
        const serialized = JSON.stringify(value);
        return serialized === undefined ? null : JSON.parse(serialized);
    }

    #handleChildMessage(message: TActorChildMessage) {
        if ("error" in message && typeof message.error === "boolean") {
            if (message.error) {
                const id = "id" in message && typeof message.id === "number" ? message.id : undefined;
                this.#rejectPending(id, message.msg);
            }
            return;
        }
        if (!message || typeof message !== "object" || !("type" in message)) return;

        if (message.type === "ready") {
            this.#isChildReady = true;
            this.#childFailure = null;
            if (!this.#startupQueued && !this.#isActivated) {
                this.#startupQueued = true;
                this.#queue.unshift({ kind: "startup", jobId: crypto.randomUUID() });
            }
            void this.#processQueue();
            return;
        }
        if (message.type === "setData") {
            this.#data = message.data;
            const pending = this.#pendingRuns.get(message.id);
            this.#emitSystemEvent({ type: "data.changed", data: this.#data, messageId: pending?.messageId });
            this.#proc?.send({ type: "ack", id: message.id, action: "setData" });
            return;
        }
        if (message.type === "emitMessage") {
            this.#emitActorMessageFromChild(message.msg, message.id);
            this.#proc?.send({ type: "ack", id: message.id, action: "emitMessage" });
            return;
        }
        if (message.type === "next") {
            const pending = this.#pendingRuns.get(message.id);
            if (pending) pending.activeFunctionIndex += 1;
            this.#proc?.send({ type: "ack", id: message.id, action: "next" });
            return;
        }
        if (message.type === 'resourceCall') {
            void this.#handleResourceCall(message);
            return;
        }
        if (message.type === "done") {
            const pending = this.#pendingRuns.get(message.id);
            if (!pending) return;
            this.#pendingRuns.delete(message.id);
            pending.resolve();
            return;
        }
        if (message.type === "error") this.#rejectPending(message.id, message.msg);
    }

    async #handleResourceCall(message: Extract<TActorChildMessage, { type: 'resourceCall' }>) {
        const proc = this.#proc;
        if (!proc) return;
        const sendError = (code: string, errorMessage: string) => {
            try {
                proc.send({ type: 'resourceResult', callId: typeof message.callId === 'string' ? message.callId : '', ok: false, error: { code, message: errorMessage } });
            } catch { /* child exit races are expected */ }
        };
        if (
            typeof message.id !== 'number' ||
            typeof message.callId !== 'string' ||
            typeof message.slot !== 'string' ||
            (message.kind !== 'kv' && message.kind !== 'secretStore' && message.kind !== 'db') ||
            typeof message.operation !== 'string'
        ) {
            sendError('RESOURCE_PROVIDER_UNAVAILABLE', 'Actor resource request is invalid.');
            return;
        }
        const pending = this.#pendingRuns.get(message.id);
        if (!pending) {
            sendError('RESOURCE_CALL_CANCELLED', 'Actor resource call belongs to a completed or cancelled run.');
            return;
        }
        const functionClass = pending.functionClasses[pending.activeFunctionIndex];
        if (!functionClass || !this.#resourceGateway) {
            sendError('RESOURCE_PROVIDER_UNAVAILABLE', 'Actor resource gateway is unavailable.');
            return;
        }
        try {
            const result = await this.#resourceGateway({
                actorId: this.#id,
                definitionName: this.#vsJson.name,
                runId: message.id,
                functionClass,
                slot: message.slot,
                kind: message.kind,
                operation: message.operation,
                args: message.args,
            });
            if (this.#proc === proc && this.#pendingRuns.has(message.id)) {
                proc.send({ type: 'resourceResult', callId: message.callId, ok: true, result });
            }
        } catch (error) {
            if (this.#proc !== proc || !this.#pendingRuns.has(message.id)) return;
            const safeError = toSafeActorResourceError(error);
            try {
                proc.send({ type: 'resourceResult', callId: message.callId, ok: false, error: safeError });
            } catch { /* child exit races are expected */ }
        }
    }

    #rejectPending(id: number | undefined, error: unknown) {
        const rejection = this.#toError(error);
        if (typeof id !== "number") {
            for (const [runId, pending] of this.#pendingRuns) {
                this.#pendingRuns.delete(runId);
                pending.reject(rejection);
            }
            return;
        }
        const pending = this.#pendingRuns.get(id);
        if (!pending) return;
        this.#pendingRuns.delete(id);
        pending.reject(rejection);
    }

    #handleChildExit(exitCode: number | null) {
        if (this.#isClosing) return;
        this.#isChildReady = false;
        this.#proc = null;
        const error = new Error(`Actor child process exited with code ${exitCode}`);
        for (const waiter of [...this.#readyWaiters]) waiter.reject(error);
        this.#childFailure = error;
        this.#rejectPending(undefined, error);
        this.#queue = [];
        this.#applyImplicitErrorWithoutHooks();
        this.#emitSnapshot("error");
        this.#emitError({
            code: "ACTOR_CHILD_EXITED",
            message: error.message,
            details: { exitCode },
        });
        if (this.#didEmitRunning) {
            this.#emitSystemEvent({ type: "status.changed", from: "running", to: "stopped" });
            this.#didEmitRunning = false;
        }
    }

    #ackInput(job: TInputJob) {
        this.#emitSystemEvent({ type: "ack", messageId: job.messageId, inputName: job.msgName });
    }

    #metaForInput(job: TInputJob): TRunMeta {
        return { jobId: job.jobId, messageId: job.messageId, inputName: job.msgName };
    }

    #messageIdForJob(job: TActorJob): string | undefined {
        return job.kind === "input" ? job.messageId : undefined;
    }

    #emitFailure(context: TFailureContext, error: Error, recovered: boolean) {
        this.#emitError({
            code: fnGetActorFailureCode(context.phase),
            messageId: this.#messageIdForJob(context.job),
            message: error.message,
            details: { phase: context.phase, recovered },
        });
    }

    #dropInboxMessage(args: { messageId: string; msgName: string; msgPayload: unknown; code: string; message: string; details?: unknown }): string {
        this.#emitEvent({
            kind: "actor",
            actorId: this.#id,
            name: "DROP_MESSAGE",
            payload: {
                inputName: args.msgName,
                inputPayload: args.msgPayload,
                code: args.code,
                message: args.message,
                details: args.details,
            },
            messageId: args.messageId,
        });
        return args.messageId;
    }

    #toError(error: unknown): Error {
        if (error instanceof Error) return error;
        if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
            const named = new Error(error.message);
            if ("name" in error && typeof error.name === "string") named.name = error.name;
            if ("stack" in error && typeof error.stack === "string") named.stack = error.stack;
            return named;
        }
        return new Error(typeof error === "string" ? error : JSON.stringify(error));
    }

    #emitActorMessageFromChild(msg: unknown, runId: number) {
        const pending = this.#pendingRuns.get(runId);
        if (!msg || typeof msg !== "object" || !("type" in msg) || typeof msg.type !== "string" || !("payload" in msg)) {
            this.#emitError({
                code: "INVALID_OUTPUT_MESSAGE_SHAPE",
                message: "Output message must be an object with { type, payload }.",
                details: { value: msg },
                messageId: pending?.messageId,
            });
            return;
        }
        this.#emitActorMessage(msg.type, msg.payload, pending?.messageId);
    }

    #emitActorMessage(msgName: string, msgPayload: unknown, messageId: string | undefined): Error | undefined {
        const validFn = this.#outputMessage[msgName];
        if (!validFn) {
            return this.#emitError({
                code: "UNKNOWN_OUTPUT_MESSAGE",
                message: `Unknown output message name ${msgName}. Allowed message name: ${JSON.stringify(Object.keys(this.#outputMessage))}`,
                details: { outputMessageName: msgName, payload: msgPayload },
                messageId,
            });
        }
        if (!validFn(msgPayload)) {
            return this.#emitError({
                code: "INVALID_OUTPUT_MESSAGE_PAYLOAD",
                message: `Invalid output message payload for ${msgName}.`,
                details: { outputMessageName: msgName, payload: msgPayload, validationErrors: validFn.errors },
                messageId,
            });
        }
        this.#emitEvent({ kind: "actor", actorId: this.#id, name: msgName, payload: msgPayload, messageId });
    }

    #emitSnapshot(cause: TSnapshotCause, jobId?: string) {
        this.#snapshotRevision += 1;
        const data = JSON.parse(JSON.stringify(this.#data)) as TActorData;
        this.#emitSystemEvent({
            type: "snapshot",
            revision: this.#snapshotRevision,
            state: this.#state,
            data,
            cause,
            jobId,
        });
    }

    #emitError(args: { code: string; message: string; details?: unknown; messageId?: string }): Error {
        this.#emitSystemEvent({ type: "error", ...args });
        return new Error(`Error in Actor: ${this.#vsJson.name}\n${JSON.stringify(args)}`);
    }

    #emitSystemEvent(event: TActorSystemEventInput) {
        this.#emitEvent({ kind: "system", actorId: this.#id, ...event } as TActorSystemEvent);
    }

    #emitEvent(event: TActorEvent) {
        for (const listener of this.#listeners) listener(event);
    }
}
