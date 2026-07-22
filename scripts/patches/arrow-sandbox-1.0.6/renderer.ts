import type {
  SandboxedEventPayload,
  SandboxedEventTargetSnapshot,
  SerializedNode,
  VmPatch,
} from '../shared/protocol'

const svgNamespaceUri = 'http://www.w3.org/2000/svg'

const SAFE_HTML_TAGS = new Set([
  'article', 'aside', 'b', 'blockquote', 'br', 'button', 'caption', 'code',
  'col', 'colgroup', 'datalist', 'dd', 'details', 'div', 'dl', 'dt', 'em',
  'fieldset', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'i', 'input', 'kbd', 'label', 'legend', 'li', 'main',
  'mark', 'meter', 'nav', 'ol', 'optgroup', 'option', 'output', 'p', 'pre',
  'progress', 's', 'samp', 'section', 'select', 'small', 'span', 'strong',
  'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'textarea', 'tfoot',
  'th', 'thead', 'time', 'tr', 'u', 'ul', 'var',
])
const SAFE_DELEGATED_EVENTS = new Set([
  'blur', 'change', 'click', 'dblclick', 'focus', 'input', 'keydown', 'keyup',
  'pointercancel', 'pointerdown', 'pointermove', 'pointerup', 'reset', 'submit',
  'wheel',
])
const URL_BEARING_ATTRIBUTES = new Set([
  'action', 'background', 'cite', 'data', 'formaction', 'href', 'manifest',
  'ping', 'poster', 'profile', 'src', 'srcdoc', 'srcset', 'usemap',
  'xlink:href', 'xmlns',
])
const SAFE_GLOBAL_ATTRIBUTES = new Set([
  'class', 'dir', 'hidden', 'id', 'lang', 'role', 'tabindex', 'title',
])
const SAFE_TAG_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  button: new Set(['disabled', 'name', 'type', 'value']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  fieldset: new Set(['disabled', 'name']),
  form: new Set(['autocomplete', 'name', 'novalidate']),
  input: new Set([
    'autocomplete', 'checked', 'disabled', 'max', 'maxlength', 'min',
    'minlength', 'multiple', 'name', 'placeholder', 'readonly', 'required',
    'size', 'step', 'type', 'value',
  ]),
  label: new Set(['for']),
  li: new Set(['value']),
  meter: new Set(['high', 'low', 'max', 'min', 'optimum', 'value']),
  ol: new Set(['reversed', 'start', 'type']),
  optgroup: new Set(['disabled', 'label']),
  option: new Set(['disabled', 'label', 'selected', 'value']),
  output: new Set(['for', 'name']),
  progress: new Set(['max', 'value']),
  select: new Set(['disabled', 'multiple', 'name', 'required', 'size']),
  td: new Set(['colspan', 'rowspan']),
  textarea: new Set([
    'cols', 'disabled', 'maxlength', 'minlength', 'name', 'placeholder',
    'readonly', 'required', 'rows', 'value', 'wrap',
  ]),
  th: new Set(['colspan', 'rowspan', 'scope']),
}
const SAFE_BUTTON_TYPES = new Set(['button', 'reset', 'submit'])
const SAFE_INPUT_TYPES = new Set([
  'button', 'checkbox', 'color', 'date', 'datetime-local', 'email', 'hidden',
  'month', 'number', 'password', 'radio', 'range', 'reset', 'search', 'submit',
  'tel', 'text', 'time', 'url', 'week',
])
const SANDBOX_MAX_LIVE_RENDER_NODES = 4_096
const SANDBOX_MAX_LIVE_RENDER_DEPTH = 32
const SANDBOX_MAX_LIVE_TEXT_CHARACTERS = 262_144
const SANDBOX_MAX_LIVE_ATTRIBUTES = 4_096
const SANDBOX_MAX_LIVE_ATTRIBUTES_PER_ELEMENT = 64
const SANDBOX_MAX_LIVE_ATTRIBUTE_CHARACTERS = 262_144
const SANDBOX_MAX_LIVE_EVENTS = 1_024
const SANDBOX_MAX_LIVE_EVENTS_PER_ELEMENT = 16

function assertSafeSandboxTag(tag: string, namespace: string | undefined) {
  if (namespace || !SAFE_HTML_TAGS.has(tag)) {
    throw new Error('Unsafe sandbox element tag "' + tag + '".')
  }
}

function assertSafeSandboxAttribute(element: Element, rawName: string, value: string | boolean) {
  const name = rawName.toLowerCase()
  if (
    name.startsWith('on')
    || name === 'style'
    || URL_BEARING_ATTRIBUTES.has(name)
  ) {
    throw new Error('Unsafe sandbox attribute "' + rawName + '".')
  }
  if (
    SAFE_GLOBAL_ATTRIBUTES.has(name)
    || /^aria-[a-z][a-z0-9-]*$/.test(name)
    || /^data-[a-z][a-z0-9-]*$/.test(name)
    || SAFE_TAG_ATTRIBUTES[element.localName]?.has(name)
  ) {
    if (name === 'dir' && !['ltr', 'rtl', 'auto'].includes(String(value))) {
      throw new Error('Unsafe sandbox attribute value for "dir".')
    }
    if (name === 'tabindex' && !['-1', '0'].includes(String(value))) {
      throw new Error('Unsafe sandbox attribute value for "tabindex".')
    }
    if (
      element.localName === 'button'
      && name === 'type'
      && !SAFE_BUTTON_TYPES.has(String(value))
    ) {
      throw new Error('Unsafe sandbox attribute value for "type".')
    }
    if (element.localName === 'input' && name === 'type' && !SAFE_INPUT_TYPES.has(String(value))) {
      throw new Error('Unsafe sandbox input type.')
    }
    return
  }
  throw new Error('Unsupported sandbox attribute "' + rawName + '".')
}

function assertSafeSandboxEvent(eventType: string) {
  if (!SAFE_DELEGATED_EVENTS.has(eventType)) {
    throw new Error('Unsupported sandbox delegated event "' + eventType + '".')
  }
}

function preventSandboxFormNavigation(event: Event) {
  event.preventDefault()
}

interface RegionAnchor {
  start: Comment
  end: Comment
}

interface RendererOptions {
  mountPoint: Element
  onEvent: (handlerId: string, payload: SandboxedEventPayload) => Promise<void>
  onError: (error: Error | string) => void
}

export class HostRenderer {
  private readonly mountPoint: Element
  private readonly onEvent: RendererOptions['onEvent']
  private readonly onError: RendererOptions['onError']
  private readonly nodes = new Map<string, Node>()
  private readonly regions = new Map<string, RegionAnchor>()
  private readonly regionDepths = new Map<string, number>()
  private readonly elementEvents = new Map<string, Map<string, string>>()
  private readonly liveNodeIds = new Set<string>()
  private readonly nodeIds = new WeakMap<Node, string>()
  private readonly regionStarts = new WeakMap<Node, string>()
  private readonly delegatedListeners = new Map<string, EventListener>()
  private liveAttributeCharacters = 0
  private liveAttributes = 0
  private liveEvents = 0
  private liveNodeCount = 0
  private liveTextCharacters = 0

  constructor(options: RendererOptions) {
    this.mountPoint = options.mountPoint
    this.onEvent = options.onEvent
    this.onError = options.onError
  }

  render(tree: SerializedNode) {
    try {
      this.clear()
      this.mountPoint.replaceChildren()
      const node = this.instantiate(tree, 1)
      this.mountPoint.replaceChildren(node)
    } catch (error) {
      this.fail(error)
    }
  }

  applyPatches(patches: VmPatch[]) {
    try {
      for (const patch of patches) {
        this.applyPatch(patch)
      }
    } catch (error) {
      this.fail(error)
    }
  }

  destroy() {
    this.clear()
    this.mountPoint.replaceChildren()
  }

  private clear() {
    for (const [eventType, listener] of this.delegatedListeners) {
      this.mountPoint.removeEventListener(eventType, listener)
    }

    this.delegatedListeners.clear()
    this.nodes.clear()
    this.regions.clear()
    this.regionDepths.clear()
    this.elementEvents.clear()
    this.liveNodeIds.clear()
    this.liveAttributeCharacters = 0
    this.liveAttributes = 0
    this.liveEvents = 0
    this.liveNodeCount = 0
    this.liveTextCharacters = 0
  }

  private fail(error: unknown) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    this.destroy()
    this.onError(normalized)
  }

  private instantiate(serialized: SerializedNode, depth: number): Node {
    switch (serialized.kind) {
      case 'fragment': {
        const fragment = document.createDocumentFragment()
        for (const child of serialized.children) {
          fragment.append(this.instantiate(child, depth))
        }
        return fragment
      }
      case 'element': {
        assertSafeSandboxTag(serialized.tag, serialized.namespace)
        this.reserveLiveNode(serialized.id, depth)
        const element =
          serialized.namespace === 'svg'
            ? document.createElementNS(svgNamespaceUri, serialized.tag)
            : document.createElement(serialized.tag)
        if (serialized.tag === 'form') {
          element.addEventListener('submit', preventSandboxFormNavigation)
        }
        this.nodes.set(serialized.id, element)
        this.nodeIds.set(element, serialized.id)

        for (const [name, value] of Object.entries(serialized.attrs)) {
          this.writeAttribute(element, name, value)
        }

        for (const [eventType, handlerId] of Object.entries(serialized.events)) {
          this.setEventBinding(serialized.id, eventType, handlerId)
        }

        for (const child of serialized.children) {
          element.append(this.instantiate(child, depth + 1))
        }

        return element
      }
      case 'text': {
        this.reserveLiveNode(serialized.id, depth)
        this.reserveLiveText(serialized.text.length)
        const text = document.createTextNode(serialized.text)
        this.nodes.set(serialized.id, text)
        this.nodeIds.set(text, serialized.id)
        return text
      }
      case 'region': {
        this.reserveLiveNode(serialized.id, depth, 2)
        const fragment = document.createDocumentFragment()
        const start = document.createComment('')
        const end = document.createComment('')
        this.regions.set(serialized.id, { start, end })
        this.regionDepths.set(serialized.id, depth)
        this.regionStarts.set(start, serialized.id)
        fragment.append(start)
        for (const child of serialized.children) {
          fragment.append(this.instantiate(child, depth + 1))
        }
        fragment.append(end)
        return fragment
      }
    }
  }

  private applyPatch(patch: VmPatch) {
    switch (patch.type) {
      case 'set-text': {
        this.setText(patch.nodeId, patch.text)
        return
      }
      case 'set-attribute': {
        const node = this.nodes.get(patch.nodeId)
        if (node instanceof Element) {
          this.writeAttribute(node, patch.name, patch.value)
        }
        return
      }
      case 'remove-attribute': {
        const node = this.nodes.get(patch.nodeId)
        if (node instanceof Element) {
          this.removeAttribute(node, patch.name)
        }
        return
      }
      case 'set-event-binding':
        this.setEventBinding(patch.nodeId, patch.eventType, patch.handlerId)
        return
      case 'clear-event-binding':
        this.clearEventBinding(patch.nodeId, patch.eventType)
        return
      case 'replace-region':
        this.replaceRegion(patch.regionId, patch.children)
        return
    }
  }

  private replaceRegion(regionId: string, children: SerializedNode[]) {
    const region = this.regions.get(regionId)
    const regionDepth = this.regionDepths.get(regionId)
    if (!region || regionDepth === undefined) return

    let node = region.start.nextSibling
    while (node && node !== region.end) {
      const next = node.nextSibling
      this.teardownNode(node)
      node.remove()
      node = next
    }

    const parent = region.end.parentNode
    if (!parent) return

    for (const child of children) {
      parent.insertBefore(this.instantiate(child, regionDepth + 1), region.end)
    }
  }

  private teardownNode(node: Node) {
    const nodeId = this.nodeIds.get(node)
    if (nodeId) {
      const bindings = this.elementEvents.get(nodeId)
      if (node instanceof Text) {
        this.liveTextCharacters -= node.data.length
      } else if (node instanceof Element) {
        for (const attribute of Array.from(node.attributes)) {
          this.liveAttributes -= 1
          this.liveAttributeCharacters -= attribute.name.length + attribute.value.length
        }
        this.liveEvents -= bindings?.size ?? 0
      }
      this.nodes.delete(nodeId)
      this.elementEvents.delete(nodeId)
      this.liveNodeIds.delete(nodeId)
      this.liveNodeCount -= 1
    }

    const regionId = this.regionStarts.get(node)
    if (regionId) {
      this.regions.delete(regionId)
      this.regionDepths.delete(regionId)
      this.liveNodeIds.delete(regionId)
      this.liveNodeCount -= 2
    }

    if (node instanceof Element) {
      for (const child of Array.from(node.childNodes)) {
        this.teardownNode(child)
      }
    }
  }

  private reserveLiveNode(nodeId: string, depth: number, domNodeCount = 1) {
    if (this.liveNodeIds.has(nodeId)) {
      throw new Error('Sandbox render contains a duplicate live node id.')
    }
    if (depth > SANDBOX_MAX_LIVE_RENDER_DEPTH) {
      throw new Error(
        `Sandbox render exceeded the host cap of ${SANDBOX_MAX_LIVE_RENDER_DEPTH} live levels.`
      )
    }
    if (this.liveNodeCount + domNodeCount > SANDBOX_MAX_LIVE_RENDER_NODES) {
      throw new Error(
        `Sandbox render exceeded the host cap of ${SANDBOX_MAX_LIVE_RENDER_NODES} live nodes.`
      )
    }
    this.liveNodeIds.add(nodeId)
    this.liveNodeCount += domNodeCount
  }

  private reserveLiveText(characterCount: number) {
    if (this.liveTextCharacters + characterCount > SANDBOX_MAX_LIVE_TEXT_CHARACTERS) {
      throw new Error(
        `Sandbox render exceeded the host cap of ${SANDBOX_MAX_LIVE_TEXT_CHARACTERS} live text characters.`
      )
    }
    this.liveTextCharacters += characterCount
  }

  private setText(nodeId: string, text: string) {
    const node = this.nodes.get(nodeId)
    if (!(node instanceof Text)) {
      throw new Error('Sandbox text patch references an unknown text node.')
    }
    const nextTextCharacters = this.liveTextCharacters - node.data.length + text.length
    if (nextTextCharacters > SANDBOX_MAX_LIVE_TEXT_CHARACTERS) {
      throw new Error(
        `Sandbox render exceeded the host cap of ${SANDBOX_MAX_LIVE_TEXT_CHARACTERS} live text characters.`
      )
    }
    node.data = text
    this.liveTextCharacters = nextTextCharacters
  }

  private writeAttribute(
    element: Element,
    name: string,
    value: string | boolean
  ) {
    assertSafeSandboxAttribute(element, name, value)
    const normalizedName = name.toLowerCase()
    const previousValue = element.getAttribute(normalizedName)
    const nextValue = value === true ? '' : String(value)
    const nextAttributes = this.liveAttributes + (previousValue === null ? 1 : 0)
    const nextElementAttributes = element.attributes.length + (previousValue === null ? 1 : 0)
    const nextAttributeCharacters = this.liveAttributeCharacters
      - (previousValue === null ? 0 : normalizedName.length + previousValue.length)
      + normalizedName.length
      + nextValue.length
    if (nextAttributes > SANDBOX_MAX_LIVE_ATTRIBUTES) {
      throw new Error(
        `Sandbox render exceeded the host cap of ${SANDBOX_MAX_LIVE_ATTRIBUTES} live attributes.`
      )
    }
    if (nextElementAttributes > SANDBOX_MAX_LIVE_ATTRIBUTES_PER_ELEMENT) {
      throw new Error(
        `Sandbox render exceeded the host cap of ${SANDBOX_MAX_LIVE_ATTRIBUTES_PER_ELEMENT} live attributes per element.`
      )
    }
    if (nextAttributeCharacters > SANDBOX_MAX_LIVE_ATTRIBUTE_CHARACTERS) {
      throw new Error(
        `Sandbox render exceeded the host cap of ${SANDBOX_MAX_LIVE_ATTRIBUTE_CHARACTERS} live attribute characters.`
      )
    }
    element.setAttribute(normalizedName, nextValue)
    this.liveAttributes = nextAttributes
    this.liveAttributeCharacters = nextAttributeCharacters
  }

  private removeAttribute(element: Element, name: string) {
    const normalizedName = name.toLowerCase()
    const previousValue = element.getAttribute(normalizedName)
    if (previousValue === null) return
    element.removeAttribute(normalizedName)
    this.liveAttributes -= 1
    this.liveAttributeCharacters -= normalizedName.length + previousValue.length
  }

  private setEventBinding(nodeId: string, eventType: string, handlerId: string) {
    assertSafeSandboxEvent(eventType)
    if (!(this.nodes.get(nodeId) instanceof Element)) {
      throw new Error('Sandbox event binding references an unknown element node.')
    }
    const bindings = this.elementEvents.get(nodeId) || new Map<string, string>()
    if (!bindings.has(eventType) && bindings.size >= SANDBOX_MAX_LIVE_EVENTS_PER_ELEMENT) {
      throw new Error(
        `Sandbox render exceeded the host cap of ${SANDBOX_MAX_LIVE_EVENTS_PER_ELEMENT} live event bindings per element.`
      )
    }
    if (!bindings.has(eventType) && this.liveEvents >= SANDBOX_MAX_LIVE_EVENTS) {
      throw new Error(
        `Sandbox render exceeded the host cap of ${SANDBOX_MAX_LIVE_EVENTS} live event bindings.`
      )
    }
    if (!bindings.has(eventType)) this.liveEvents += 1
    bindings.set(eventType, handlerId)
    this.elementEvents.set(nodeId, bindings)

    if (this.delegatedListeners.has(eventType)) return

    const listener = (event: Event) => {
      this.dispatchEvent(event).catch(this.onError)
    }

    this.delegatedListeners.set(eventType, listener)
    this.mountPoint.addEventListener(eventType, listener)
  }

  private clearEventBinding(nodeId: string, eventType: string) {
    const bindings = this.elementEvents.get(nodeId)
    if (bindings?.delete(eventType)) this.liveEvents -= 1
  }

  private findNodeId(node: Node | null): string | undefined {
    let current = node
    while (current) {
      const nodeId = this.nodeIds.get(current)
      if (nodeId) return nodeId
      current = current.parentNode
    }
    return undefined
  }

  private async dispatchEvent(event: Event) {
    const target = event.target instanceof Node ? event.target : null
    const targetId = this.findNodeId(target)
    let current: Node | null = target

    while (current) {
      if (current === this.mountPoint.parentNode) break
      const currentId = this.nodeIds.get(current)
      if (currentId) {
        const bindings = this.elementEvents.get(currentId)
        const handlerId = bindings?.get(event.type)
        if (handlerId) {
          await this.onEvent(
            handlerId,
            this.sanitizeEvent(event, current, currentId, target, targetId)
          )
        }
      }

      if (current === this.mountPoint) break
      current = current.parentNode
    }
  }

  private sanitizeEvent(
    event: Event,
    currentTargetNode: Node,
    currentTargetId: string,
    targetNode: Node | null,
    targetId?: string
  ): SandboxedEventPayload {
    const mouseEvent = event as MouseEvent
    const keyboardEvent = event as KeyboardEvent
    const modifierEvent = event as Event & {
      altKey?: boolean
      ctrlKey?: boolean
      metaKey?: boolean
      shiftKey?: boolean
    }
    const currentTargetSnapshot = this.snapshotEventNode(
      currentTargetNode,
      currentTargetId
    )
    const targetSnapshot = this.snapshotEventNode(targetNode, targetId)

    return {
      type: event.type,
      currentTargetId,
      targetId,
      currentTarget: currentTargetSnapshot,
      target: targetSnapshot,
      srcElement: targetSnapshot,
      value: targetSnapshot?.value ?? currentTargetSnapshot?.value,
      checked: targetSnapshot?.checked ?? currentTargetSnapshot?.checked,
      key: 'key' in keyboardEvent ? keyboardEvent.key : undefined,
      clientX: 'clientX' in mouseEvent ? mouseEvent.clientX : undefined,
      clientY: 'clientY' in mouseEvent ? mouseEvent.clientY : undefined,
      button: 'button' in mouseEvent ? mouseEvent.button : undefined,
      altKey: modifierEvent.altKey,
      ctrlKey: modifierEvent.ctrlKey,
      metaKey: modifierEvent.metaKey,
      shiftKey: modifierEvent.shiftKey,
    }
  }

  private snapshotEventNode(
    node: Node | null,
    _fallbackNodeId?: string
  ): SandboxedEventTargetSnapshot | undefined {
    const element = this.findElement(node)
    if (!element) return undefined

    const snapshotTarget = element as Element & {
      checked?: unknown
      value?: unknown
    }

    return {
      tagName: element.tagName.toLowerCase(),
      id: element.id || undefined,
      value:
        typeof snapshotTarget.value === 'string'
          ? snapshotTarget.value
          : undefined,
      checked:
        typeof snapshotTarget.checked === 'boolean'
          ? snapshotTarget.checked
          : undefined,
    }
  }

  private findElement(node: Node | null): Element | null {
    let current = node

    while (current) {
      if (current instanceof Element) return current
      current = current.parentNode
    }

    return null
  }
}
