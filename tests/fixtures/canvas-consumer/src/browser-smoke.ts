import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TCanvasSnapshot } from '@omnidraw/canvas-contract'
import type { TReproductionTraceStatus } from '@omnidraw/canvas'
import { chromium, type Page } from 'playwright'
import { preview } from 'vite'

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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function status(page: Page): Promise<TSmokeStatus> {
  return await page.evaluate(() => window.canvasKernelSmoke.status())
}

async function snapshot(page: Page): Promise<TCanvasSnapshot> {
  return await page.evaluate(() => window.canvasKernelSmoke.snapshot())
}

async function runComposition(
  baseUrl: string,
  adapter: TAdapterKind,
  contribution: 'host' | 'none',
): Promise<void> {
  const page = await browser.newPage()
  const browserFailures: string[] = []
  const successfulAssets = new Set<string>()
  page.on('console', (message) => {
    if (message.type() === 'error') browserFailures.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => browserFailures.push(`page: ${error.message}`))
  page.on('requestfailed', (request) => {
    browserFailures.push(`request: ${request.url()} (${request.failure()?.errorText ?? 'failed'})`)
  })
  page.on('response', (response) => {
    if (response.ok()) successfulAssets.add(response.url())
  })

  try {
    await page.goto(
      `${baseUrl}?adapter=${adapter}&contribution=${contribution}`,
      { waitUntil: 'networkidle' },
    )
    await page.locator('.omnidraw-canvas-host').waitFor({ state: 'visible' })
    try {
      await page.waitForFunction(
        () => window.canvasKernelSmoke.status().activeSubscriptions === 1,
        undefined,
        { timeout: 10_000 },
      )
    } catch (error) {
      throw new Error([
        `${adapter} Canvas did not establish its document subscription.`,
        ...browserFailures,
        JSON.stringify(await status(page)),
      ].join('\n'), { cause: error })
    }

    const initial = await status(page)
    assert(initial.adapter === adapter, `${adapter} composition selected the wrong adapter.`)
    assert(initial.revision === 1, `${adapter} did not load the initial snapshot.`)
    assert(initial.executedCommands === 0, `${adapter} executed a command before the smoke interaction.`)
    const traceButton = page.getByRole('button', { name: /^Developer trace:/ })
    if (adapter === 'cell' && contribution === 'host') {
      assert(initial.diagnosticsEnabled, 'Fake-Cell host composition did not inject diagnostics.')
      assert(initial.diagnosticsStatus === 'idle', 'Injected diagnostics did not start idle.')
      assert(await traceButton.count() === 1, 'Canvas did not render the injected diagnostics control.')
      await traceButton.click()
      await page.getByRole('button', { name: 'Record', exact: true }).click()
      await page.waitForFunction(() => {
        const current = window.canvasKernelSmoke.status()
        return current.diagnosticsStatus === 'recording'
      })
    } else {
      assert(!initial.diagnosticsEnabled, 'Memory/no-extension composition unexpectedly enabled diagnostics.')
      assert(initial.diagnosticsStatus === 'disabled', 'Memory diagnostics status was not disabled.')
      assert(await traceButton.count() === 0, 'Memory/no-extension composition rendered diagnostics UI.')
    }
    const shellBackground = await page.locator('.consumer-shell').evaluate((element) => (
      getComputedStyle(element).backgroundColor
    ))
    assert(shellBackground === 'rgb(1, 2, 3)', 'Canvas CSS escaped and restyled the external shell.')

    await page.evaluate(() => document.fonts.load('16px Inter'))
    const engineHost = page.locator('.omnidraw-canvas-engine-host')
    const hostBox = await engineHost.boundingBox()
    assert(hostBox !== null, `${adapter} canvas engine host has no browser bounds.`)
    const beforeRender = await engineHost.screenshot()
    const start = {
      x: hostBox.x + hostBox.width * 0.6,
      y: hostBox.y + hostBox.height * 0.55,
    }
    const end = { x: start.x + 140, y: start.y + 90 }

    await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 6 })
    await page.mouse.up()
    await page.waitForFunction(() => window.canvasKernelSmoke.status().executedCommands >= 1)
    const createdSnapshot = await snapshot(page)
    const created = createdSnapshot.items.find((item) => item.id !== 'initial-shape')
    assert(created?.item.kind === 'rect', `${adapter} Canvas/editor did not create a rectangle.`)
    const afterCreateRender = await engineHost.screenshot()
    assert(!beforeRender.equals(afterCreateRender), `${adapter} rendered scene did not change after creation.`)
    const createdPosition = structuredClone(created.item.transform.position)

    await page.getByRole('button', { name: 'Select', exact: true }).click()
    const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
    await page.mouse.click(center.x, center.y)
    await page.locator('.omnidraw-selection-style-menu').waitFor({ state: 'visible' })
    await page.mouse.move(center.x, center.y)
    await page.mouse.down()
    await page.mouse.move(center.x + 72, center.y + 36, { steps: 6 })
    await page.mouse.up()
    await page.waitForFunction(() => window.canvasKernelSmoke.status().executedCommands >= 2)
    const editedSnapshot = await snapshot(page)
    const edited = editedSnapshot.items.find((item) => item.id === created.id)
    assert(edited !== undefined, `${adapter} Canvas/editor lost its created rectangle.`)
    assert(
      edited.item.transform.position.x !== createdPosition.x
      || edited.item.transform.position.y !== createdPosition.y,
      `${adapter} Canvas/editor did not edit the selected rectangle.`,
    )
    await page.waitForFunction(() => {
      const current = window.canvasKernelSmoke.status()
      return current.revision === 3 && current.observedEvents >= 2
    })

    const secondStart = {
      x: hostBox.x + hostBox.width * 0.25,
      y: hostBox.y + hostBox.height * 0.32,
    }
    const secondEnd = { x: secondStart.x + 120, y: secondStart.y + 80 }
    const secondCenter = {
      x: (secondStart.x + secondEnd.x) / 2,
      y: (secondStart.y + secondEnd.y) / 2,
    }
    const movedFirstCenter = { x: center.x + 72, y: center.y + 36 }
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click()
    await page.mouse.move(secondStart.x, secondStart.y)
    await page.mouse.down()
    await page.mouse.move(secondEnd.x, secondEnd.y, { steps: 6 })
    await page.mouse.up()
    await page.waitForFunction(() => window.canvasKernelSmoke.status().executedCommands >= 3)
    const twoTargetSnapshot = await snapshot(page)
    const second = twoTargetSnapshot.items.find((item) => (
      item.id !== 'initial-shape' && item.id !== created.id
    ))
    assert(second?.item.kind === 'rect', `${adapter} Canvas/editor did not create the second Arrow target.`)

    await page.getByRole('button', { name: 'Arrow', exact: true }).click()
    await page.mouse.move(secondCenter.x, secondCenter.y)
    await page.mouse.down()
    await page.mouse.move(movedFirstCenter.x, movedFirstCenter.y, { steps: 8 })
    await page.mouse.up()
    await page.waitForFunction(() => window.canvasKernelSmoke.status().executedCommands >= 4)
    const arrowSnapshot = await snapshot(page)
    const arrow = arrowSnapshot.items.find((item) => item.item.kind === 'connector')
    assert(arrow?.item.kind === 'connector', `${adapter} Canvas/editor did not create an Arrow connector.`)
    assert(arrow.item.from.type === 'node', `${adapter} Arrow tail did not bind to its source target.`)
    assert(arrow.item.from.nodeId === second.id, `${adapter} Arrow tail bound to the wrong source target.`)
    assert(arrow.item.from.anchor === 'auto', `${adapter} Arrow tail did not use the auto attachment anchor.`)
    assert(arrow.item.from.attachment?.mode === 'inside', `${adapter} Arrow tail did not preserve its inside attachment.`)
    assert(arrow.item.to.type === 'node', `${adapter} Arrow head did not bind to its destination target.`)
    assert(arrow.item.to.nodeId === created.id, `${adapter} Arrow head bound to the wrong destination target.`)
    assert(arrow.item.to.anchor === 'auto', `${adapter} Arrow head did not use the auto attachment anchor.`)
    assert(arrow.item.to.attachment?.mode === 'inside', `${adapter} Arrow head did not preserve its inside attachment.`)
    assert(arrow.item.endMarker?.shape === 'arrow', `${adapter} Arrow lost its independent head marker.`)

    await page.waitForTimeout(200)
    await page.getByRole('button', { name: 'Select', exact: true }).click()
    const detachedTail = {
      x: hostBox.x + hostBox.width * 0.18,
      y: hostBox.y + hostBox.height * 0.75,
    }
    await page.keyboard.down('Control')
    await page.mouse.move(secondCenter.x, secondCenter.y)
    await page.mouse.down()
    await page.mouse.move(detachedTail.x, detachedTail.y, { steps: 6 })
    await page.mouse.up()
    await page.keyboard.up('Control')
    await page.waitForFunction(() => window.canvasKernelSmoke.status().executedCommands >= 5)
    const detachedSnapshot = await snapshot(page)
    const detachedArrow = detachedSnapshot.items.find((item) => item.id === arrow.id)
    assert(detachedArrow?.item.kind === 'connector', `${adapter} tail detach lost the Arrow.`)
    assert(detachedArrow.item.from.type === 'point', `${adapter} Ctrl-drag did not detach the Arrow tail.`)
    assert(detachedArrow.item.to.type === 'node', `${adapter} tail detach also changed the Arrow head.`)

    await page.waitForTimeout(200)
    await page.keyboard.down('Alt')
    await page.mouse.move(movedFirstCenter.x, movedFirstCenter.y)
    await page.mouse.down()
    await page.mouse.move(secondCenter.x, secondCenter.y, { steps: 6 })
    await page.mouse.up()
    await page.keyboard.up('Alt')
    await page.waitForFunction(() => window.canvasKernelSmoke.status().executedCommands >= 6)
    const reboundSnapshot = await snapshot(page)
    const reboundArrow = reboundSnapshot.items.find((item) => item.id === arrow.id)
    assert(reboundArrow?.item.kind === 'connector', `${adapter} head rebind lost the Arrow.`)
    assert(reboundArrow.item.from.type === 'point', `${adapter} head rebind changed the detached tail.`)
    assert(
      reboundArrow.item.to.type === 'node'
      && reboundArrow.item.to.nodeId === second.id
      && reboundArrow.item.to.attachment?.mode === 'inside',
      `${adapter} Alt-drag did not rebind the Arrow head as an inside attachment.`,
    )
    assert(reboundArrow.item.endMarker?.shape === 'arrow', `${adapter} endpoint edits changed Arrow marker styling.`)

    const secondMoveHandle = { x: secondCenter.x - 34, y: secondCenter.y - 20 }
    await page.mouse.click(secondMoveHandle.x, secondMoveHandle.y)
    await page.mouse.move(secondMoveHandle.x, secondMoveHandle.y)
    await page.mouse.down()
    await page.mouse.move(secondMoveHandle.x + 48, secondMoveHandle.y + 24, { steps: 6 })
    await page.mouse.up()
    await page.waitForFunction(() => window.canvasKernelSmoke.status().executedCommands >= 7)
    const movedTargetSnapshot = await snapshot(page)
    const movedArrow = movedTargetSnapshot.items.find((item) => item.id === arrow.id)
    const movedSecond = movedTargetSnapshot.items.find((item) => item.id === second.id)
    assert(movedSecond?.item.kind === 'rect', `${adapter} target movement lost the source target.`)
    assert(
      movedSecond.item.transform.position.x !== second.item.transform.position.x
      || movedSecond.item.transform.position.y !== second.item.transform.position.y,
      `${adapter} target movement did not change the authored target transform.`,
    )
    assert(movedArrow?.item.kind === 'connector', `${adapter} target movement lost the Arrow.`)
    assert(
      movedArrow.item.from.type === 'point'
      && movedArrow.item.to.type === 'node'
      && movedArrow.item.to.nodeId === second.id
      && movedArrow.item.to.attachment?.mode === 'inside',
      `${adapter} target movement changed the independently edited Arrow endpoints.`,
    )

    const beforeTheme = await page.locator('.omnidraw-canvas-host').getAttribute('data-omnidraw-theme-id')
    await page.evaluate(() => window.canvasKernelSmoke.switchTheme())
    await page.waitForFunction((previous) => (
      document.querySelector('.omnidraw-canvas-host')?.getAttribute('data-omnidraw-theme-id') !== previous
    ), beforeTheme)
    const themeEvidence = await page.locator('.omnidraw-canvas-host').evaluate((element) => ({
      background: getComputedStyle(element).getPropertyValue('--omnidraw-background').trim(),
      id: element.getAttribute('data-omnidraw-theme-id'),
    }))
    assert(themeEvidence.id !== beforeTheme, `${adapter} did not apply the supplied theme instance.`)
    assert(themeEvidence.background.length > 0, `${adapter} did not apply canvas theme variables.`)

    const hostAction = page.getByRole('button', { name: 'Host pulse' })
    if (contribution === 'host') {
      await hostAction.click()
      assert((await status(page)).hostActions === 1, 'Host toolbar contribution did not activate.')
    } else {
      assert(await hostAction.count() === 0, 'No-extension composition rendered a product contribution.')
    }

    const afterEdit = await status(page)
    assert(afterEdit.executedCommands === 7, `${adapter} did not execute the complete target and Arrow interaction sequence.`)
    assert(afterEdit.browserErrors.length === 0, `${adapter} reported host notification errors.`)
    if (adapter === 'cell' && contribution === 'host') {
      assert(afterEdit.diagnosticsEvents > 1, 'Injected diagnostics did not observe canvas activity.')
    } else {
      assert(afterEdit.diagnosticsEvents === 0, 'Diagnostics-free memory composition retained trace events.')
    }
    assert(
      [...successfulAssets].some((url) => /\.css(?:\?|$)/.test(url)),
      `${adapter} did not load the production CSS bundle.`,
    )
    assert(
      [...successfulAssets].some((url) => /\.(?:ttf|woff2?)(?:\?|$)/.test(url)),
      `${adapter} did not load a font from the packed canvas distribution.`,
    )

    await page.evaluate(() => window.canvasKernelSmoke.unmount())
    await page.waitForFunction(() => window.canvasKernelSmoke.status().activeSubscriptions === 0)
    const disposed = await status(page)
    assert(disposed.cancelledSubscriptions >= 1, `${adapter} leaked its event subscription.`)
    if (adapter === 'cell' && contribution === 'host') {
      assert(disposed.diagnosticsDisposals === 1, 'Host did not dispose fake-Cell diagnostics exactly once.')
      assert(disposed.diagnosticsStatus === 'stopped', 'Disposed recording diagnostics did not stop.')
    } else {
      assert(disposed.diagnosticsDisposals === 0, 'Diagnostics-free memory composition disposed an owner.')
      assert(disposed.diagnosticsStatus === 'disabled', 'Memory diagnostics became enabled during unmount.')
    }
    assert(browserFailures.length === 0, browserFailures.join('\n'))
  } finally {
    await page.close()
  }
}

const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const server = await preview({
  root: fixtureRoot,
  preview: {
    host: '127.0.0.1',
    port: 0,
    strictPort: false,
  },
})
const address = server.httpServer.address()
if (address === null || typeof address === 'string') {
  await server.close()
  throw new Error('Vite preview did not expose a TCP address.')
}
const baseUrl = `http://127.0.0.1:${address.port}/`
const browser = await chromium.launch({ headless: true })

try {
  await runComposition(baseUrl, 'memory', 'none')
  await runComposition(baseUrl, 'cell', 'host')
} finally {
  await browser.close()
  await server.close()
}

console.log('[canvas-consumer] memory/no-extension and fake-Cell/host-contribution browser smokes passed')
