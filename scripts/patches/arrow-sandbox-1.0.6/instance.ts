import { component, html, watch } from '@arrow-js/core'
import type { ArrowTemplate, Props } from '@arrow-js/core'
import type {
  HostBridge,
  HostToVmMessage,
  SandboxEvents,
  SandboxProps,
  SerializedNode,
  VmPatch,
  VmToHostMessage,
} from '../shared/protocol'
import { normalizeVirtualPath } from '../compiler/normalize'
import { HostRenderer } from './renderer'
import { formatError, toDisplayError } from './errors'
import type { compileSandboxGraph as compileSandboxGraphType } from '../compiler'
import type { VmRunner } from './quickjs'

interface BootResult {
  runner: VmRunner
  initialTree: SerializedNode
  initialPatches: VmPatch[]
}

interface SandboxBootRuntime {
  compileSandboxGraph: typeof compileSandboxGraphType
  createVmRunner: typeof import('./quickjs').createVmRunner
}

interface ResolvedSandboxProps {
  cssText?: string
  debug?: boolean
  onError?: (error: Error | string) => void
  shadowDOM: boolean
  source: Record<string, string>
  sourceSignature: string
}

type SandboxHostProps = Omit<SandboxProps, 'source'> & {
  source: object
}

type SandboxTemplateProps = Record<PropertyKey, unknown> & {
  config: SandboxHostProps
  events?: SandboxEvents
  hostBridge?: HostBridge
}

const SANDBOX_TAG_NAME = 'arrow-sandbox'
const SANDBOX_MAX_INITIAL_PATCHES = 1_024
const sandboxHostRecords = new Map<string, SandboxHostRecord>()
const sandboxHostElements = new Map<string, ArrowSandboxElement>()
let nextSandboxHostId = 0
let sandboxBootRuntimePromise: Promise<SandboxBootRuntime> | null = null
let nextHostBridgeFunctionId = 0
const hostBridgeFunctionIds = new WeakMap<Function, number>()

interface SandboxHostRecord {
  events?: SandboxEvents
  hostBridge?: HostBridge
  props: ResolvedSandboxProps
}

class SandboxController {
  private props: ResolvedSandboxProps
  private events: SandboxEvents | undefined
  private hostBridge: HostBridge | undefined
  private readonly mountPoint: Element
  private readonly renderer: HostRenderer
  private runner: VmRunner | null = null
  private readonly bootAbortController = new AbortController()
  private deferRunnerDestroy = false
  private failed = false
  private fatalError: unknown
  private readonly onFatal: (controller: SandboxController, error: unknown) => void

  constructor(
    mountPoint: Element,
    props: ResolvedSandboxProps,
    events: SandboxEvents | undefined,
    hostBridge: HostBridge | undefined,
    onFatal: (controller: SandboxController, error: unknown) => void
  ) {
    this.mountPoint = mountPoint
    this.props = props
    this.events = events
    this.hostBridge = hostBridge
    this.onFatal = onFatal
    this.renderer = new HostRenderer({
      mountPoint,
      onEvent: (handlerId, payload) =>
        this.dispatch({
          type: 'event',
          payload: {
            handlerId,
            event: payload,
          },
        }),
      onError: (error) => this.fail(error, true),
    })
  }

  setCallbacks(
    props: ResolvedSandboxProps,
    events?: SandboxEvents,
    hostBridge?: HostBridge
  ) {
    this.props = props
    this.events = events
    this.hostBridge = hostBridge
  }

  async mount() {
    try {
      const booted = await this.boot()
      if (this.failed) {
        booted.runner.destroy()
        throw this.fatalError
      }
      this.runner?.destroy()
      this.runner = booted.runner
      this.renderer.render(booted.initialTree)
      if (this.failed) throw this.fatalError
      this.renderer.applyPatches(booted.initialPatches)
      if (this.failed) throw this.fatalError
    } catch (error) {
      if (!this.failed) this.handleError(error)
      this.destroy()
      throw error
    }
  }

  destroy() {
    this.bootAbortController.abort()
    const runner = this.runner
    this.runner = null
    this.renderer.destroy()
    if (runner) {
      if (this.deferRunnerDestroy) queueMicrotask(() => runner.destroy())
      else runner.destroy()
    }
  }

  private async boot(): Promise<BootResult> {
    const runtime = await loadSandboxBootRuntime()
    const compiled = runtime.compileSandboxGraph({
      source: this.props.source,
      debug: this.props.debug,
      onError: this.props.onError,
      shadowDOM: this.props.shadowDOM,
    })
    let initialTree: SerializedNode | null = null
    let activated = false
    const initialPatches: VmPatch[] = []

    const runner = await runtime.createVmRunner({
      compiled,
      debug: this.props.debug,
      hostBridge: this.hostBridge,
      signal: this.bootAbortController.signal,
      onMessage: (message) => {
        if (this.failed) return
        switch (message.type) {
          case 'render':
            if (!activated) {
              if (initialTree !== null) {
                throw new Error('Sandbox VM emitted more than one initial render tree.')
              }
              initialTree = message.tree
              return
            }
            this.renderer.render(message.tree)
            return
          case 'patch':
            if (!activated) {
              if (
                initialPatches.length + message.patches.length
                  > SANDBOX_MAX_INITIAL_PATCHES
              ) {
                throw new Error(
                  `Sandbox VM exceeded the boot cap of ${SANDBOX_MAX_INITIAL_PATCHES} initial patches.`
                )
              }
              initialPatches.push(...message.patches)
              return
            }
            this.renderer.applyPatches(message.patches)
            return
          case 'error':
            this.fail(message.error)
            return
          case 'log':
            if (!this.props.debug) return
            if (message.method === 'trace') {
              console.log(...message.args)
              return
            }
            {
              const method = (
                console as unknown as Record<
                  string,
                  ((...args: unknown[]) => void) | undefined
                >
              )[message.method]
              if (typeof method === 'function') {
                method.apply(console, message.args)
                return
              }
            }
            console.log(...message.args)
            return
          case 'output':
            this.events?.output?.(message.payload)
            return
          case 'ready':
            return
        }
      },
    })

    if (!initialTree) {
      runner.destroy()
      throw new Error('Sandbox VM did not emit an initial render tree.')
    }

    activated = true
    return {
      runner,
      initialTree,
      initialPatches,
    }
  }

  private async dispatch(message: HostToVmMessage) {
    if (!this.runner) return

    try {
      await this.runner.dispatch(message)
    } catch (error) {
      this.fail(error)
    }
  }

  private fail(error: unknown, fromRenderer = false) {
    if (this.failed) return
    if (fromRenderer) this.deferRunnerDestroy = true
    this.failed = true
    this.fatalError = error
    let reportingError: unknown
    try {
      this.handleError(error)
    } catch (caught) {
      reportingError = caught
    }
    try {
      this.destroy()
    } finally {
      this.onFatal(this, error)
    }
    if (reportingError !== undefined) throw reportingError
  }

  private handleError(error: unknown) {
    this.props.onError?.(toDisplayError(error))
    if (!this.props.onError) {
      console.error(formatError(error))
    }
  }
}

function loadSandboxBootRuntime(): Promise<SandboxBootRuntime> {
  if (sandboxBootRuntimePromise) {
    return sandboxBootRuntimePromise
  }

  sandboxBootRuntimePromise = Promise.all([
    import('../compiler'),
    import('./quickjs'),
  ]).then(([compiler, quickjs]) => ({
    compileSandboxGraph: compiler.compileSandboxGraph,
    createVmRunner: quickjs.createVmRunner,
  }))

  return sandboxBootRuntimePromise
}

class ArrowSandboxElement extends HTMLElement {
  static get observedAttributes() {
    return ['data-sandbox-id']
  }

  private controller: SandboxController | null = null
  private mountingController: SandboxController | null = null
  private currentSignature = ''
  private hostId: string | null = null
  private mountPoint: HTMLDivElement | null = null
  private hostBridgeState: HostBridge | undefined
  private sandboxEventsState: SandboxEvents | undefined
  private sandboxPropsValue: ResolvedSandboxProps | null = null
  private shadowMode = false
  private styleElement: HTMLStyleElement | null = null
  private syncQueued = false
  private syncVersion = 0

  connectedCallback() {
    this.attachHostRecord()
  }

  disconnectedCallback() {
    this.syncVersion += 1
    if (this.hostId && sandboxHostElements.get(this.hostId) === this) {
      const hostId = this.hostId
      sandboxHostElements.delete(hostId)
      queueMicrotask(() => {
        if (!sandboxHostElements.has(hostId)) {
          sandboxHostRecords.delete(hostId)
        }
      })
    }
    this.destroyController()
  }

  attributeChangedCallback(name: string) {
    if (name === 'data-sandbox-id') {
      this.attachHostRecord()
    }
  }

  applyRecord(record: SandboxHostRecord) {
    this.sandboxPropsValue = record.props
    this.sandboxEventsState = record.events
    this.hostBridgeState = record.hostBridge
    if (this.controller && this.sandboxPropsValue) {
      this.controller.setCallbacks(
        this.sandboxPropsValue,
        this.sandboxEventsState,
        this.hostBridgeState
      )
    }
    this.requestSync()
  }

  private destroyController() {
    this.mountingController?.destroy()
    this.mountingController = null
    this.controller?.destroy()
    this.controller = null
    this.currentSignature = ''
    this.removeAttribute('data-ready')
  }

  private reportSandboxError(error: unknown) {
    this.dataset.ready = 'error'
    this.dispatchEvent(
      new CustomEvent('sandbox-error', {
        detail: error,
      })
    )
  }

  private requestSync() {
    if (this.syncQueued) return
    this.syncQueued = true
    queueMicrotask(() => {
      this.syncQueued = false
      void this.sync()
    })
  }

  private attachHostRecord() {
    const nextHostId = this.getAttribute('data-sandbox-id')
    if (!nextHostId) return

    this.hostId = nextHostId
    sandboxHostElements.set(nextHostId, this)
    const record = sandboxHostRecords.get(nextHostId)
    if (record) {
      this.applyRecord(record)
    } else {
      this.requestSync()
    }
  }

  private ensureSurface(shadowDOM: boolean) {
    if (
      this.mountPoint &&
      this.styleElement &&
      this.shadowMode === shadowDOM
    ) {
      return
    }

    this.destroyController()

    if (shadowDOM) {
      const root =
        this.shadowRoot ??
        this.attachShadow({
          mode: 'open',
        })
      root.replaceChildren()
      this.replaceChildren()
      this.styleElement = document.createElement('style')
      this.mountPoint = document.createElement('div')
      root.append(this.styleElement, this.mountPoint)
    } else {
      this.shadowRoot?.replaceChildren()
      this.replaceChildren()
      this.styleElement = document.createElement('style')
      this.mountPoint = document.createElement('div')
      this.append(this.styleElement, this.mountPoint)
    }

    this.shadowMode = shadowDOM
  }

  private async sync() {
    const props = this.sandboxPropsValue
    if (!props) return

    const version = ++this.syncVersion
    this.ensureSurface(props.shadowDOM)
    if (!this.mountPoint || !this.styleElement) return

    this.styleElement.textContent = props.cssText ?? ''

    if (
      this.controller &&
      this.currentSignature === props.sourceSignature &&
      this.shadowMode === props.shadowDOM
    ) {
      this.controller.setCallbacks(
        props,
        this.sandboxEventsState,
        this.hostBridgeState
      )
      return
    }

    this.mountingController?.destroy()
    const nextController = new SandboxController(
      this.mountPoint,
      props,
      this.sandboxEventsState,
      this.hostBridgeState,
      (controller, error) => {
        if (this.mountingController === controller) {
          this.mountingController = null
          controller.destroy()
          if (version === this.syncVersion) this.reportSandboxError(error)
          return
        }
        if (this.controller !== controller) {
          controller.destroy()
          return
        }
        this.destroyController()
        this.reportSandboxError(error)
      }
    )
    this.mountingController = nextController

    try {
      await nextController.mount()
    } catch (error) {
      if (this.mountingController === nextController) {
        this.mountingController = null
      }
      if (version === this.syncVersion && this.dataset.ready !== 'error') {
        this.reportSandboxError(error)
      }
      if (version !== this.syncVersion) {
        nextController.destroy()
      }
      return
    }

    if (this.mountingController !== nextController) {
      nextController.destroy()
      return
    }
    this.mountingController = null

    if (version !== this.syncVersion) {
      nextController.destroy()
      return
    }

    this.destroyController()
    this.controller = nextController
    this.currentSignature = props.sourceSignature
    this.dataset.ready = 'true'
    this.dispatchEvent(new CustomEvent('sandbox-ready'))
  }
}

function ensureSandboxElement() {
  if (customElements.get(SANDBOX_TAG_NAME)) return
  customElements.define(SANDBOX_TAG_NAME, ArrowSandboxElement)
}

function setSandboxHostRecord(id: string, record: SandboxHostRecord) {
  sandboxHostRecords.set(id, record)
  sandboxHostElements.get(id)?.applyRecord(record)
}

function cloneSandboxEvents(events?: SandboxEvents) {
  if (!events?.output) return undefined
  return {
    output: events.output,
  }
}

function getHostBridgeFunctionId(fn: Function) {
  let id = hostBridgeFunctionIds.get(fn)
  if (!id) {
    id = ++nextHostBridgeFunctionId
    hostBridgeFunctionIds.set(fn, id)
  }
  return id
}

function createHostBridgeSignature(hostBridge?: HostBridge) {
  if (!hostBridge) return []

  return Object.entries(hostBridge)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([specifier, bridgeModule]) => [
      specifier,
      Object.entries(bridgeModule)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, fn]) => [name, getHostBridgeFunctionId(fn)]),
    ])
}

const TRUSTED_HOST_LAYOUT_MARKER = '/* vibecanvas-trusted-host-layout-v1 */'
const TRUSTED_HOST_LAYOUT_CSS = [
  TRUSTED_HOST_LAYOUT_MARKER,
  ':host {',
  '  display: block;',
  '  width: 100%;',
  '  height: 100%;',
  '  min-width: 0;',
  '  min-height: 0;',
  '  overflow: hidden;',
  '  box-sizing: border-box;',
  '}',
  '',
  ':host > div {',
  '  width: 100%;',
  '  height: 100%;',
  '  min-width: 0;',
  '  min-height: 0;',
  '  overflow: hidden;',
  '  box-sizing: border-box;',
  '}',
  '',
  '*, *::before, *::after {',
  '  box-sizing: border-box;',
  '}',
  '',
].join('\n')
const SANDBOX_CSS_MAX_CHARACTERS = 262_144
const SAFE_SANDBOX_CSS_AT_RULES = new Set([
  '-webkit-keyframes', 'container', 'keyframes', 'layer', 'media', 'scope',
  'starting-style', 'supports',
])

function normalizeSandboxCssSecurityText(cssText: string) {
  let normalized = ''
  let index = 0

  while (index < cssText.length) {
    const character = cssText[index]
    const nextCharacter = cssText[index + 1]
    if (character === '\\') {
      throw new Error('Unsafe sandbox CSS escape sequence.')
    }
    if (character === '/' && nextCharacter === '*') {
      const commentEnd = cssText.indexOf('*/', index + 2)
      if (commentEnd < 0) throw new Error('Unsafe sandbox CSS unterminated comment.')
      // Comments cannot split a security-sensitive token into safe pieces.
      index = commentEnd + 2
      continue
    }
    if (character === '"' || character === "'") {
      const quote = character
      normalized += ' '
      index += 1
      while (index < cssText.length && cssText[index] !== quote) {
        if (cssText[index] === '\\') {
          throw new Error('Unsafe sandbox CSS escape sequence.')
        }
        normalized += ' '
        index += 1
      }
      if (index >= cssText.length) {
        throw new Error('Unsafe sandbox CSS unterminated string.')
      }
      normalized += ' '
      index += 1
      continue
    }
    const code = character.charCodeAt(0)
    if (code < 32 && character !== '\t' && character !== '\n' && character !== '\r' && character !== '\f') {
      throw new Error('Unsafe sandbox CSS control character.')
    }
    normalized += character.toLowerCase()
    index += 1
  }

  return normalized
}

function assertSafeSandboxCss(cssText: string | undefined) {
  if (!cssText?.trim()) return
  if (cssText.length > SANDBOX_CSS_MAX_CHARACTERS) {
    throw new Error('Unsafe sandbox CSS exceeds the host size limit.')
  }

  let guestCss = cssText
  if (guestCss.startsWith(TRUSTED_HOST_LAYOUT_CSS)) {
    guestCss = guestCss.slice(TRUSTED_HOST_LAYOUT_CSS.length)
  }
  if (guestCss.includes(TRUSTED_HOST_LAYOUT_MARKER)) {
    throw new Error('Unsafe sandbox CSS trusted-layout marker.')
  }

  const normalized = normalizeSandboxCssSecurityText(guestCss)
  for (const match of normalized.matchAll(/@([a-z][a-z0-9-]*)/g)) {
    if (!SAFE_SANDBOX_CSS_AT_RULES.has(match[1])) {
      throw new Error('Unsafe sandbox CSS at-rule "@' + match[1] + '".')
    }
  }
  if (/\b(?:url|image-set|-webkit-image-set|element|paint)\s*\(/.test(normalized)) {
    throw new Error('Unsafe sandbox CSS external-resource function.')
  }
  if (/\bexpression\s*\(/.test(normalized)) {
    throw new Error('Unsafe sandbox CSS executable expression.')
  }
  if (/:host(?:-context)?\b|::(?:part|slotted)\s*\(/.test(normalized)) {
    throw new Error('Unsafe sandbox CSS host selector.')
  }
  if (/\bposition\s*:\s*fixed\b/.test(normalized)) {
    throw new Error('Unsafe sandbox CSS fixed positioning.')
  }
  if (/(?:^|[;{])\s*(?:behavior|-moz-binding)\s*:/.test(normalized)) {
    throw new Error('Unsafe sandbox CSS executable property.')
  }
}

function resolveSandboxProps(
  props: SandboxHostProps,
  hostBridge?: HostBridge
): ResolvedSandboxProps {
  const sourceEntries = Object.entries(props.source || {})
    .map(([name, value]) => [normalizeVirtualPath(name), String(value)] as const)
    .sort(([left], [right]) => left.localeCompare(right))
  const source = Object.fromEntries(sourceEntries)

  const cssText = source['/main.css']
  assertSafeSandboxCss(cssText)

  return {
    cssText,
    debug: props.debug,
    onError: props.onError,
    shadowDOM: props.shadowDOM !== false,
    source,
    sourceSignature: JSON.stringify([
      props.debug ?? false,
      props.shadowDOM !== false,
      sourceEntries,
      createHostBridgeSignature(hostBridge),
    ]),
  }
}

const SandboxHostComponent = component<SandboxTemplateProps>(
  (props: Props<SandboxTemplateProps>) => {
    const hostId = `arrow-sandbox:${++nextSandboxHostId}`
    const syncRecord = () => {
      setSandboxHostRecord(hostId, {
        events: cloneSandboxEvents(props.events),
        hostBridge: props.hostBridge,
        props: resolveSandboxProps(props.config, props.hostBridge),
      })
      return hostId
    }

    syncRecord()
    watch(syncRecord, (value) => value)

    return html`<arrow-sandbox data-sandbox-id="${hostId}"></arrow-sandbox>`
  }
)

export function sandbox<T extends {
  source: object
  shadowDOM?: boolean
  onError?: (error: Error | string) => void
  debug?: boolean
}>(
  props: T,
  events?: SandboxEvents,
  hostBridge?: HostBridge
): ArrowTemplate {
  ensureSandboxElement()
  return html`${SandboxHostComponent({
    config: props as SandboxHostProps,
    events,
    hostBridge,
  })}`
}
