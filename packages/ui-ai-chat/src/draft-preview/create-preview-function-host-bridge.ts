import type { TWidgetBrowserFunctionDescriptor } from "@vibecanvas/widget-contract"
import type { TAiChatApiPort } from "../ports"
import type {
  TWidgetFunctionHostBridge,
  TWidgetPreviewRuntimeIdentity,
  TWidgetServerFunctionClientRequest,
} from "../widget-runtime/interface"

const MAX_IN_FLIGHT = 8
const MAX_FUNCTIONS = 128
const MAX_TIMEOUT_MS = 30_000
const POLL_SLACK_MS = 2_000
const POLL_INTERVAL_MS = 25
const RPC_BOUND_ERROR = "Draft Preview function RPC exceeded its polling bound."

type TInvocation = Awaited<ReturnType<
  TAiChatApiPort["api"]["agent"]["widgetPreview"]["invoke"]
>>[1]

type TCreatePreviewFunctionHostBridgeArgs = Readonly<{
  api: TAiChatApiPort
  draftId: string
  identity: TWidgetPreviewRuntimeIdentity
  functionDescriptors: readonly TWidgetBrowserFunctionDescriptor[]
  createId(): string
  nowMs(): number
  wait(timeoutMs: number, signal: AbortSignal): Promise<void>
  isCurrent(): boolean
  onLogError(error: unknown): void
}>

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string" && message) return message
  }
  return fallback
}

function assertInvocation(
  invocation: NonNullable<TInvocation>,
  identity: TWidgetPreviewRuntimeIdentity,
  expected: Readonly<{ id?: string; functionName: string }>,
): void {
  if (
    invocation.previewId !== identity.previewId
    || invocation.previewRevisionId !== identity.previewRevisionId
    || invocation.functionName !== expected.functionName
    || (expected.id !== undefined && invocation.id !== expected.id)
  ) {
    throw new Error("Draft Preview function invocation identity mismatch.")
  }
}

export function createPreviewFunctionHostBridge(
  args: TCreatePreviewFunctionHostBridgeArgs,
): TWidgetFunctionHostBridge {
  if (args.functionDescriptors.length > MAX_FUNCTIONS) {
    throw new TypeError("Draft Preview function descriptor policy is invalid.")
  }
  const timeoutByName = new Map<string, number>()
  args.functionDescriptors.forEach((descriptor) => {
    const timeoutMs = descriptor.limits.timeoutMs
    if (
      !/^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/.test(descriptor.exportName)
      || !Number.isSafeInteger(timeoutMs)
      || timeoutMs < 1
      || timeoutMs > MAX_TIMEOUT_MS
      || timeoutByName.has(descriptor.exportName)
    ) {
      throw new TypeError("Draft Preview function descriptor policy is invalid.")
    }
    timeoutByName.set(descriptor.exportName, timeoutMs)
  })

  let disposed = false
  const controllers = new Set<AbortController>()
  const activeInvocations = new Map<string, string>()
  const cancelledInvocationIds = new Set<string>()

  const assertCurrent = (signal?: AbortSignal) => {
    if (disposed || signal?.aborted) throw new Error("Draft Preview function host is disposed.")
    if (!args.isCurrent()) throw new Error("Draft Preview function target is no longer current.")
  }
  const cancelInvocation = (invocationId: string) => {
    if (cancelledInvocationIds.has(invocationId)) return
    cancelledInvocationIds.add(invocationId)
    const expectedFunctionName = activeInvocations.get(invocationId)
    void args.api.api.agent.widgetPreview.invocation.cancel({
      draftId: args.draftId,
      previewId: args.identity.previewId,
      previewRevisionId: args.identity.previewRevisionId,
      invocationId,
    }).then(([error, cancelled]) => {
      if (error) args.onLogError(error)
      if (cancelled) {
        try {
          assertInvocation(cancelled, args.identity, {
            id: invocationId,
            functionName: expectedFunctionName ?? cancelled.functionName,
          })
        } catch (identityError) {
          args.onLogError(identityError)
        }
      }
    }).catch(args.onLogError)
  }

  const withinBound = async <T>(
    operation: Promise<T>,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<T> => {
    const watchdog = new AbortController()
    const onAbort = () => watchdog.abort()
    signal.addEventListener("abort", onAbort, { once: true })
    const timeout = Symbol("preview-function-rpc-timeout")
    try {
      const outcome = await Promise.race([
        operation,
        args.wait(timeoutMs, watchdog.signal).then(() => timeout),
      ])
      if (outcome === timeout) throw new Error(RPC_BOUND_ERROR)
      return outcome as T
    } finally {
      signal.removeEventListener("abort", onAbort)
      watchdog.abort()
    }
  }

  const invoke = async <TOutput>(request: TWidgetServerFunctionClientRequest): Promise<TOutput> => {
    assertCurrent()
    const timeoutMs = timeoutByName.get(request.functionName)
    if (timeoutMs === undefined) {
      throw new Error(`Widget function "${request.functionName}" is not declared by this Preview revision.`)
    }
    if (controllers.size >= MAX_IN_FLIGHT) {
      throw new Error(`Draft Preview allows at most ${MAX_IN_FLIGHT} in-flight function calls.`)
    }
    const controller = new AbortController()
    controllers.add(controller)
    let invocationId: string | undefined
    try {
      const startedAtMs = args.nowMs()
      if (!Number.isSafeInteger(startedAtMs) || startedAtMs < 0) {
        throw new Error("Draft Preview function host clock is invalid.")
      }
      const [invokeError, initial] = await withinBound(
        args.api.api.agent.widgetPreview.invoke({
          draftId: args.draftId,
          previewId: args.identity.previewId,
          previewRevisionId: args.identity.previewRevisionId,
          functionName: request.functionName,
          input: request.input,
          idempotencyKey: request.idempotencyKey,
        }, { signal: controller.signal }),
        timeoutMs + POLL_SLACK_MS,
        controller.signal,
      )
      if (invokeError || !initial) {
        throw new Error(errorMessage(invokeError, "Draft Preview function invocation failed."))
      }
      assertInvocation(initial, args.identity, { functionName: request.functionName })
      invocationId = initial.id
      activeInvocations.set(invocationId, request.functionName)
      assertCurrent(controller.signal)
      let current = initial
      const maxPolls = Math.ceil((timeoutMs + POLL_SLACK_MS) / POLL_INTERVAL_MS)
      for (let poll = 0; poll <= maxPolls; poll += 1) {
        assertCurrent(controller.signal)
        assertInvocation(current, args.identity, { id: invocationId, functionName: request.functionName })
        if (current.status === "succeeded") return current.output as TOutput
        if (["failed", "cancelled", "timed_out"].includes(current.status)) {
          throw new Error(current.failure?.message ?? `Draft Preview function invocation ${current.status}.`)
        }
        if (poll === maxPolls) break
        await args.wait(POLL_INTERVAL_MS, controller.signal)
        assertCurrent(controller.signal)
        const [getError, next] = await withinBound(
          args.api.api.agent.widgetPreview.invocation.get({
            draftId: args.draftId,
            previewId: args.identity.previewId,
            previewRevisionId: args.identity.previewRevisionId,
            invocationId,
          }, { signal: controller.signal }),
          Math.max(POLL_INTERVAL_MS, (maxPolls - poll) * POLL_INTERVAL_MS),
          controller.signal,
        )
        assertCurrent(controller.signal)
        if (getError) {
          throw new Error(errorMessage(getError, "Draft Preview function status is unavailable."))
        }
        if (next) current = next
      }
      cancelInvocation(invocationId)
      throw new Error("Draft Preview function invocation exceeded its polling bound.")
    } catch (error) {
      if (invocationId && (disposed || !args.isCurrent())) cancelInvocation(invocationId)
      throw error
    } finally {
      controller.abort()
      controllers.delete(controller)
      if (invocationId) activeInvocations.delete(invocationId)
    }
  }

  return Object.freeze({
    identity: Object.freeze({ ...args.identity }),
    createIdempotencyKey: args.createId,
    invoke,
    dispose() {
      if (disposed) return
      disposed = true
      controllers.forEach((controller) => controller.abort())
      controllers.clear()
      activeInvocations.forEach((_functionName, invocationId) => cancelInvocation(invocationId))
      activeInvocations.clear()
    },
  })
}
