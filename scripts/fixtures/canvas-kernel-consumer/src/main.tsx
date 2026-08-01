import {
  Canvas,
  createReproductionTrace,
  type TCanvasDependencies,
  type TCanvasToolbarContribution,
  type TReproductionTraceStatus,
} from '@omnidraw/canvas'
import '@omnidraw/canvas/styles.css'
import type { TCanvasItemSnapshot } from '@omnidraw/canvas-contract'
import {
  THEME_ID_DARK,
  THEME_ID_LIGHT,
  ThemeService,
} from '@omnidraw/service-theme'
import type { Component } from 'solid-js'
import { render } from 'solid-js/web'
import {
  createFakeCellCanvasTransport,
  createInMemoryCanvasTransport,
  type TCanvasTransportHarness,
} from './transports'
import './app.css'

type TCanvasNode = TCanvasItemSnapshot['item']
type TAdapterKind = 'cell' | 'memory'

type TSmokeStatus = Readonly<{
  activeSubscriptions: number
  adapter: TAdapterKind
  browserErrors: readonly string[]
  cancelledSubscriptions: number
  diagnosticsDisposals: number
  diagnosticsEnabled: boolean
  diagnosticsEvents: number
  diagnosticsStatus: TReproductionTraceStatus | 'disabled'
  executedCommands: number
  hostActions: number
  observedEvents: number
  revision: number
  themeId: string
}>

declare global {
  interface Window {
    canvasKernelSmoke: Readonly<{
      snapshot(): ReturnType<TCanvasTransportHarness['transport']['getSnapshot']>
      status(): TSmokeStatus
      switchTheme(): void
      unmount(): Promise<void>
    }>
  }
}

function rect(id: string, x: number): TCanvasNode {
  return {
    id,
    parentId: null,
    orderKey: id,
    kind: 'rect',
    transform: {
      position: { x, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      skew: { x: 0, y: 0 },
      origin: { x: 0, y: 0 },
    },
    size: { width: 120, height: 80 },
  }
}

const HostIcon: Component<Readonly<{ size?: number }>> = (props) => (
  <svg
    aria-hidden="true"
    height={props.size ?? 16}
    viewBox="0 0 16 16"
    width={props.size ?? 16}
  >
    <circle cx="8" cy="8" fill="currentColor" r="4" />
  </svg>
)

const params = new URLSearchParams(window.location.search)
const adapter: TAdapterKind = params.get('adapter') === 'cell' ? 'cell' : 'memory'
const withContribution = params.get('contribution') === 'host'
const canvasId = `external-${adapter}`
const initialItems = [rect('initial-shape', -80)]
const harness: TCanvasTransportHarness = adapter === 'cell'
  ? createFakeCellCanvasTransport({ canvasId, initialItems })
  : createInMemoryCanvasTransport({ canvasId, initialItems })
const themeService = new ThemeService({ initialThemeId: THEME_ID_LIGHT })
const browserErrors: string[] = []
let idSequence = 0
let hostActions = 0
let diagnosticsDisposals = 0
let diagnosticsMonotonicMs = 0
let unmounted = false

const diagnostics = adapter === 'cell' && withContribution
  ? createReproductionTrace({
      environment: () => Object.freeze({
        applicationVersion: 'fixture-0.0.0',
        buildMode: 'external-consumer-smoke',
        browser: 'fake-browser-port',
        cangineVersion: 'fixture',
        canvasId,
        devicePixelRatio: 1,
        platform: 'fake-platform-port',
        viewport: Object.freeze({ height: 720, width: 1280 }),
      }),
      monotonicNow: () => {
        diagnosticsMonotonicMs += 1
        return diagnosticsMonotonicMs
      },
      wallClockNow: () => new Date('2026-01-01T00:00:00.000Z'),
      defer: (callback) => callback(),
      schedule: () => () => {},
      writeClipboard: async () => {},
      download: () => {},
      createObjectUrl: () => 'blob:external-consumer-diagnostics',
      revokeObjectUrl: () => {},
    })
  : null

const toolbarContributions: readonly TCanvasToolbarContribution[] | undefined = withContribution
  ? Object.freeze([{
      kind: 'action',
      id: 'host-pulse',
      label: 'Host pulse',
      Icon: HostIcon,
      placement: 'persistent',
      onActivate: () => {
        hostActions += 1
      },
    }])
  : undefined

const dependencies: TCanvasDependencies = Object.freeze({
  transport: harness.transport,
  themeService,
  image: Object.freeze({
    async uploadImage() {
      return { url: 'data:image/png;base64,' }
    },
    async cloneImage(body: Readonly<{ url: string }>) {
      return { url: body.url }
    },
    async deleteImage() {
      return { ok: true as const }
    },
  }),
  notification: Object.freeze({
    showSuccess() {},
    showInfo() {},
    showError(title: string, description?: string) {
      browserErrors.push(`${title}${description ? `: ${description}` : ''}`)
    },
  }),
  createId: () => `external-id-${++idSequence}`,
  wait: Object.freeze({
    wait(delayMs: number) {
      let settled = false
      let settle!: () => void
      const promise = new Promise<void>((resolve) => {
        settle = resolve
      })
      const finish = () => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        settle()
      }
      const timeout = window.setTimeout(finish, delayMs)
      return Object.freeze({ promise, cancel: finish })
    },
  }),
  diagnostics,
  runtimeExtensions: Object.freeze([]),
  toolbarContributions,
})

const mount = document.querySelector<HTMLDivElement>('#root')
if (mount === null) throw new Error('Canvas consumer mount is missing.')
const dispose = render(() => (
  <main class="consumer-shell" data-adapter={adapter}>
    <span class="consumer-font-probe">Packaged font probe</span>
    <Canvas
      canvas={{ id: canvasId }}
      hostScopeKey={`external-host:${adapter}`}
      dependencies={dependencies}
    />
  </main>
), mount)

window.canvasKernelSmoke = Object.freeze({
  snapshot() {
    return harness.transport.getSnapshot({ canvasId })
  },
  switchTheme() {
    themeService.setTheme(
      themeService.getThemeId() === THEME_ID_DARK ? THEME_ID_LIGHT : THEME_ID_DARK,
    )
  },
  status(): TSmokeStatus {
    return Object.freeze({
      ...harness.stats(),
      adapter,
      browserErrors: Object.freeze([...browserErrors]),
      diagnosticsDisposals,
      diagnosticsEnabled: diagnostics !== null,
      diagnosticsEvents: diagnostics?.state().retainedEvents ?? 0,
      diagnosticsStatus: diagnostics?.state().status ?? 'disabled',
      hostActions,
      themeId: themeService.getThemeId(),
    })
  },
  async unmount() {
    if (unmounted) return
    unmounted = true
    dispose()
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    if (diagnostics !== null) {
      diagnostics.dispose()
      diagnosticsDisposals += 1
    }
  },
})
