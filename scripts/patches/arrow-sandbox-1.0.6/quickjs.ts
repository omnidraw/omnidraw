import {
  DEBUG_ASYNC,
  RELEASE_ASYNC,
  newQuickJSAsyncWASMModule,
} from 'quickjs-emscripten'
import type {
  CompiledSandboxGraph,
} from '../compiler'
import type {
  HostBridge,
  HostToVmMessage,
  VmInitPayload,
  VmToHostMessage,
} from '../shared/protocol'
import {
  VM_BOOTSTRAP_MODULE_ID,
  VM_CORE_MODULE_ID,
  vmRuntimeModules,
} from '../vm/generated-modules'
import { SandboxRuntimeError } from './errors'

interface VmRunnerOptions {
  compiled: CompiledSandboxGraph
  debug?: boolean
  hostBridge?: HostBridge
  signal?: AbortSignal
  onMessage: (message: VmToHostMessage) => void
}

interface SandboxTimerRecord {
  callback: any
  args: any[]
  handle: ReturnType<typeof globalThis.setTimeout> | ReturnType<typeof globalThis.setInterval>
  repeat: boolean
}

interface SandboxFetchRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
  redirect: RequestRedirect
}

interface SandboxFetchResponseData {
  ok: boolean
  status: number
  statusText: string
  url: string
  redirected: boolean
  headers: Record<string, string>
  bodyBytes: Uint8Array
}

interface SandboxFetchRecord {
  controller: AbortController
  deferred: any
  timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null
  active: boolean
  timedOut: boolean
}

interface SandboxBridgeRecord {
  deferred: any
  active: boolean
}

interface SandboxDispatchRecord {
  message: HostToVmMessage
  resolve: () => void
  reject: (error: unknown) => void
}

export interface VmRunner {
  dispatch(message: HostToVmMessage): Promise<void>
  destroy(): void
}

const quickJsModules = new Map<boolean, Promise<Awaited<ReturnType<typeof newQuickJSAsyncWASMModule>>>>()
const SAFE_FETCH_ALLOWED_INIT_KEYS = new Set([
  'body',
  'credentials',
  'headers',
  'method',
  'mode',
  'redirect',
  'referrerPolicy',
])
const SAFE_FETCH_ALLOWED_METHODS = new Set([
  'DELETE',
  'GET',
  'HEAD',
  'PATCH',
  'POST',
  'PUT',
])
const SAFE_FETCH_BLOCKED_HEADER_PATTERNS = [
  /^(authorization|cookie|cookie2|host|origin|referer|user-agent)$/i,
  /^proxy-/i,
  /^sec-/i,
]
const SANDBOX_FETCH_TIMEOUT_MS = 15_000
const SANDBOX_FETCH_MAX_RESPONSE_BYTES = 1_000_000
const SANDBOX_BOOT_TIMEOUT_MS = 10_000
const SANDBOX_PROMISE_POLL_INTERVAL_MS = 10
const SANDBOX_EVENT_DISPATCH_TIMEOUT_MS = 1_000
const SANDBOX_MAX_PENDING_EVENT_DISPATCHES = 16
const SANDBOX_MAX_ACTIVE_TIMERS = 64
const SANDBOX_MIN_TIMER_DELAY_MS = 4
const SANDBOX_MAX_PENDING_FETCHES = 8
const SANDBOX_MAX_PENDING_BRIDGE_CALLS = 16
const SANDBOX_MAX_BRIDGE_IDENTIFIER_CHARACTERS = 256
const SANDBOX_ASYNC_BUDGET_WINDOW_MS = 1_000
const SANDBOX_MAX_TIMER_SCHEDULES_PER_WINDOW = 128
const SANDBOX_MAX_TIMER_CALLBACKS_PER_WINDOW = 64
const SANDBOX_MAX_FETCH_STARTS_PER_WINDOW = 16
const SANDBOX_MAX_BRIDGE_STARTS_PER_WINDOW = 64
const SANDBOX_MAX_VM_MESSAGES_PER_WINDOW = 256
const SANDBOX_MAX_VM_MESSAGE_BYTES = 1_000_000
const SANDBOX_MAX_RENDER_NODES = 4_096
const SANDBOX_MAX_RENDER_DEPTH = 32
const SANDBOX_MAX_RENDER_TEXT_CHARACTERS = 262_144
const SANDBOX_MAX_RENDER_ATTRIBUTES = 4_096
const SANDBOX_MAX_ATTRIBUTES_PER_ELEMENT = 64
const SANDBOX_MAX_RENDER_ATTRIBUTE_CHARACTERS = 262_144
const SANDBOX_MAX_RENDER_EVENTS = 1_024
const SANDBOX_MAX_EVENTS_PER_ELEMENT = 16
const SANDBOX_MAX_PATCHES_PER_MESSAGE = 1_024
const SANDBOX_MAX_PROTOCOL_IDENTIFIER_CHARACTERS = 256
const SANDBOX_MAX_ERROR_CHARACTERS = 16_384
const SANDBOX_MAX_LOG_ARGUMENTS = 64
const SANDBOX_MAX_GENERIC_JSON_NODES = 10_000
const SANDBOX_MAX_GENERIC_JSON_DEPTH = 32
const SANDBOX_MAX_BRIDGE_VALUE_NODES = 10_000
const SANDBOX_MAX_BRIDGE_VALUE_DEPTH = 32
const SANDBOX_MAX_BRIDGE_VALUE_UTF8_BYTES = 1_000_000
const HOST_BRIDGE_MODULE_PREFIX = '/__arrow_sandbox/host-bridge/'
const textDecoder = new TextDecoder()

const SAFE_VM_CONSOLE_METHODS = new Set([
  'assert', 'clear', 'count', 'countReset', 'debug', 'dir', 'dirxml', 'error',
  'group', 'groupCollapsed', 'groupEnd', 'info', 'log', 'table', 'time',
  'timeEnd', 'timeLog', 'trace', 'warn',
])

type SandboxProtocolRecord = Record<string, unknown>

interface SandboxRenderMessageBudget {
  attributeCharacters: number
  attributes: number
  events: number
  nodeIds: Set<string>
  nodes: number
  textCharacters: number
}

function sandboxProtocolError(reason: string): SandboxRuntimeError {
  return new SandboxRuntimeError('Sandbox VM message ' + reason + '.')
}

function sandboxProtocolRecord(value: unknown): SandboxProtocolRecord {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw sandboxProtocolError('has an invalid object shape')
  }

  return value as SandboxProtocolRecord
}

function assertSandboxProtocolRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = []
): SandboxProtocolRecord {
  const record = sandboxProtocolRecord(value)

  const allowedKeys = new Set([...requiredKeys, ...optionalKeys])
  const keys = Object.keys(record)
  if (
    requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(record, key))
    || keys.some((key) => !allowedKeys.has(key))
  ) {
    throw sandboxProtocolError('has unexpected or missing fields')
  }
  return record
}

function assertSandboxProtocolString(
  value: unknown,
  maximumCharacters: number,
  allowEmpty = false
): string {
  if (
    typeof value !== 'string'
    || (!allowEmpty && value.length === 0)
    || value.length > maximumCharacters
  ) {
    throw sandboxProtocolError('contains an invalid or oversized string')
  }
  return value
}

function boundedUtf8ByteLength(value: string, maximumBytes: number): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (
      code >= 0xd800
      && code <= 0xdbff
      && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4
      index += 1
    } else bytes += 3

    if (bytes > maximumBytes) return bytes
  }
  return bytes
}

function assertBoundedSandboxJson(value: unknown) {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }]
  let nodes = 0
  while (pending.length > 0) {
    const current = pending.pop()!
    nodes += 1
    if (nodes > SANDBOX_MAX_GENERIC_JSON_NODES) {
      throw sandboxProtocolError('exceeds the generic JSON node budget')
    }
    if (current.depth > SANDBOX_MAX_GENERIC_JSON_DEPTH) {
      throw sandboxProtocolError('exceeds the generic JSON depth budget')
    }

    if (
      current.value === null
      || typeof current.value === 'string'
      || typeof current.value === 'boolean'
      || (typeof current.value === 'number' && Number.isFinite(current.value))
    ) continue

    if (Array.isArray(current.value)) {
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        pending.push({ value: current.value[index], depth: current.depth + 1 })
      }
      continue
    }

    const record = sandboxProtocolRecord(current.value)
    for (const entry of Object.values(record)) {
      pending.push({ value: entry, depth: current.depth + 1 })
    }
  }
}

function createSandboxRenderMessageBudget(): SandboxRenderMessageBudget {
  return {
    attributeCharacters: 0,
    attributes: 0,
    events: 0,
    nodeIds: new Set(),
    nodes: 0,
    textCharacters: 0,
  }
}

function consumeSandboxNodeId(
  value: unknown,
  budget: SandboxRenderMessageBudget
): string {
  const nodeId = assertSandboxProtocolString(
    value,
    SANDBOX_MAX_PROTOCOL_IDENTIFIER_CHARACTERS
  )
  if (budget.nodeIds.has(nodeId)) {
    throw sandboxProtocolError('contains a duplicate render node id')
  }
  budget.nodeIds.add(nodeId)
  return nodeId
}

function consumeSandboxText(value: unknown, budget: SandboxRenderMessageBudget) {
  if (typeof value !== 'string') {
    throw sandboxProtocolError('contains a non-string text value')
  }
  budget.textCharacters += value.length
  if (budget.textCharacters > SANDBOX_MAX_RENDER_TEXT_CHARACTERS) {
    throw sandboxProtocolError('exceeds the render text budget')
  }
}

function consumeSandboxAttribute(
  nameValue: unknown,
  value: unknown,
  budget: SandboxRenderMessageBudget
) {
  const name = assertSandboxProtocolString(
    nameValue,
    SANDBOX_MAX_PROTOCOL_IDENTIFIER_CHARACTERS
  )
  if (typeof value !== 'string' && typeof value !== 'boolean') {
    throw sandboxProtocolError('contains an invalid attribute value')
  }
  budget.attributes += 1
  budget.attributeCharacters += name.length + (typeof value === 'string' ? value.length : 0)
  if (budget.attributes > SANDBOX_MAX_RENDER_ATTRIBUTES) {
    throw sandboxProtocolError('exceeds the render attribute budget')
  }
  if (budget.attributeCharacters > SANDBOX_MAX_RENDER_ATTRIBUTE_CHARACTERS) {
    throw sandboxProtocolError('exceeds the render attribute text budget')
  }
}

function consumeSandboxEvent(
  eventTypeValue: unknown,
  handlerIdValue: unknown,
  budget: SandboxRenderMessageBudget
) {
  assertSandboxProtocolString(
    eventTypeValue,
    SANDBOX_MAX_PROTOCOL_IDENTIFIER_CHARACTERS
  )
  assertSandboxProtocolString(
    handlerIdValue,
    SANDBOX_MAX_PROTOCOL_IDENTIFIER_CHARACTERS
  )
  budget.events += 1
  if (budget.events > SANDBOX_MAX_RENDER_EVENTS) {
    throw sandboxProtocolError('exceeds the render event budget')
  }
}

function assertSandboxSerializedNodes(
  roots: readonly unknown[],
  budget: SandboxRenderMessageBudget
) {
  const pending: Array<{ node: unknown; depth: number }> = []
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    pending.push({ node: roots[index], depth: 1 })
  }

  while (pending.length > 0) {
    const current = pending.pop()!
    budget.nodes += 1
    if (budget.nodes > SANDBOX_MAX_RENDER_NODES) {
      throw sandboxProtocolError('exceeds the render node budget')
    }
    if (current.depth > SANDBOX_MAX_RENDER_DEPTH) {
      throw sandboxProtocolError('exceeds the render depth budget')
    }

    const kindRecord = sandboxProtocolRecord(current.node)
    const kind = kindRecord.kind
    if (kind === 'fragment') {
      const node = assertSandboxProtocolRecord(current.node, ['kind', 'children'])
      if (!Array.isArray(node.children)) {
        throw sandboxProtocolError('contains invalid fragment children')
      }
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        pending.push({ node: node.children[index], depth: current.depth + 1 })
      }
      continue
    }

    if (kind === 'text') {
      const node = assertSandboxProtocolRecord(current.node, ['kind', 'id', 'text'])
      consumeSandboxNodeId(node.id, budget)
      consumeSandboxText(node.text, budget)
      continue
    }

    if (kind === 'region') {
      const node = assertSandboxProtocolRecord(current.node, ['kind', 'id', 'children'])
      consumeSandboxNodeId(node.id, budget)
      if (!Array.isArray(node.children)) {
        throw sandboxProtocolError('contains invalid region children')
      }
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        pending.push({ node: node.children[index], depth: current.depth + 1 })
      }
      continue
    }

    if (kind === 'element') {
      const node = assertSandboxProtocolRecord(
        current.node,
        ['kind', 'id', 'tag', 'attrs', 'events', 'children'],
        ['namespace']
      )
      consumeSandboxNodeId(node.id, budget)
      assertSandboxProtocolString(node.tag, SANDBOX_MAX_PROTOCOL_IDENTIFIER_CHARACTERS)
      if (node.namespace !== undefined && node.namespace !== 'svg') {
        throw sandboxProtocolError('contains an invalid element namespace')
      }
      const attributes = sandboxProtocolRecord(node.attrs)
      const attributeEntries = Object.entries(attributes)
      if (attributeEntries.length > SANDBOX_MAX_ATTRIBUTES_PER_ELEMENT) {
        throw sandboxProtocolError('exceeds the per-element attribute budget')
      }
      for (const [name, value] of attributeEntries) {
        consumeSandboxAttribute(name, value, budget)
      }
      const events = sandboxProtocolRecord(node.events)
      const eventEntries = Object.entries(events)
      if (eventEntries.length > SANDBOX_MAX_EVENTS_PER_ELEMENT) {
        throw sandboxProtocolError('exceeds the per-element event budget')
      }
      for (const [eventType, handlerId] of eventEntries) {
        consumeSandboxEvent(eventType, handlerId, budget)
      }
      if (!Array.isArray(node.children)) {
        throw sandboxProtocolError('contains invalid element children')
      }
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        pending.push({ node: node.children[index], depth: current.depth + 1 })
      }
      continue
    }

    throw sandboxProtocolError('contains an unknown render node kind')
  }
}

function assertSandboxPatch(
  value: unknown,
  budget: SandboxRenderMessageBudget
) {
  const typeRecord = sandboxProtocolRecord(value)
  switch (typeRecord.type) {
    case 'set-text': {
      const patch = assertSandboxProtocolRecord(value, ['type', 'nodeId', 'text'])
      assertSandboxProtocolString(patch.nodeId, SANDBOX_MAX_PROTOCOL_IDENTIFIER_CHARACTERS)
      consumeSandboxText(patch.text, budget)
      return
    }
    case 'set-attribute': {
      const patch = assertSandboxProtocolRecord(value, ['type', 'nodeId', 'name', 'value'])
      assertSandboxProtocolString(patch.nodeId, SANDBOX_MAX_PROTOCOL_IDENTIFIER_CHARACTERS)
      consumeSandboxAttribute(patch.name, patch.value, budget)
      return
    }
    case 'remove-attribute': {
      const patch = assertSandboxProtocolRecord(value, ['type', 'nodeId', 'name'])
      assertSandboxProtocolString(patch.nodeId, SANDBOX_MAX_PROTOCOL_IDENTIFIER_CHARACTERS)
      consumeSandboxAttribute(patch.name, false, budget)
      return
    }
    case 'set-event-binding': {
      const patch = assertSandboxProtocolRecord(
        value,
        ['type', 'nodeId', 'eventType', 'handlerId']
      )
      assertSandboxProtocolString(patch.nodeId, SANDBOX_MAX_PROTOCOL_IDENTIFIER_CHARACTERS)
      consumeSandboxEvent(patch.eventType, patch.handlerId, budget)
      return
    }
    case 'clear-event-binding': {
      const patch = assertSandboxProtocolRecord(value, ['type', 'nodeId', 'eventType'])
      assertSandboxProtocolString(patch.nodeId, SANDBOX_MAX_PROTOCOL_IDENTIFIER_CHARACTERS)
      consumeSandboxEvent(patch.eventType, 'cleared-handler', budget)
      return
    }
    case 'replace-region': {
      const patch = assertSandboxProtocolRecord(value, ['type', 'regionId', 'children'])
      assertSandboxProtocolString(patch.regionId, SANDBOX_MAX_PROTOCOL_IDENTIFIER_CHARACTERS)
      if (!Array.isArray(patch.children)) {
        throw sandboxProtocolError('contains invalid replacement children')
      }
      assertSandboxSerializedNodes(patch.children, budget)
      return
    }
    default:
      throw sandboxProtocolError('contains an unknown patch type')
  }
}

function parseSandboxVmMessage(serialized: string): VmToHostMessage {
  if (
    serialized.length > SANDBOX_MAX_VM_MESSAGE_BYTES
    || boundedUtf8ByteLength(serialized, SANDBOX_MAX_VM_MESSAGE_BYTES)
      > SANDBOX_MAX_VM_MESSAGE_BYTES
  ) {
    throw sandboxProtocolError(
      'exceeds the host byte limit of ' + SANDBOX_MAX_VM_MESSAGE_BYTES
    )
  }

  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    throw sandboxProtocolError('is not valid JSON')
  }

  const typeRecord = sandboxProtocolRecord(value)
  switch (typeRecord.type) {
    case 'ready':
      assertSandboxProtocolRecord(value, ['type'])
      return value as VmToHostMessage
    case 'render': {
      const message = assertSandboxProtocolRecord(value, ['type', 'tree'])
      assertSandboxSerializedNodes([message.tree], createSandboxRenderMessageBudget())
      return value as VmToHostMessage
    }
    case 'patch': {
      const message = assertSandboxProtocolRecord(value, ['type', 'patches'])
      if (!Array.isArray(message.patches)) {
        throw sandboxProtocolError('contains an invalid patch list')
      }
      if (message.patches.length > SANDBOX_MAX_PATCHES_PER_MESSAGE) {
        throw sandboxProtocolError('exceeds the patch count budget')
      }
      const budget = createSandboxRenderMessageBudget()
      for (const patch of message.patches) assertSandboxPatch(patch, budget)
      return value as VmToHostMessage
    }
    case 'error': {
      const message = assertSandboxProtocolRecord(value, ['type', 'error'])
      assertSandboxProtocolString(message.error, SANDBOX_MAX_ERROR_CHARACTERS, true)
      return value as VmToHostMessage
    }
    case 'log': {
      const message = assertSandboxProtocolRecord(value, ['type', 'method', 'args'])
      if (typeof message.method !== 'string' || !SAFE_VM_CONSOLE_METHODS.has(message.method)) {
        throw sandboxProtocolError('contains an unsupported console method')
      }
      if (!Array.isArray(message.args) || message.args.length > SANDBOX_MAX_LOG_ARGUMENTS) {
        throw sandboxProtocolError('exceeds the console argument budget')
      }
      assertBoundedSandboxJson(message.args)
      return value as VmToHostMessage
    }
    case 'output': {
      const message = assertSandboxProtocolRecord(value, ['type', 'payload'])
      assertBoundedSandboxJson(message.payload)
      return value as VmToHostMessage
    }
    default:
      throw sandboxProtocolError('contains an unsupported message type')
  }
}

interface SandboxRateBudget {
  startedAtMs: number
  used: number
}

function consumeSandboxRateBudget(
  budget: SandboxRateBudget,
  maximum: number,
  capability: string
) {
  const now = Date.now()
  if (now < budget.startedAtMs || now - budget.startedAtMs >= SANDBOX_ASYNC_BUDGET_WINDOW_MS) {
    budget.startedAtMs = now
    budget.used = 0
  }
  budget.used += 1
  if (budget.used > maximum) {
    throw new SandboxRuntimeError(
      `Sandbox ${capability} exceeded the host rate budget of ${maximum} per ${SANDBOX_ASYNC_BUDGET_WINDOW_MS}ms.`
    )
  }
}

async function readBoundedSandboxFetchBody(response: Response): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length')
  if (
    contentLength
    && Number.isFinite(Number(contentLength))
    && Number(contentLength) > SANDBOX_FETCH_MAX_RESPONSE_BYTES
  ) {
    await response.body?.cancel().catch(() => undefined)
    throw new SandboxRuntimeError(
      `Sandbox fetch() response exceeded ${SANDBOX_FETCH_MAX_RESPONSE_BYTES} bytes.`
    )
  }

  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  let complete = false
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        complete = true
        break
      }
      byteLength += chunk.value.byteLength
      if (byteLength > SANDBOX_FETCH_MAX_RESPONSE_BYTES) {
        throw new SandboxRuntimeError(
          `Sandbox fetch() response exceeded ${SANDBOX_FETCH_MAX_RESPONSE_BYTES} bytes.`
        )
      }
      chunks.push(chunk.value)
    }

    const bodyBytes = new Uint8Array(byteLength)
    let offset = 0
    for (const chunk of chunks) {
      bodyBytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bodyBytes
  } finally {
    if (!complete) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function isLocalHttpHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function sanitizeFetchHeaders(rawHeaders: unknown) {
  if (rawHeaders == null) return {}

  const output: Record<string, string> = {}
  const assignHeader = (name: unknown, value: unknown) => {
    if (typeof name !== 'string' || !name.trim()) {
      throw new SandboxRuntimeError(
        'Sandbox fetch() headers must use non-empty string names.'
      )
    }

    const normalizedName = name.toLowerCase()
    if (
      SAFE_FETCH_BLOCKED_HEADER_PATTERNS.some((pattern) =>
        pattern.test(normalizedName)
      )
    ) {
      throw new SandboxRuntimeError(
        `Sandbox fetch() does not allow the "${normalizedName}" header.`
      )
    }

    if (value == null) {
      delete output[normalizedName]
      return
    }

    output[normalizedName] = String(value)
  }

  if (Array.isArray(rawHeaders)) {
    for (const entry of rawHeaders) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new SandboxRuntimeError(
          'Sandbox fetch() header arrays must use [name, value] tuples.'
        )
      }

      assignHeader(entry[0], entry[1])
    }

    return output
  }

  if (typeof rawHeaders !== 'object') {
    throw new SandboxRuntimeError(
      'Sandbox fetch() headers must be a plain object or [name, value][] array.'
    )
  }

  for (const [name, value] of Object.entries(rawHeaders as Record<string, unknown>)) {
    assignHeader(name, value)
  }

  return output
}

function normalizeFetchRequest(
  rawUrl: string,
  rawInit: unknown
): SandboxFetchRequest {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(rawUrl)
  } catch {
    throw new SandboxRuntimeError(
      'Sandbox fetch() requires an absolute URL.'
    )
  }

  if (
    parsedUrl.protocol !== 'https:' &&
    !(parsedUrl.protocol === 'http:' && isLocalHttpHost(parsedUrl.hostname))
  ) {
    throw new SandboxRuntimeError(
      'Sandbox fetch() only supports https URLs and localhost http URLs.'
    )
  }

  if (rawInit == null) {
    return {
      url: parsedUrl.toString(),
      method: 'GET',
      headers: {},
      redirect: 'follow',
    }
  }

  if (typeof rawInit !== 'object' || Array.isArray(rawInit)) {
    throw new SandboxRuntimeError(
      'Sandbox fetch() init must be a plain object.'
    )
  }

  const init = rawInit as Record<string, unknown>
  for (const [key, value] of Object.entries(init)) {
    if (value === undefined) continue
    if (!SAFE_FETCH_ALLOWED_INIT_KEYS.has(key)) {
      throw new SandboxRuntimeError(
        `Sandbox fetch() does not support the "${key}" option.`
      )
    }
  }

  if (init.credentials !== undefined && init.credentials !== 'omit') {
    throw new SandboxRuntimeError(
      'Sandbox fetch() always uses credentials: "omit".'
    )
  }

  if (init.mode !== undefined && init.mode !== 'cors') {
    throw new SandboxRuntimeError(
      'Sandbox fetch() only supports mode: "cors".'
    )
  }

  if (
    init.referrerPolicy !== undefined &&
    init.referrerPolicy !== 'no-referrer'
  ) {
    throw new SandboxRuntimeError(
      'Sandbox fetch() always uses referrerPolicy: "no-referrer".'
    )
  }

  const method =
    typeof init.method === 'string' && init.method.trim()
      ? init.method.trim().toUpperCase()
      : 'GET'

  if (!SAFE_FETCH_ALLOWED_METHODS.has(method)) {
    throw new SandboxRuntimeError(
      `Sandbox fetch() does not support the "${method}" method.`
    )
  }

  const redirect =
    typeof init.redirect === 'string' && init.redirect
      ? init.redirect
      : 'follow'

  if (
    redirect !== 'error' &&
    redirect !== 'follow' &&
    redirect !== 'manual'
  ) {
    throw new SandboxRuntimeError(
      `Sandbox fetch() does not support redirect: "${String(redirect)}".`
    )
  }

  const body = init.body
  if (body != null && method !== 'GET' && method !== 'HEAD') {
    if (typeof body !== 'string') {
      throw new SandboxRuntimeError(
        'Sandbox fetch() currently only supports string request bodies.'
      )
    }
  } else if (body != null) {
    throw new SandboxRuntimeError(
      `Sandbox fetch() does not allow a body with ${method} requests.`
    )
  }

  return {
    url: parsedUrl.toString(),
    method,
    headers: sanitizeFetchHeaders(init.headers),
    body: typeof body === 'string' ? body : undefined,
    redirect,
  }
}

function normalizeSpecifier(value: string) {
  return value.replace(/\/{2,}/g, '/')
}

function isValidBridgeExportName(value: string) {
  return /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(value)
}

function createHostBridgeModuleId(specifier: string) {
  return `${HOST_BRIDGE_MODULE_PREFIX}${encodeURIComponent(specifier)}.js`
}

function createHostBridgeModules(hostBridge?: HostBridge) {
  const moduleIds: Record<string, string> = {}
  const modules: Record<string, string> = {}

  for (const [specifier, bridgeModule] of Object.entries(hostBridge ?? {})) {
    if (!specifier.trim()) {
      throw new SandboxRuntimeError(
        'Sandbox hostBridge specifiers must be non-empty strings.'
      )
    }

    if (specifier === '@arrow-js/core' || specifier.startsWith('/')) {
      throw new SandboxRuntimeError(
        `Sandbox hostBridge cannot override reserved specifier "${specifier}".`
      )
    }

    if (specifier.startsWith('.')) {
      throw new SandboxRuntimeError(
        `Sandbox hostBridge specifiers must be bare imports, received "${specifier}".`
      )
    }

    const exportLines: string[] = []
    for (const [name, handler] of Object.entries(bridgeModule)) {
      if (typeof handler !== 'function') {
        throw new SandboxRuntimeError(
          `Sandbox hostBridge export "${name}" from "${specifier}" must be a function.`
        )
      }

      if (!isValidBridgeExportName(name)) {
        throw new SandboxRuntimeError(
          `Sandbox hostBridge export "${name}" from "${specifier}" must be a valid identifier.`
        )
      }

      exportLines.push(
        `export const ${name} = (...args) => globalThis.__arrowHostBridge(${JSON.stringify(
          specifier
        )}, ${JSON.stringify(name)}, ...args)`
      )
    }

    const moduleId = createHostBridgeModuleId(specifier)
    moduleIds[specifier] = moduleId
    modules[moduleId] = exportLines.join('\n')
  }

  return {
    moduleIds,
    modules,
  }
}

interface SandboxBridgeValueBudget {
  nodes: number
  utf8Bytes: number
}

interface SandboxBridgeValueFrame {
  depth: number
  key: number | string
  parent: Record<string, unknown> | unknown[]
  value?: unknown
  exit?: object
}

function createSandboxBridgeValueBudget(): SandboxBridgeValueBudget {
  return { nodes: 0, utf8Bytes: 0 }
}

function setSandboxBridgeFrameValue(
  frame: SandboxBridgeValueFrame,
  value: unknown
) {
  if (Array.isArray(frame.parent)) {
    frame.parent[Number(frame.key)] = value
    return
  }
  frame.parent[String(frame.key)] = value
}

function consumeSandboxBridgeString(
  value: string,
  path: string,
  budget: SandboxBridgeValueBudget
) {
  const remainingBytes = SANDBOX_MAX_BRIDGE_VALUE_UTF8_BYTES - budget.utf8Bytes
  budget.utf8Bytes += boundedUtf8ByteLength(value, Math.max(0, remainingBytes))
  if (budget.utf8Bytes > SANDBOX_MAX_BRIDGE_VALUE_UTF8_BYTES) {
    throw new SandboxRuntimeError(
      `Sandbox hostBridge ${path} exceeded the ${SANDBOX_MAX_BRIDGE_VALUE_UTF8_BYTES}-byte plain-data budget.`
    )
  }
}

function normalizeBridgeHandle(
  context: any,
  inputHandle: any,
  path: string,
  budget: SandboxBridgeValueBudget
): unknown {
  const root: { value?: unknown } = {}
  const active: any[] = []
  const ownedHandles = new Set<any>()
  const own = (handle: any) => {
    ownedHandles.add(handle)
    return handle
  }
  const release = (handle: any) => {
    if (!ownedHandles.delete(handle)) return
    if (handle.alive) handle.dispose()
  }
  const pending: Array<SandboxBridgeValueFrame & { handle?: any; exitHandle?: any }> = [{
    depth: 1,
    key: 'value',
    parent: root,
    handle: own(inputHandle.dup()),
  }]
  const arrayConstructor = context.getProp(context.global, 'Array')
  const arrayIsArray = context.getProp(arrayConstructor, 'isArray')
  const objectConstructor = context.getProp(context.global, 'Object')
  const objectGetPrototypeOf = context.getProp(objectConstructor, 'getPrototypeOf')
  const objectPrototype = context.getProp(objectConstructor, 'prototype')

  try {
    while (pending.length > 0) {
      const frame = pending.pop()!
      if (frame.exitHandle) {
        const activeHandle = active.pop()
        if (activeHandle !== frame.exitHandle) {
          throw new SandboxRuntimeError('Sandbox hostBridge plain-data traversal lost identity state.')
        }
        release(frame.exitHandle)
        continue
      }

      const handle = frame.handle!
      budget.nodes += 1
      if (budget.nodes > SANDBOX_MAX_BRIDGE_VALUE_NODES) {
        throw new SandboxRuntimeError(
          `Sandbox hostBridge ${path} exceeded the ${SANDBOX_MAX_BRIDGE_VALUE_NODES}-node plain-data budget.`
        )
      }
      if (frame.depth > SANDBOX_MAX_BRIDGE_VALUE_DEPTH) {
        throw new SandboxRuntimeError(
          `Sandbox hostBridge ${path} exceeded the ${SANDBOX_MAX_BRIDGE_VALUE_DEPTH}-level plain-data budget.`
        )
      }

      const valueType = context.typeof(handle)
      if (valueType === 'undefined') {
        setSandboxBridgeFrameValue(frame, undefined)
        release(handle)
        continue
      }
      if (valueType === 'string') {
        const value = context.getString(handle)
        consumeSandboxBridgeString(value, path, budget)
        setSandboxBridgeFrameValue(frame, value)
        release(handle)
        continue
      }
      if (valueType === 'boolean') {
        setSandboxBridgeFrameValue(frame, context.dump(handle))
        release(handle)
        continue
      }
      if (valueType === 'number') {
        const value = context.getNumber(handle)
        if (!Number.isFinite(value)) {
          throw new SandboxRuntimeError(
            `Sandbox hostBridge ${path} must use finite numbers.`
          )
        }
        setSandboxBridgeFrameValue(frame, value)
        release(handle)
        continue
      }
      if (context.eq(handle, context.null)) {
        setSandboxBridgeFrameValue(frame, null)
        release(handle)
        continue
      }
      if (valueType !== 'object') {
        throw new SandboxRuntimeError(
          `Sandbox hostBridge ${path} must be plain serializable data.`
        )
      }
      if (active.some((activeHandle) => context.eq(handle, activeHandle))) {
        throw new SandboxRuntimeError(
          `Sandbox hostBridge ${path} must not contain circular references.`
        )
      }

      const isArrayResult = context.callFunction(arrayIsArray, arrayConstructor, handle)
      const isArrayHandle = context.unwrapResult(isArrayResult)
      const isArray = context.dump(isArrayHandle) === true
      isArrayHandle.dispose()

      if (!isArray) {
        const prototypeResult = context.callFunction(
          objectGetPrototypeOf,
          objectConstructor,
          handle
        )
        const prototypeHandle = context.unwrapResult(prototypeResult)
        const isPlainObject = context.eq(prototypeHandle, objectPrototype)
          || context.eq(prototypeHandle, context.null)
        prototypeHandle.dispose()
        if (!isPlainObject) {
          throw new SandboxRuntimeError(
            `Sandbox hostBridge ${path} must use plain objects.`
          )
        }
      }

      active.push(handle)
      pending.push({
        depth: frame.depth,
        key: frame.key,
        parent: frame.parent,
        exitHandle: handle,
      })

      if (isArray) {
        const length = context.getLength(handle)
        if (
          !Number.isSafeInteger(length)
          || (length as number) < 0
          || (length as number) > SANDBOX_MAX_BRIDGE_VALUE_NODES - budget.nodes
        ) {
          throw new SandboxRuntimeError(
            `Sandbox hostBridge ${path} exceeded the ${SANDBOX_MAX_BRIDGE_VALUE_NODES}-node plain-data budget.`
          )
        }
        const output = new Array<unknown>(length as number)
        setSandboxBridgeFrameValue(frame, output)
        for (let index = (length as number) - 1; index >= 0; index -= 1) {
          pending.push({
            depth: frame.depth + 1,
            handle: own(context.getProp(handle, index)),
            key: index,
            parent: output,
          })
        }
        continue
      }

      const propertyNamesResult = context.getOwnPropertyNames(handle, {
        numbersAsStrings: true,
        onlyEnumerable: true,
        strings: true,
      })
      const propertyNames = context.unwrapResult(propertyNamesResult)
      try {
        if (propertyNames.length > SANDBOX_MAX_BRIDGE_VALUE_NODES - budget.nodes) {
          throw new SandboxRuntimeError(
            `Sandbox hostBridge ${path} exceeded the ${SANDBOX_MAX_BRIDGE_VALUE_NODES}-node plain-data budget.`
          )
        }
        const output: Record<string, unknown> = {}
        setSandboxBridgeFrameValue(frame, output)
        for (let index = propertyNames.length - 1; index >= 0; index -= 1) {
          const key = context.getString(propertyNames[index]!)
          consumeSandboxBridgeString(key, path, budget)
          pending.push({
            depth: frame.depth + 1,
            handle: own(context.getProp(handle, key)),
            key,
            parent: output,
          })
        }
      } finally {
        propertyNames.dispose()
      }
    }

    return root.value
  } finally {
    for (const handle of ownedHandles) {
      if (handle.alive) handle.dispose()
    }
    arrayIsArray.dispose()
    arrayConstructor.dispose()
    objectGetPrototypeOf.dispose()
    objectPrototype.dispose()
    objectConstructor.dispose()
  }
}

function normalizeBridgeValue(
  value: unknown,
  path: string,
  budget: SandboxBridgeValueBudget
): unknown {
  const root: { value?: unknown } = {}
  const active = new Set<object>()
  const pending: SandboxBridgeValueFrame[] = [{
    depth: 1,
    key: 'value',
    parent: root,
    value,
  }]

  while (pending.length > 0) {
    const frame = pending.pop()!
    if (frame.exit) {
      active.delete(frame.exit)
      continue
    }

    budget.nodes += 1
    if (budget.nodes > SANDBOX_MAX_BRIDGE_VALUE_NODES) {
      throw new SandboxRuntimeError(
        `Sandbox hostBridge ${path} exceeded the ${SANDBOX_MAX_BRIDGE_VALUE_NODES}-node plain-data budget.`
      )
    }
    if (frame.depth > SANDBOX_MAX_BRIDGE_VALUE_DEPTH) {
      throw new SandboxRuntimeError(
        `Sandbox hostBridge ${path} exceeded the ${SANDBOX_MAX_BRIDGE_VALUE_DEPTH}-level plain-data budget.`
      )
    }

    const current = frame.value
    if (current == null || typeof current === 'boolean' || typeof current === 'undefined') {
      setSandboxBridgeFrameValue(frame, current)
      continue
    }
    if (typeof current === 'string') {
      consumeSandboxBridgeString(current, path, budget)
      setSandboxBridgeFrameValue(frame, current)
      continue
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        throw new SandboxRuntimeError(
          `Sandbox hostBridge ${path} must use finite numbers.`
        )
      }
      setSandboxBridgeFrameValue(frame, current)
      continue
    }
    if (
      typeof current === 'bigint'
      || typeof current === 'symbol'
      || typeof current === 'function'
      || typeof current !== 'object'
    ) {
      throw new SandboxRuntimeError(
        `Sandbox hostBridge ${path} must be plain serializable data.`
      )
    }
    if (active.has(current)) {
      throw new SandboxRuntimeError(
        `Sandbox hostBridge ${path} must not contain circular references.`
      )
    }

    active.add(current)
    pending.push({ depth: frame.depth, key: frame.key, parent: frame.parent, exit: current })

    if (Array.isArray(current)) {
      if (current.length > SANDBOX_MAX_BRIDGE_VALUE_NODES - budget.nodes) {
        throw new SandboxRuntimeError(
          `Sandbox hostBridge ${path} exceeded the ${SANDBOX_MAX_BRIDGE_VALUE_NODES}-node plain-data budget.`
        )
      }
      const output = new Array<unknown>(current.length)
      setSandboxBridgeFrameValue(frame, output)
      for (let index = current.length - 1; index >= 0; index -= 1) {
        pending.push({
          depth: frame.depth + 1,
          key: index,
          parent: output,
          value: current[index],
        })
      }
      continue
    }

    const prototype = Object.getPrototypeOf(current)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new SandboxRuntimeError(
        `Sandbox hostBridge ${path} must use plain objects.`
      )
    }
    const entries = Object.entries(current as Record<string, unknown>)
    if (entries.length > SANDBOX_MAX_BRIDGE_VALUE_NODES - budget.nodes) {
      throw new SandboxRuntimeError(
        `Sandbox hostBridge ${path} exceeded the ${SANDBOX_MAX_BRIDGE_VALUE_NODES}-node plain-data budget.`
      )
    }
    const output: Record<string, unknown> = {}
    setSandboxBridgeFrameValue(frame, output)
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, entry] = entries[index]!
      consumeSandboxBridgeString(key, path, budget)
      pending.push({
        depth: frame.depth + 1,
        key,
        parent: output,
        value: entry,
      })
    }
  }

  return root.value
}

function toBridgeSource(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value)
    case 'number':
    case 'boolean':
      return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => toBridgeSource(entry)).join(', ')}]`
  }

  return `{${Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => `${JSON.stringify(key)}:${toBridgeSource(entry)}`)
    .join(', ')}}`
}

function resolveModuleSpecifier(
  baseModuleName: string,
  requestedName: string,
  modules: Record<string, string>,
  hostBridgeModuleIds: Record<string, string>
) {
  if (requestedName === '@arrow-js/core') {
    return VM_CORE_MODULE_ID
  }

  if (requestedName in hostBridgeModuleIds) {
    return hostBridgeModuleIds[requestedName] as string
  }

  if (requestedName.startsWith('/')) {
    const normalized = normalizeSpecifier(requestedName)
    if (normalized in modules) return normalized
    return normalized
  }

  if (requestedName.startsWith('.')) {
    const url = new URL(requestedName, `https://arrow-sandbox.local${baseModuleName}`)
    const normalized = normalizeSpecifier(url.pathname)
    if (normalized in modules) return normalized

    const fallbacks = [
      normalized,
      `${normalized}.ts`,
      `${normalized}.js`,
      `${normalized}.mjs`,
      `${normalized}/index.ts`,
      `${normalized}/index.js`,
      `${normalized}/index.mjs`,
    ]

    const found = fallbacks.find((candidate) => candidate in modules)
    if (found) return found
  }

  throw new SandboxRuntimeError(
    `Unsupported sandbox import "${requestedName}" from "${baseModuleName}".`
  )
}

async function getQuickJsModule(debug = false) {
  let modulePromise = quickJsModules.get(debug)
  if (!modulePromise) {
    modulePromise = newQuickJSAsyncWASMModule(debug ? DEBUG_ASYNC : RELEASE_ASYNC)
    quickJsModules.set(debug, modulePromise)
  }

  return modulePromise
}

const SANDBOX_INTERRUPT_CHECK_BUDGET = 128
const SANDBOX_INTERRUPT_WINDOW_CHECK_BUDGET = 1_024
const SANDBOX_EXECUTION_BUDGET_ERROR =
  'Sandbox execution exceeded the host instruction budget.'
const RESET_EXECUTION_BUDGET = '__vibecanvasResetExecutionBudget'

function resetRuntimeExecutionBudget(runtime: any) {
  runtime[RESET_EXECUTION_BUDGET]?.()
}

function normalizeSandboxExecutionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (/interrupted/i.test(message)) {
    return new SandboxRuntimeError(SANDBOX_EXECUTION_BUDGET_ERROR)
  }
  return error
}

function flushPendingJobs(runtime: any, context: any, resetBudget = true) {
  if (resetBudget) resetRuntimeExecutionBudget(runtime)
  while (runtime.hasPendingJob()) {
    context.unwrapResult(runtime.executePendingJobs())
  }
}

function sandboxCancellationError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new SandboxRuntimeError('Sandbox boot was cancelled by its host.')
}

function waitForSandboxPromisePoll(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(sandboxCancellationError(signal))

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      globalThis.clearTimeout(timeoutHandle)
      signal?.removeEventListener('abort', onAbort)
      reject(signal ? sandboxCancellationError(signal) : new SandboxRuntimeError(
        'Sandbox boot was cancelled by its host.'
      ))
    }
    const timeoutHandle = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, SANDBOX_PROMISE_POLL_INTERVAL_MS)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function settleHandle(
  runtime: any,
  context: any,
  handle: any,
  cancellationSignal?: AbortSignal
) {
  while (true) {
    if (cancellationSignal?.aborted) {
      throw sandboxCancellationError(cancellationSignal)
    }
    flushPendingJobs(runtime, context, false)
    const state = context.getPromiseState(handle)
    if (state.type === 'pending') {
      await waitForSandboxPromisePoll(cancellationSignal)
      continue
    }
    const settledHandle = context.unwrapResult(state)
    if (!state.notAPromise) settledHandle.dispose()
    flushPendingJobs(runtime, context, false)
    return
  }
}

async function evalModule(
  runtime: any,
  context: any,
  code: string,
  fileName: string,
  cancellationSignal?: AbortSignal,
  setActiveHandleDisposer?: (disposer: (() => void) | null) => void
) {
  resetRuntimeExecutionBudget(runtime)
  try {
    const result = context.evalCode(code, fileName, { type: 'module' })
    const handle = context.unwrapResult(result)
    let handleDisposed = false
    const disposeHandle = () => {
      if (handleDisposed) return
      handleDisposed = true
      if (handle.alive) handle.dispose()
    }
    setActiveHandleDisposer?.(disposeHandle)
    try {
      await settleHandle(runtime, context, handle, cancellationSignal)
    } finally {
      setActiveHandleDisposer?.(null)
      disposeHandle()
    }
  } catch (error) {
    throw normalizeSandboxExecutionError(error)
  }
}

export async function createVmRunner(
  options: VmRunnerOptions
): Promise<VmRunner> {
  let bootStopped = false
  let disposeBootRuntime: (() => void) | null = null
  const runnerCancellationController = new AbortController()
  let rejectBootCancellation!: (error: Error) => void
  const bootCancellation = new Promise<never>((_resolve, reject) => {
    rejectBootCancellation = reject
  })
  const stopBoot = (error: Error) => {
    if (bootStopped) return
    bootStopped = true
    rejectBootCancellation(error)
    runnerCancellationController.abort(error)
    disposeBootRuntime?.()
  }
  const abortBoot = () => stopBoot(
    new SandboxRuntimeError('Sandbox boot was cancelled by its host.')
  )
  options.signal?.addEventListener('abort', abortBoot, { once: true })
  const bootTimeoutHandle = globalThis.setTimeout(() => {
    stopBoot(new SandboxRuntimeError(
      `Sandbox boot exceeded the host deadline of ${SANDBOX_BOOT_TIMEOUT_MS}ms.`
    ))
  }, SANDBOX_BOOT_TIMEOUT_MS)
  if (options.signal?.aborted) abortBoot()

  try {
  const quickJs = await Promise.race([
    getQuickJsModule(!!options.debug),
    bootCancellation,
  ])
  const runtime = quickJs.newRuntime()
  runtime.setMemoryLimit(16 * 1024 * 1024)
  runtime.setMaxStackSize(512 * 1024)
  let executionWindowStartedAtMs = Date.now()
  let remainingInterruptChecks = SANDBOX_INTERRUPT_CHECK_BUDGET
  let remainingWindowInterruptChecks = SANDBOX_INTERRUPT_WINDOW_CHECK_BUDGET
  Object.defineProperty(runtime, RESET_EXECUTION_BUDGET, {
    configurable: false,
    enumerable: false,
    value: () => {
      const now = Date.now()
      if (
        now < executionWindowStartedAtMs
        || now - executionWindowStartedAtMs >= SANDBOX_ASYNC_BUDGET_WINDOW_MS
      ) {
        executionWindowStartedAtMs = now
        remainingWindowInterruptChecks = SANDBOX_INTERRUPT_WINDOW_CHECK_BUDGET
      }
      remainingInterruptChecks = SANDBOX_INTERRUPT_CHECK_BUDGET
    },
    writable: false,
  })
  runtime.setInterruptHandler(() => {
    remainingInterruptChecks -= 1
    remainingWindowInterruptChecks -= 1
    return remainingInterruptChecks < 0 || remainingWindowInterruptChecks < 0
  })

  const context = runtime.newContext()
  let destroyed = false
  let activeEvaluationHandleDisposer: (() => void) | null = null
  let activeDispatch = false
  let nextDispatchId = 0
  let runtimeFatalError: Error | null = null
  const dispatchQueue: SandboxDispatchRecord[] = []
  let nextTimerId = 0
  const timers = new Map<number, SandboxTimerRecord>()
  const { moduleIds: hostBridgeModuleIds, modules: hostBridgeModules } =
    createHostBridgeModules(options.hostBridge)
  const modules = {
    ...vmRuntimeModules,
    ...hostBridgeModules,
    ...options.compiled.modules,
  }

  const formatRuntimeError = (error: unknown) => {
    const normalized = normalizeSandboxExecutionError(error)
    return normalized instanceof Error
      ? [normalized.message, normalized.stack].filter(Boolean).join('\n')
      : String(normalized)
  }

  const reportRuntimeError = (error: unknown) => {
    options.onMessage({
      type: 'error',
      error: formatRuntimeError(error),
    })
  }

  let pendingJobDrainScheduled = false
  let pendingJobDrainPasses = 0
  const schedulePendingJobDrain = (extraPasses = 4) => {
    if (destroyed) return

    pendingJobDrainPasses = Math.max(pendingJobDrainPasses, extraPasses)
    if (pendingJobDrainScheduled) return

    pendingJobDrainScheduled = true
    queueMicrotask(() => {
      pendingJobDrainScheduled = false
      if (destroyed) return

      try {
        flushPendingJobs(runtime, context)
      } catch (error) {
        pendingJobDrainPasses = 0
        reportRuntimeError(error)
        disposeVmRuntime()
        return
      }

      pendingJobDrainPasses -= 1
      if (runtime.hasPendingJob() || pendingJobDrainPasses > 0) {
        schedulePendingJobDrain(0)
        return
      }

      pendingJobDrainPasses = 0
    })
  }

  const pendingFetches = new Set<SandboxFetchRecord>()
  const pendingBridgeCalls = new Set<SandboxBridgeRecord>()
  const createRateBudget = (): SandboxRateBudget => ({
    startedAtMs: Date.now(),
    used: 0,
  })
  const timerScheduleRateBudget = createRateBudget()
  const timerCallbackRateBudget = createRateBudget()
  const fetchStartRateBudget = createRateBudget()
  const bridgeStartRateBudget = createRateBudget()
  const vmMessageRateBudget = createRateBudget()
  const createErrorHandle = (error: unknown) => {
    if (error instanceof Error) {
      return context.newError({
        name: error.name || 'Error',
        message: error.message || String(error),
      })
    }

    return context.newError(String(error))
  }

  const createFetchResponseHandle = (response: SandboxFetchResponseData) => {
    const responseSource = `(() => {
      const __bodyText = ${JSON.stringify(textDecoder.decode(response.bodyBytes))}
      const __headers = ${JSON.stringify(response.headers)}
      const __bodyBytes = Uint8Array.from(${JSON.stringify(
        Array.from(response.bodyBytes)
      )})

      return {
        ok: ${response.ok ? 'true' : 'false'},
        status: ${JSON.stringify(response.status)},
        statusText: ${JSON.stringify(response.statusText)},
        url: ${JSON.stringify(response.url)},
        redirected: ${response.redirected ? 'true' : 'false'},
        headers: {
          ...__headers,
          get(name) {
            return __headers[String(name).toLowerCase()]
          },
          has(name) {
            return Object.prototype.hasOwnProperty.call(
              __headers,
              String(name).toLowerCase()
            )
          },
          entries() {
            return Object.entries(__headers)
          },
          keys() {
            return Object.keys(__headers)
          },
          values() {
            return Object.values(__headers)
          },
        },
        text() {
          return __bodyText
        },
        json() {
          return JSON.parse(__bodyText)
        },
        arrayBuffer() {
          return __bodyBytes.slice().buffer
        },
      }
    })()`

    return context.unwrapResult(
      context.evalCode(
        responseSource,
        '/__arrow_sandbox/fetch-response.js'
      )
    )
  }

  const createBridgeValueHandle = (value: unknown) =>
    context.unwrapResult(
      context.evalCode(
        `(${toBridgeSource(value)})`,
        '/__arrow_sandbox/host-bridge-value.js'
      )
    )

  const clearPendingFetch = (record: SandboxFetchRecord) => {
    if (!record.active) return

    record.active = false
    pendingFetches.delete(record)
    if (record.timeoutHandle) {
      clearTimeout(record.timeoutHandle)
      record.timeoutHandle = null
    }
  }

  const clearPendingBridgeCall = (record: SandboxBridgeRecord) => {
    if (!record.active) return
    record.active = false
    pendingBridgeCalls.delete(record)
  }

  const rejectPendingFetch = (record: SandboxFetchRecord, error: unknown) => {
    if (!record.active) return
    clearPendingFetch(record)

    if (destroyed) {
      record.deferred.dispose()
      return
    }

    const errorHandle = createErrorHandle(error)
    try {
      record.deferred.reject(errorHandle)
    } finally {
      errorHandle.dispose()
    }
    schedulePendingJobDrain()
  }

  const resolvePendingFetch = (
    record: SandboxFetchRecord,
    response: SandboxFetchResponseData
  ) => {
    if (!record.active) return
    clearPendingFetch(record)

    if (destroyed) {
      record.deferred.dispose()
      return
    }

    try {
      const responseHandle = createFetchResponseHandle(response)
      try {
        record.deferred.resolve(responseHandle)
      } finally {
        responseHandle.dispose()
      }
    } catch (error) {
      const errorHandle = createErrorHandle(error)
      try {
        record.deferred.reject(errorHandle)
      } finally {
        errorHandle.dispose()
      }
    }

    schedulePendingJobDrain()
  }

  const rejectPendingBridgeCall = (record: SandboxBridgeRecord, error: unknown) => {
    if (!record.active) return
    clearPendingBridgeCall(record)

    if (destroyed) {
      record.deferred.dispose()
      return
    }

    const errorHandle = createErrorHandle(error)
    try {
      record.deferred.reject(errorHandle)
    } finally {
      errorHandle.dispose()
    }

    schedulePendingJobDrain()
  }

  const resolvePendingBridgeCall = (
    record: SandboxBridgeRecord,
    payload: unknown
  ) => {
    if (!record.active) return
    clearPendingBridgeCall(record)

    if (destroyed) {
      record.deferred.dispose()
      return
    }

    try {
      const valueHandle = createBridgeValueHandle(payload)
      try {
        record.deferred.resolve(valueHandle)
      } finally {
        valueHandle.dispose()
      }
    } catch (error) {
      const errorHandle = createErrorHandle(error)
      try {
        record.deferred.reject(errorHandle)
      } finally {
        errorHandle.dispose()
      }
    }

    schedulePendingJobDrain()
  }

  const disposeTimerRecord = (timer: SandboxTimerRecord) => {
    timer.callback.dispose()
    for (const arg of timer.args) {
      arg.dispose()
    }
  }

  const clearTimer = (timerId: number) => {
    const timer = timers.get(timerId)
    if (!timer) return

    timers.delete(timerId)
    if (timer.repeat) {
      clearInterval(timer.handle as ReturnType<typeof globalThis.setInterval>)
    } else {
      clearTimeout(timer.handle as ReturnType<typeof globalThis.setTimeout>)
    }
    disposeTimerRecord(timer)
  }

  const settleQueuedDispatches = (error?: Error) => {
    for (const record of dispatchQueue.splice(0)) {
      if (error) record.reject(error)
      else record.resolve()
    }
  }

  const failVmRuntime = (error: unknown) => {
    if (runtimeFatalError) return runtimeFatalError
    const normalized = normalizeSandboxExecutionError(error)
    runtimeFatalError = normalized instanceof Error
      ? normalized
      : new SandboxRuntimeError(String(normalized))
    runnerCancellationController.abort(runtimeFatalError)
    disposeVmRuntime()
    return runtimeFatalError
  }

  const dispatchToVm = async (message: HostToVmMessage) => {
    if (destroyed) return

    nextDispatchId += 1
    const timeoutHandle = globalThis.setTimeout(() => {
      failVmRuntime(new SandboxRuntimeError(
        `Sandbox event dispatch exceeded the host deadline of ${SANDBOX_EVENT_DISPATCH_TIMEOUT_MS}ms.`
      ))
    }, SANDBOX_EVENT_DISPATCH_TIMEOUT_MS)
    try {
      await evalModule(
        runtime,
        context,
        `await globalThis.__arrowSandboxDispatch(${JSON.stringify(message)})`,
        `/__arrow_sandbox/dispatch-${nextDispatchId}.js`,
        runnerCancellationController.signal,
        (disposer) => { activeEvaluationHandleDisposer = disposer }
      )
      if (!destroyed) schedulePendingJobDrain()
    } finally {
      globalThis.clearTimeout(timeoutHandle)
    }
  }

  const drainDispatchQueue = async () => {
    if (activeDispatch || destroyed) return
    activeDispatch = true
    try {
      while (!destroyed && dispatchQueue.length > 0) {
        const record = dispatchQueue.shift()!
        try {
          await dispatchToVm(record.message)
          record.resolve()
        } catch (error) {
          if (destroyed && !runtimeFatalError) {
            record.resolve()
            return
          }
          const fatalError = runtimeFatalError ?? failVmRuntime(error)
          record.reject(fatalError)
          return
        }
      }
    } finally {
      activeDispatch = false
    }
  }

  const enqueueDispatch = (message: HostToVmMessage): Promise<void> => {
    if (destroyed) {
      return runtimeFatalError ? Promise.reject(runtimeFatalError) : Promise.resolve()
    }

    if (message.type === 'event' && message.payload.event.type === 'pointermove') {
      for (let index = dispatchQueue.length - 1; index >= 0; index -= 1) {
        const queued = dispatchQueue[index]!
        if (
          queued.message.type === 'event'
          && queued.message.payload.event.type === 'pointermove'
          && queued.message.payload.handlerId === message.payload.handlerId
        ) {
          queued.message = message
          return Promise.resolve()
        }
      }
    }

    const pendingDispatchCount = dispatchQueue.length + (activeDispatch ? 1 : 0)
    if (pendingDispatchCount >= SANDBOX_MAX_PENDING_EVENT_DISPATCHES) {
      const error = failVmRuntime(new SandboxRuntimeError(
        `Sandbox events exceeded the host cap of ${SANDBOX_MAX_PENDING_EVENT_DISPATCHES} pending dispatches.`
      ))
      return Promise.reject(error)
    }

    return new Promise((resolve, reject) => {
      dispatchQueue.push({ message, resolve, reject })
      void drainDispatchQueue()
    })
  }

  const fireTimer = async (timerId: number) => {
    const timer = timers.get(timerId)
    if (!timer || destroyed) return

    if (!timer.repeat) {
      timers.delete(timerId)
      clearTimeout(timer.handle as ReturnType<typeof globalThis.setTimeout>)
    }

    const callback = timer.callback.dup()
    const args = timer.args.map((arg) => arg.dup())
    let failure: unknown

    try {
      consumeSandboxRateBudget(
        timerCallbackRateBudget,
        SANDBOX_MAX_TIMER_CALLBACKS_PER_WINDOW,
        'timer callbacks'
      )
      resetRuntimeExecutionBudget(runtime)
      const result = context.callFunction(callback, context.undefined, args)
      const returnedHandle = context.unwrapResult(result)
      returnedHandle.dispose()
      flushPendingJobs(runtime, context, false)
      schedulePendingJobDrain()
    } catch (error) {
      failure = error
    } finally {
      callback.dispose()
      for (const arg of args) {
        arg.dispose()
      }

      if (!timer.repeat) {
        disposeTimerRecord(timer)
      }
    }

    if (failure !== undefined) {
      reportRuntimeError(failure)
      disposeVmRuntime()
    }
  }

  const scheduleTimer = (
    callbackHandle: any,
    delayHandle: any,
    argHandles: any[],
    repeat: boolean
  ) => {
    if (context.typeof(callbackHandle) !== 'function') {
      throw new Error('Sandbox timers require a callable callback.')
    }

    if (timers.size >= SANDBOX_MAX_ACTIVE_TIMERS) {
      throw new SandboxRuntimeError(
        `Sandbox timers exceeded the host cap of ${SANDBOX_MAX_ACTIVE_TIMERS} active timers.`
      )
    }
    consumeSandboxRateBudget(
      timerScheduleRateBudget,
      SANDBOX_MAX_TIMER_SCHEDULES_PER_WINDOW,
      'timer scheduling'
    )

    nextTimerId += 1
    const timerId = nextTimerId
    const delayValue = context.getNumber(delayHandle)
    const delay = Number.isFinite(delayValue)
      ? Math.min(Math.max(delayValue, SANDBOX_MIN_TIMER_DELAY_MS), 2_147_483_647)
      : SANDBOX_MIN_TIMER_DELAY_MS

    const timerRecord: SandboxTimerRecord = {
      callback: callbackHandle.dup(),
      args: argHandles.map((arg) => arg.dup()),
      handle: repeat
        ? globalThis.setInterval(() => {
            void fireTimer(timerId)
          }, delay)
        : globalThis.setTimeout(() => {
            void fireTimer(timerId)
          }, delay),
      repeat,
    }

    timers.set(timerId, timerRecord)
    return context.newNumber(timerId)
  }

  const hostSend = context.newFunction('__arrowHostSend', (messageHandle: any) => {
    consumeSandboxRateBudget(
      vmMessageRateBudget,
      SANDBOX_MAX_VM_MESSAGES_PER_WINDOW,
      'VM messages'
    )
    if (context.typeof(messageHandle) !== 'string') {
      throw sandboxProtocolError('must be serialized as a string')
    }
    const message = context.getString(messageHandle)
    options.onMessage(parseSandboxVmMessage(message))
  })
  context.setProp(context.global, '__arrowHostSend', hostSend)
  hostSend.dispose()

  const hostBridgeHandle = context.newFunction(
    '__arrowHostBridge',
    (specifierHandle: any, exportNameHandle: any, ...argHandles: any[]) => {
      consumeSandboxRateBudget(
        bridgeStartRateBudget,
        SANDBOX_MAX_BRIDGE_STARTS_PER_WINDOW,
        'hostBridge calls'
      )
      if (pendingBridgeCalls.size >= SANDBOX_MAX_PENDING_BRIDGE_CALLS) {
        throw new SandboxRuntimeError(
          `Sandbox hostBridge exceeded the host cap of ${SANDBOX_MAX_PENDING_BRIDGE_CALLS} pending calls.`
        )
      }
      if (context.typeof(specifierHandle) !== 'string') {
        throw new SandboxRuntimeError(
          'Sandbox hostBridge requires a string module specifier.'
        )
      }

      if (context.typeof(exportNameHandle) !== 'string') {
        throw new SandboxRuntimeError(
          'Sandbox hostBridge requires a string export name.'
        )
      }

      const specifier = context.getString(specifierHandle)
      const exportName = context.getString(exportNameHandle)
      if (
        specifier.length > SANDBOX_MAX_BRIDGE_IDENTIFIER_CHARACTERS
        || exportName.length > SANDBOX_MAX_BRIDGE_IDENTIFIER_CHARACTERS
      ) {
        throw new SandboxRuntimeError(
          'Sandbox hostBridge module and export identifiers are too long.'
        )
      }
      const bridgeModule = options.hostBridge?.[specifier]
      const bridgeHandler = bridgeModule?.[exportName]

      if (!bridgeModule || typeof bridgeHandler !== 'function') {
        throw new SandboxRuntimeError(
          `Unknown sandbox hostBridge export "${exportName}" from "${specifier}".`
        )
      }

      const bridgeValueBudget = createSandboxBridgeValueBudget()
      const args = argHandles.map((argHandle, index) =>
        normalizeBridgeHandle(
          context,
          argHandle,
          `argument[${index}]`,
          bridgeValueBudget
        )
      )

      const deferred = context.newPromise()
      const record: SandboxBridgeRecord = {
        deferred,
        active: true,
      }
      pendingBridgeCalls.add(record)

      void Promise.resolve()
        .then(() => bridgeHandler(...args))
        .then((value) => {
          try {
            resolvePendingBridgeCall(
              record,
              normalizeBridgeValue(value, 'return value', bridgeValueBudget)
            )
          } catch (error) {
            rejectPendingBridgeCall(record, error)
          }
        })
        .catch((error) => rejectPendingBridgeCall(record, error))

      return deferred.handle
    }
  )
  context.setProp(context.global, '__arrowHostBridge', hostBridgeHandle)
  hostBridgeHandle.dispose()

  const setTimeoutHandle = context.newFunction(
    'setTimeout',
    (callbackHandle: any, delayHandle: any, ...argHandles: any[]) =>
      scheduleTimer(callbackHandle, delayHandle, argHandles, false)
  )
  context.setProp(context.global, 'setTimeout', setTimeoutHandle)
  setTimeoutHandle.dispose()

  const clearTimeoutHandle = context.newFunction(
    'clearTimeout',
    (timerIdHandle: any) => {
      clearTimer(context.getNumber(timerIdHandle))
    }
  )
  context.setProp(context.global, 'clearTimeout', clearTimeoutHandle)
  clearTimeoutHandle.dispose()

  const setIntervalHandle = context.newFunction(
    'setInterval',
    (callbackHandle: any, delayHandle: any, ...argHandles: any[]) =>
      scheduleTimer(callbackHandle, delayHandle, argHandles, true)
  )
  context.setProp(context.global, 'setInterval', setIntervalHandle)
  setIntervalHandle.dispose()

  const clearIntervalHandle = context.newFunction(
    'clearInterval',
    (timerIdHandle: any) => {
      clearTimer(context.getNumber(timerIdHandle))
    }
  )
  context.setProp(context.global, 'clearInterval', clearIntervalHandle)
  clearIntervalHandle.dispose()

  const fetchHandle = context.newFunction(
    'fetch',
    (inputHandle: any, initHandle: any) => {
      if (typeof globalThis.fetch !== 'function') {
        throw new SandboxRuntimeError(
          'Sandbox fetch() is not available in this host environment.'
        )
      }

      if (context.typeof(inputHandle) !== 'string') {
        throw new SandboxRuntimeError(
          'Sandbox fetch() currently only supports string URLs.'
        )
      }

      const request = normalizeFetchRequest(
        context.getString(inputHandle),
        !initHandle || context.typeof(initHandle) === 'undefined'
          ? undefined
          : context.dump(initHandle)
      )

      if (pendingFetches.size >= SANDBOX_MAX_PENDING_FETCHES) {
        throw new SandboxRuntimeError(
          `Sandbox fetch() exceeded the host cap of ${SANDBOX_MAX_PENDING_FETCHES} pending requests.`
        )
      }
      consumeSandboxRateBudget(
        fetchStartRateBudget,
        SANDBOX_MAX_FETCH_STARTS_PER_WINDOW,
        'fetch() calls'
      )

      const deferred = context.newPromise()
      const record: SandboxFetchRecord = {
        controller: new AbortController(),
        deferred,
        timeoutHandle: null,
        active: true,
        timedOut: false,
      }
      pendingFetches.add(record)

      record.timeoutHandle = globalThis.setTimeout(() => {
        if (!record.active) return
        record.timedOut = true
        record.controller.abort()
      }, SANDBOX_FETCH_TIMEOUT_MS)

      void globalThis
        .fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
          mode: 'cors',
          credentials: 'omit',
          redirect: request.redirect,
          referrerPolicy: 'no-referrer',
          signal: record.controller.signal,
        })
        .then(async (response) => {
          if (!record.active || destroyed) return
          const bodyBytes = await readBoundedSandboxFetchBody(response)
          if (!record.active || destroyed) return

          const headers: Record<string, string> = {}
          response.headers.forEach((value, name) => {
            headers[name.toLowerCase()] = value
          })

          resolvePendingFetch(record, {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            url: response.url || request.url,
            redirected: response.redirected,
            headers,
            bodyBytes,
          })
        })
        .catch((error) => {
          if (!record.active || destroyed) return

          if (record.timedOut) {
            rejectPendingFetch(
              record,
              new SandboxRuntimeError(
                `Sandbox fetch() timed out after ${SANDBOX_FETCH_TIMEOUT_MS}ms.`
              )
            )
            return
          }

          rejectPendingFetch(record, error)
        })

      return deferred.handle
    }
  )
  context.setProp(context.global, 'fetch', fetchHandle)
  fetchHandle.dispose()

  const disposeVmRuntime = () => {
    if (destroyed) return
    try {
      destroyed = true
      runnerCancellationController.abort(new SandboxRuntimeError(
        'Sandbox runtime was destroyed by its host.'
      ))
      activeEvaluationHandleDisposer?.()
      activeEvaluationHandleDisposer = null
      settleQueuedDispatches(runtimeFatalError ?? undefined)
      pendingJobDrainPasses = 0
      for (const timerId of Array.from(timers.keys())) {
        clearTimer(timerId)
      }
      for (const record of Array.from(pendingFetches)) {
        clearPendingFetch(record)
        record.controller.abort()
        record.deferred.dispose()
      }
      for (const record of Array.from(pendingBridgeCalls)) {
        clearPendingBridgeCall(record)
        record.deferred.dispose()
      }
      if (context.alive) {
        try {
          const result = context.evalCode(
            'globalThis.__arrowHostSend = undefined; globalThis.__arrowHostBridge = undefined; globalThis.console = undefined; globalThis.setTimeout = undefined; globalThis.clearTimeout = undefined; globalThis.setInterval = undefined; globalThis.clearInterval = undefined; globalThis.fetch = undefined; globalThis.output = undefined;'
          )
          context.unwrapResult(result).dispose()
        } catch {}
        context.dispose()
      }
    } finally {
      if (runtime.alive) runtime.dispose()
    }
  }
  disposeBootRuntime = disposeVmRuntime
  if (bootStopped) {
    disposeVmRuntime()
    await bootCancellation
  }

  runtime.setModuleLoader(
    (moduleName: string) => {
      const source = modules[moduleName]
      if (!source) {
        throw new SandboxRuntimeError(`Unknown sandbox module "${moduleName}".`)
      }
      return source
    },
    (baseModuleName: string, requestedName: string) =>
      resolveModuleSpecifier(
        baseModuleName,
        requestedName,
        modules,
        hostBridgeModuleIds
      )
  )

  try {
    await evalModule(
      runtime,
      context,
      `import ${JSON.stringify(VM_BOOTSTRAP_MODULE_ID)}`,
      '/__arrow_sandbox/bootstrap-loader.js',
      runnerCancellationController.signal,
      (disposer) => { activeEvaluationHandleDisposer = disposer }
  )

  const initPayload: VmInitPayload = {
    entryPath: options.compiled.entryPath,
    descriptors: options.compiled.descriptors,
    debug: options.debug,
  }

  await evalModule(
    runtime,
    context,
    `await globalThis.__arrowSandboxInit(${JSON.stringify(initPayload)})`,
    '/__arrow_sandbox/init.js',
    runnerCancellationController.signal,
    (disposer) => { activeEvaluationHandleDisposer = disposer }
  )
    schedulePendingJobDrain()
  } catch (error) {
    disposeVmRuntime()
    throw error
  }

  return {
    async dispatch(message: HostToVmMessage) {
      await enqueueDispatch(message)
    },
    destroy() {
      disposeVmRuntime()
    },
  }
  } finally {
    bootStopped = true
    disposeBootRuntime = null
    globalThis.clearTimeout(bootTimeoutHandle)
    options.signal?.removeEventListener('abort', abortBoot)
  }
}
