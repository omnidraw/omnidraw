/**
 * @file Applies the pinned M7 security boundary to @arrow-js/sandbox 1.0.6.
 *
 * Remove this patch only after the upstream package provides equivalent inert
 * DOM rendering, CSS isolation, and bounded QuickJS execution.
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const PINNED_VERSION = '1.0.6';
const PINNED_QUICKJS_VERSION = '0.32.0';
const checkOnly = process.argv.includes('--check');
const pinnedSources = [
  ['src/host/instance.ts', readFileSync(
    new URL('./patches/arrow-sandbox-1.0.6/instance.ts', import.meta.url),
    'utf8',
  )],
  ['src/host/quickjs.ts', readFileSync(
    new URL('./patches/arrow-sandbox-1.0.6/quickjs.ts', import.meta.url),
    'utf8',
  )],
  ['src/host/renderer.ts', readFileSync(
    new URL('./patches/arrow-sandbox-1.0.6/renderer.ts', import.meta.url),
    'utf8',
  )],
];
const packageJsonPaths = execFileSync('find', [
  join(process.cwd(), 'node_modules/.bun'),
  '-type',
  'f',
  '-path',
  '*/node_modules/@arrow-js/sandbox/package.json',
], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);

if (packageJsonPaths.length === 0) {
  throw new Error('[patch-arrow-sandbox-security] @arrow-js/sandbox is not installed');
}

const vmMessageValidationSource = String.raw`const SANDBOX_MAX_VM_MESSAGE_BYTES = 1_000_000
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
`;

const patches = [
  {
    path: 'src/host/renderer.ts',
    oldText: `const svgNamespaceUri = 'http://www.w3.org/2000/svg'\n`,
    newText: `const svgNamespaceUri = 'http://www.w3.org/2000/svg'\n\nconst SAFE_HTML_TAGS = new Set([\n  'article', 'aside', 'b', 'blockquote', 'br', 'button', 'caption', 'code',\n  'col', 'colgroup', 'dd', 'details', 'div', 'dl', 'dt', 'em', 'footer',\n  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'input',\n  'kbd', 'label', 'li', 'main', 'mark', 'meter', 'nav', 'ol', 'option',\n  'p', 'pre', 'progress', 's', 'samp', 'section', 'select', 'small',\n  'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',\n  'textarea', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var',\n])\nconst SAFE_DELEGATED_EVENTS = new Set([\n  'blur', 'change', 'click', 'dblclick', 'focus', 'input', 'keydown', 'keyup',\n  'pointercancel', 'pointerdown', 'pointermove', 'pointerup', 'wheel',\n])\nconst URL_BEARING_ATTRIBUTES = new Set([\n  'action', 'background', 'cite', 'data', 'formaction', 'href', 'manifest',\n  'ping', 'poster', 'profile', 'src', 'srcdoc', 'srcset', 'usemap',\n  'xlink:href', 'xmlns',\n])\nconst SAFE_GLOBAL_ATTRIBUTES = new Set([\n  'class', 'dir', 'hidden', 'id', 'lang', 'role', 'tabindex', 'title',\n])\nconst SAFE_TAG_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {\n  button: new Set(['disabled', 'name', 'type', 'value']),\n  col: new Set(['span']),\n  colgroup: new Set(['span']),\n  input: new Set([\n    'autocomplete', 'checked', 'disabled', 'max', 'maxlength', 'min',\n    'minlength', 'multiple', 'name', 'placeholder', 'readonly', 'required',\n    'size', 'step', 'type', 'value',\n  ]),\n  label: new Set(['for']),\n  li: new Set(['value']),\n  meter: new Set(['high', 'low', 'max', 'min', 'optimum', 'value']),\n  ol: new Set(['reversed', 'start', 'type']),\n  option: new Set(['disabled', 'label', 'selected', 'value']),\n  progress: new Set(['max', 'value']),\n  select: new Set(['disabled', 'multiple', 'name', 'required', 'size']),\n  td: new Set(['colspan', 'rowspan']),\n  textarea: new Set([\n    'cols', 'disabled', 'maxlength', 'minlength', 'name', 'placeholder',\n    'readonly', 'required', 'rows', 'value', 'wrap',\n  ]),\n  th: new Set(['colspan', 'rowspan', 'scope']),\n}\nconst SAFE_INPUT_TYPES = new Set([\n  'button', 'checkbox', 'color', 'date', 'datetime-local', 'month', 'number',\n  'password', 'radio', 'range', 'search', 'tel', 'text', 'time', 'week',\n])\n\nfunction assertSafeSandboxTag(tag: string, namespace: string | undefined) {\n  if (namespace || !SAFE_HTML_TAGS.has(tag)) {\n    throw new Error('Unsafe sandbox element tag "' + tag + '".')\n  }\n}\n\nfunction assertSafeSandboxAttribute(element: Element, rawName: string, value: string | boolean) {\n  const name = rawName.toLowerCase()\n  if (\n    name.startsWith('on')\n    || name === 'style'\n    || URL_BEARING_ATTRIBUTES.has(name)\n  ) {\n    throw new Error('Unsafe sandbox attribute "' + rawName + '".')\n  }\n  if (\n    SAFE_GLOBAL_ATTRIBUTES.has(name)\n    || /^aria-[a-z][a-z0-9-]*$/.test(name)\n    || /^data-[a-z][a-z0-9-]*$/.test(name)\n    || SAFE_TAG_ATTRIBUTES[element.localName]?.has(name)\n  ) {\n    if (name === 'dir' && !['ltr', 'rtl', 'auto'].includes(String(value))) {\n      throw new Error('Unsafe sandbox attribute value for "dir".')\n    }\n    if (name === 'tabindex' && !['-1', '0'].includes(String(value))) {\n      throw new Error('Unsafe sandbox attribute value for "tabindex".')\n    }\n    if (element.localName === 'button' && name === 'type' && String(value) !== 'button') {\n      throw new Error('Unsafe sandbox attribute value for "type".')\n    }\n    if (element.localName === 'input' && name === 'type' && !SAFE_INPUT_TYPES.has(String(value))) {\n      throw new Error('Unsafe sandbox input type.')\n    }\n    return\n  }\n  throw new Error('Unsupported sandbox attribute "' + rawName + '".')\n}\n\nfunction assertSafeSandboxEvent(eventType: string) {\n  if (!SAFE_DELEGATED_EVENTS.has(eventType)) {\n    throw new Error('Unsupported sandbox delegated event "' + eventType + '".')\n  }\n}\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `      case 'element': {\n        const element =\n          serialized.namespace === 'svg'\n            ? document.createElementNS(svgNamespaceUri, serialized.tag)\n            : document.createElement(serialized.tag)\n`,
    newText: `      case 'element': {\n        assertSafeSandboxTag(serialized.tag, serialized.namespace)\n        const element =\n          serialized.namespace === 'svg'\n            ? document.createElementNS(svgNamespaceUri, serialized.tag)\n            : document.createElement(serialized.tag)\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `  private writeAttribute(\n    element: Element,\n    name: string,\n    value: string | boolean\n  ) {\n    if (value === true) {\n`,
    newText: `  private writeAttribute(\n    element: Element,\n    name: string,\n    value: string | boolean\n  ) {\n    assertSafeSandboxAttribute(element, name, value)\n    if (value === true) {\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `  private setEventBinding(nodeId: string, eventType: string, handlerId: string) {\n    const bindings = this.elementEvents.get(nodeId) || new Map<string, string>()\n`,
    newText: `  private setEventBinding(nodeId: string, eventType: string, handlerId: string) {\n    assertSafeSandboxEvent(eventType)\n    const bindings = this.elementEvents.get(nodeId) || new Map<string, string>()\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `  'col', 'colgroup', 'dd', 'details', 'div', 'dl', 'dt', 'em', 'footer',\n  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'input',\n  'kbd', 'label', 'li', 'main', 'mark', 'meter', 'nav', 'ol', 'option',\n  'p', 'pre', 'progress', 's', 'samp', 'section', 'select', 'small',\n  'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',\n  'textarea', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var',\n`,
    newText: `  'col', 'colgroup', 'datalist', 'dd', 'details', 'div', 'dl', 'dt', 'em',\n  'fieldset', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',\n  'header', 'hr', 'i', 'input', 'kbd', 'label', 'legend', 'li', 'main',\n  'mark', 'meter', 'nav', 'ol', 'optgroup', 'option', 'output', 'p', 'pre',\n  'progress', 's', 'samp', 'section', 'select', 'small', 'span', 'strong',\n  'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'textarea', 'tfoot',\n  'th', 'thead', 'time', 'tr', 'u', 'ul', 'var',\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `  'blur', 'change', 'click', 'dblclick', 'focus', 'input', 'keydown', 'keyup',\n  'pointercancel', 'pointerdown', 'pointermove', 'pointerup', 'wheel',\n`,
    newText: `  'blur', 'change', 'click', 'dblclick', 'focus', 'input', 'keydown', 'keyup',\n  'pointercancel', 'pointerdown', 'pointermove', 'pointerup', 'reset', 'submit',\n  'wheel',\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `  colgroup: new Set(['span']),\n  input: new Set([\n`,
    newText: `  colgroup: new Set(['span']),\n  fieldset: new Set(['disabled', 'name']),\n  form: new Set(['autocomplete', 'name', 'novalidate']),\n  input: new Set([\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `  ol: new Set(['reversed', 'start', 'type']),\n  option: new Set(['disabled', 'label', 'selected', 'value']),\n  progress: new Set(['max', 'value']),\n`,
    newText: `  ol: new Set(['reversed', 'start', 'type']),\n  optgroup: new Set(['disabled', 'label']),\n  option: new Set(['disabled', 'label', 'selected', 'value']),\n  output: new Set(['for', 'name']),\n  progress: new Set(['max', 'value']),\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `const SAFE_INPUT_TYPES = new Set([\n  'button', 'checkbox', 'color', 'date', 'datetime-local', 'month', 'number',\n  'password', 'radio', 'range', 'search', 'tel', 'text', 'time', 'week',\n])\n`,
    newText: `const SAFE_BUTTON_TYPES = new Set(['button', 'reset', 'submit'])\nconst SAFE_INPUT_TYPES = new Set([\n  'button', 'checkbox', 'color', 'date', 'datetime-local', 'email', 'hidden',\n  'month', 'number', 'password', 'radio', 'range', 'reset', 'search', 'submit',\n  'tel', 'text', 'time', 'url', 'week',\n])\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `    if (element.localName === 'button' && name === 'type' && String(value) !== 'button') {\n      throw new Error('Unsafe sandbox attribute value for "type".')\n    }\n`,
    newText: `    if (\n      element.localName === 'button'\n      && name === 'type'\n      && !SAFE_BUTTON_TYPES.has(String(value))\n    ) {\n      throw new Error('Unsafe sandbox attribute value for "type".')\n    }\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `function assertSafeSandboxEvent(eventType: string) {\n  if (!SAFE_DELEGATED_EVENTS.has(eventType)) {\n    throw new Error('Unsupported sandbox delegated event "' + eventType + '".')\n  }\n}\n`,
    newText: `function assertSafeSandboxEvent(eventType: string) {\n  if (!SAFE_DELEGATED_EVENTS.has(eventType)) {\n    throw new Error('Unsupported sandbox delegated event "' + eventType + '".')\n  }\n}\n\nfunction preventSandboxFormNavigation(event: Event) {\n  event.preventDefault()\n}\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `            : document.createElement(serialized.tag)\n        this.nodes.set(serialized.id, element)\n`,
    newText: `            : document.createElement(serialized.tag)\n        if (serialized.tag === 'form') {\n          element.addEventListener('submit', preventSandboxFormNavigation)\n        }\n        this.nodes.set(serialized.id, element)\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `    } catch (error) {\n      this.handleError(error)\n      throw error\n    }\n  }\n\n  destroy() {\n`,
    newText: `    } catch (error) {\n      this.handleError(error)\n      this.destroy()\n      throw error\n    }\n  }\n\n  destroy() {\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `  return {\n    cssText: source['/main.css'],\n    debug: props.debug,\n`,
    newText: `  const cssText = source['/main.css']\n  if (cssText?.trim() && !cssText.startsWith('/* vibecanvas-trusted-host-layout-v1 */' + String.fromCharCode(10))) {\n    throw new Error('Sandbox guest CSS is disabled by the M7 host policy.')\n  }\n\n  return {\n    cssText,\n    debug: props.debug,\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `function resolveSandboxProps(\n  props: SandboxHostProps,\n  hostBridge?: HostBridge\n): ResolvedSandboxProps {\n`,
    newText: `const TRUSTED_HOST_LAYOUT_MARKER = '/* vibecanvas-trusted-host-layout-v1 */'\nconst TRUSTED_HOST_LAYOUT_CSS = [\n  TRUSTED_HOST_LAYOUT_MARKER,\n  ':host {',\n  '  display: block;',\n  '  width: 100%;',\n  '  height: 100%;',\n  '  min-width: 0;',\n  '  min-height: 0;',\n  '  overflow: hidden;',\n  '  box-sizing: border-box;',\n  '}',\n  '',\n  ':host > div {',\n  '  width: 100%;',\n  '  height: 100%;',\n  '  min-width: 0;',\n  '  min-height: 0;',\n  '  overflow: hidden;',\n  '  box-sizing: border-box;',\n  '}',\n  '',\n  '*, *::before, *::after {',\n  '  box-sizing: border-box;',\n  '}',\n  '',\n].join('\\n')\nconst SANDBOX_CSS_MAX_CHARACTERS = 262_144\nconst SAFE_SANDBOX_CSS_AT_RULES = new Set([\n  '-webkit-keyframes', 'container', 'keyframes', 'layer', 'media', 'scope',\n  'starting-style', 'supports',\n])\n\nfunction normalizeSandboxCssSecurityText(cssText: string) {\n  let normalized = ''\n  let index = 0\n\n  while (index < cssText.length) {\n    const character = cssText[index]\n    const nextCharacter = cssText[index + 1]\n    if (character === '\\\\') {\n      throw new Error('Unsafe sandbox CSS escape sequence.')\n    }\n    if (character === '/' && nextCharacter === '*') {\n      const commentEnd = cssText.indexOf('*/', index + 2)\n      if (commentEnd < 0) throw new Error('Unsafe sandbox CSS unterminated comment.')\n      normalized += ' '\n      index = commentEnd + 2\n      continue\n    }\n    if (character === '\"' || character === \"'\") {\n      const quote = character\n      normalized += ' '\n      index += 1\n      while (index < cssText.length && cssText[index] !== quote) {\n        if (cssText[index] === '\\\\') {\n          throw new Error('Unsafe sandbox CSS escape sequence.')\n        }\n        normalized += ' '\n        index += 1\n      }\n      if (index >= cssText.length) {\n        throw new Error('Unsafe sandbox CSS unterminated string.')\n      }\n      normalized += ' '\n      index += 1\n      continue\n    }\n    const code = character.charCodeAt(0)\n    if (code < 32 && character !== '\\t' && character !== '\\n' && character !== '\\r' && character !== '\\f') {\n      throw new Error('Unsafe sandbox CSS control character.')\n    }\n    normalized += character.toLowerCase()\n    index += 1\n  }\n\n  return normalized\n}\n\nfunction assertSafeSandboxCss(cssText: string | undefined) {\n  if (!cssText?.trim()) return\n  if (cssText.length > SANDBOX_CSS_MAX_CHARACTERS) {\n    throw new Error('Unsafe sandbox CSS exceeds the host size limit.')\n  }\n\n  let guestCss = cssText\n  if (guestCss.startsWith(TRUSTED_HOST_LAYOUT_CSS)) {\n    guestCss = guestCss.slice(TRUSTED_HOST_LAYOUT_CSS.length)\n  }\n  if (guestCss.includes(TRUSTED_HOST_LAYOUT_MARKER)) {\n    throw new Error('Unsafe sandbox CSS trusted-layout marker.')\n  }\n\n  const normalized = normalizeSandboxCssSecurityText(guestCss)\n  for (const match of normalized.matchAll(/@([a-z][a-z0-9-]*)/g)) {\n    if (!SAFE_SANDBOX_CSS_AT_RULES.has(match[1])) {\n      throw new Error('Unsafe sandbox CSS at-rule "@' + match[1] + '".')\n    }\n  }\n  if (/\\b(?:url|image-set|-webkit-image-set|element|paint)\\s*\\(/.test(normalized)) {\n    throw new Error('Unsafe sandbox CSS external-resource function.')\n  }\n  if (/\\bexpression\\s*\\(/.test(normalized)) {\n    throw new Error('Unsafe sandbox CSS executable expression.')\n  }\n  if (/:host(?:-context)?\\b|::(?:part|slotted)\\s*\\(/.test(normalized)) {\n    throw new Error('Unsafe sandbox CSS host selector.')\n  }\n  if (/\\bposition\\s*:\\s*fixed\\b/.test(normalized)) {\n    throw new Error('Unsafe sandbox CSS fixed positioning.')\n  }\n  if (/(?:^|[;{])\\s*(?:behavior|-moz-binding)\\s*:/.test(normalized)) {\n    throw new Error('Unsafe sandbox CSS executable property.')\n  }\n}\n\nfunction resolveSandboxProps(\n  props: SandboxHostProps,\n  hostBridge?: HostBridge\n): ResolvedSandboxProps {\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `  const cssText = source['/main.css']\n  if (cssText?.trim() && !cssText.startsWith('/* vibecanvas-trusted-host-layout-v1 */' + String.fromCharCode(10))) {\n    throw new Error('Sandbox guest CSS is disabled by the M7 host policy.')\n  }\n\n  return {\n`,
    newText: `  const cssText = source['/main.css']\n  assertSafeSandboxCss(cssText)\n\n  return {\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `      normalized += ' '\n      index = commentEnd + 2\n      continue\n`,
    newText: `      // Comments cannot split a security-sensitive token into safe pieces.\n      index = commentEnd + 2\n      continue\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `  private readonly renderer: HostRenderer\n  private runner: VmRunner | null = null\n\n  constructor(\n`,
    newText: `  private readonly renderer: HostRenderer\n  private runner: VmRunner | null = null\n  private failed = false\n  private fatalError: unknown\n  private readonly onFatal: (controller: SandboxController, error: unknown) => void\n\n  constructor(\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `    props: ResolvedSandboxProps,\n    events?: SandboxEvents,\n    hostBridge?: HostBridge\n  ) {\n    this.mountPoint = mountPoint\n    this.props = props\n    this.events = events\n    this.hostBridge = hostBridge\n`,
    newText: `    props: ResolvedSandboxProps,\n    events: SandboxEvents | undefined,\n    hostBridge: HostBridge | undefined,\n    onFatal: (controller: SandboxController, error: unknown) => void\n  ) {\n    this.mountPoint = mountPoint\n    this.props = props\n    this.events = events\n    this.hostBridge = hostBridge\n    this.onFatal = onFatal\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `      onError: (error) => this.handleError(error),\n`,
    newText: `      onError: (error) => this.fail(error),\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `      const booted = await this.boot()\n      this.runner?.destroy()\n      this.runner = booted.runner\n`,
    newText: `      const booted = await this.boot()\n      if (this.failed) {\n        booted.runner.destroy()\n        throw this.fatalError\n      }\n      this.runner?.destroy()\n      this.runner = booted.runner\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `    } catch (error) {\n      this.handleError(error)\n      this.destroy()\n      throw error\n    }\n`,
    newText: `    } catch (error) {\n      if (!this.failed) this.handleError(error)\n      this.destroy()\n      throw error\n    }\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `          case 'error':\n            this.handleError(message.error)\n            return\n`,
    newText: `          case 'error':\n            this.fail(message.error)\n            return\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `    } catch (error) {\n      this.handleError(error)\n    }\n  }\n\n  private handleError(error: unknown) {\n`,
    newText: `    } catch (error) {\n      this.fail(error)\n    }\n  }\n\n  private fail(error: unknown) {\n    if (this.failed) return\n    this.failed = true\n    this.fatalError = error\n    this.handleError(error)\n    this.destroy()\n    this.onFatal(this, error)\n  }\n\n  private handleError(error: unknown) {\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `      props,\n      this.sandboxEventsState,\n      this.hostBridgeState\n    )\n`,
    newText: `      props,\n      this.sandboxEventsState,\n      this.hostBridgeState,\n      (controller, error) => {\n        if (this.controller !== controller) {\n          controller.destroy()\n          return\n        }\n        this.destroyController()\n        this.dataset.ready = 'error'\n        this.dispatchEvent(\n          new CustomEvent('sandbox-error', {\n            detail: error,\n          })\n        )\n      }\n    )\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `function flushPendingJobs(runtime: any, context: any) {\n  while (runtime.hasPendingJob()) {\n    context.unwrapResult(runtime.executePendingJobs())\n  }\n}\n\nasync function settleHandle(runtime: any, context: any, handle: any) {\n  const settledResult = context.resolvePromise(handle)\n  flushPendingJobs(runtime, context)\n  const settledHandle = context.unwrapResult(await settledResult)\n  settledHandle.dispose()\n  flushPendingJobs(runtime, context)\n}\n\nasync function evalModule(runtime: any, context: any, code: string, fileName: string) {\n  const result = await context.evalCodeAsync(code, fileName, { type: 'module' })\n  const handle = context.unwrapResult(result)\n  try {\n    await settleHandle(runtime, context, handle)\n  } finally {\n    handle.dispose()\n  }\n}\n`,
    newText: `const SANDBOX_INTERRUPT_CHECK_BUDGET = 128\nconst SANDBOX_EXECUTION_BUDGET_ERROR =\n  'Sandbox execution exceeded the host instruction budget.'\nconst RESET_EXECUTION_BUDGET = '__vibecanvasResetExecutionBudget'\n\nfunction resetRuntimeExecutionBudget(runtime: any) {\n  runtime[RESET_EXECUTION_BUDGET]?.()\n}\n\nfunction normalizeSandboxExecutionError(error: unknown) {\n  const message = error instanceof Error ? error.message : String(error)\n  if (/interrupted/i.test(message)) {\n    return new SandboxRuntimeError(SANDBOX_EXECUTION_BUDGET_ERROR)\n  }\n  return error\n}\n\nfunction flushPendingJobs(runtime: any, context: any, resetBudget = true) {\n  if (resetBudget) resetRuntimeExecutionBudget(runtime)\n  while (runtime.hasPendingJob()) {\n    context.unwrapResult(runtime.executePendingJobs())\n  }\n}\n\nasync function settleHandle(runtime: any, context: any, handle: any) {\n  const settledResult = context.resolvePromise(handle)\n  flushPendingJobs(runtime, context, false)\n  const settledHandle = context.unwrapResult(await settledResult)\n  settledHandle.dispose()\n  flushPendingJobs(runtime, context, false)\n}\n\nasync function evalModule(runtime: any, context: any, code: string, fileName: string) {\n  resetRuntimeExecutionBudget(runtime)\n  try {\n    const result = await context.evalCodeAsync(code, fileName, { type: 'module' })\n    const handle = context.unwrapResult(result)\n    try {\n      await settleHandle(runtime, context, handle)\n    } finally {\n      handle.dispose()\n    }\n  } catch (error) {\n    throw normalizeSandboxExecutionError(error)\n  }\n}\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `  const runtime = quickJs.newRuntime()\n  runtime.setMemoryLimit(16 * 1024 * 1024)\n  runtime.setMaxStackSize(512 * 1024)\n\n  const context = runtime.newContext()\n`,
    newText: `  const runtime = quickJs.newRuntime()\n  runtime.setMemoryLimit(16 * 1024 * 1024)\n  runtime.setMaxStackSize(512 * 1024)\n  let remainingInterruptChecks = SANDBOX_INTERRUPT_CHECK_BUDGET\n  Object.defineProperty(runtime, RESET_EXECUTION_BUDGET, {\n    configurable: false,\n    enumerable: false,\n    value: () => {\n      remainingInterruptChecks = SANDBOX_INTERRUPT_CHECK_BUDGET\n    },\n    writable: false,\n  })\n  runtime.setInterruptHandler(() => {\n    remainingInterruptChecks -= 1\n    return remainingInterruptChecks < 0\n  })\n\n  const context = runtime.newContext()\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `  const formatRuntimeError = (error: unknown) =>\n    error instanceof Error\n      ? [error.message, error.stack].filter(Boolean).join('\\n')\n      : String(error)\n`,
    newText: `  const formatRuntimeError = (error: unknown) => {\n    const normalized = normalizeSandboxExecutionError(error)\n    return normalized instanceof Error\n      ? [normalized.message, normalized.stack].filter(Boolean).join('\\n')\n      : String(normalized)\n  }\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `    try {\n      const result = context.callFunction(callback, context.undefined, args)\n      const returnedHandle = context.unwrapResult(result)\n      returnedHandle.dispose()\n      flushPendingJobs(runtime, context)\n`,
    newText: `    try {\n      resetRuntimeExecutionBudget(runtime)\n      const result = context.callFunction(callback, context.undefined, args)\n      const returnedHandle = context.unwrapResult(result)\n      returnedHandle.dispose()\n      flushPendingJobs(runtime, context, false)\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `  runtime.setModuleLoader(\n`,
    newText: `  const disposeVmRuntime = () => {\n    if (destroyed) return\n    try {\n      destroyed = true\n      for (const timerId of Array.from(timers.keys())) {\n        clearTimer(timerId)\n      }\n      for (const record of Array.from(pendingFetches)) {\n        clearPendingFetch(record)\n        record.controller.abort()\n        record.deferred.dispose()\n      }\n      for (const record of Array.from(pendingBridgeCalls)) {\n        clearPendingBridgeCall(record)\n        record.deferred.dispose()\n      }\n      if (context.alive) {\n        try {\n          const result = context.evalCode(\n            'globalThis.__arrowHostSend = undefined; globalThis.__arrowHostBridge = undefined; globalThis.console = undefined; globalThis.setTimeout = undefined; globalThis.clearTimeout = undefined; globalThis.setInterval = undefined; globalThis.clearInterval = undefined; globalThis.fetch = undefined; globalThis.output = undefined;'\n          )\n          context.unwrapResult(result).dispose()\n        } catch {}\n        context.dispose()\n      }\n    } finally {\n      if (runtime.alive) runtime.dispose()\n    }\n  }\n\n  runtime.setModuleLoader(\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: '  await evalModule(\n    runtime,\n    context,\n    `import ${JSON.stringify(VM_BOOTSTRAP_MODULE_ID)}`,\n',
    newText: '  try {\n    await evalModule(\n      runtime,\n      context,\n      `import ${JSON.stringify(VM_BOOTSTRAP_MODULE_ID)}`,\n',
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `  schedulePendingJobDrain()\n\n  return {\n`,
    newText: `    schedulePendingJobDrain()\n  } catch (error) {\n    disposeVmRuntime()\n    throw error\n  }\n\n  return {\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `    destroy() {\n      try {\n        destroyed = true\n        for (const timerId of Array.from(timers.keys())) {\n          clearTimer(timerId)\n        }\n        for (const record of Array.from(pendingFetches)) {\n          clearPendingFetch(record)\n          record.controller.abort()\n          record.deferred.dispose()\n        }\n        for (const record of Array.from(pendingBridgeCalls)) {\n          clearPendingBridgeCall(record)\n          record.deferred.dispose()\n        }\n        try {\n          const result = context.evalCode(\n            'globalThis.__arrowHostSend = undefined; globalThis.__arrowHostBridge = undefined; globalThis.console = undefined; globalThis.setTimeout = undefined; globalThis.clearTimeout = undefined; globalThis.setInterval = undefined; globalThis.clearInterval = undefined; globalThis.fetch = undefined; globalThis.output = undefined;'\n          )\n          context.unwrapResult(result).dispose()\n        } catch {}\n        context.dispose()\n      } finally {\n        runtime.dispose()\n      }\n    },\n`,
    newText: `    destroy() {\n      disposeVmRuntime()\n    },\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `const SANDBOX_FETCH_TIMEOUT_MS = 15_000\nconst SANDBOX_FETCH_MAX_RESPONSE_BYTES = 1_000_000\nconst HOST_BRIDGE_MODULE_PREFIX = '/__arrow_sandbox/host-bridge/'\n`,
    newText: `const SANDBOX_FETCH_TIMEOUT_MS = 15_000\nconst SANDBOX_FETCH_MAX_RESPONSE_BYTES = 1_000_000\nconst SANDBOX_MAX_ACTIVE_TIMERS = 64\nconst SANDBOX_MIN_TIMER_DELAY_MS = 4\nconst SANDBOX_MAX_PENDING_FETCHES = 8\nconst SANDBOX_MAX_PENDING_BRIDGE_CALLS = 16\nconst SANDBOX_ASYNC_BUDGET_WINDOW_MS = 1_000\nconst SANDBOX_MAX_TIMER_SCHEDULES_PER_WINDOW = 128\nconst SANDBOX_MAX_TIMER_CALLBACKS_PER_WINDOW = 64\nconst SANDBOX_MAX_FETCH_STARTS_PER_WINDOW = 16\nconst SANDBOX_MAX_BRIDGE_STARTS_PER_WINDOW = 64\nconst HOST_BRIDGE_MODULE_PREFIX = '/__arrow_sandbox/host-bridge/'\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `function isLocalHttpHost(hostname: string) {\n  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'\n}\n`,
    newText: `interface SandboxRateBudget {\n  startedAtMs: number\n  used: number\n}\n\nfunction consumeSandboxRateBudget(\n  budget: SandboxRateBudget,\n  maximum: number,\n  capability: string\n) {\n  const now = Date.now()\n  if (now < budget.startedAtMs || now - budget.startedAtMs >= SANDBOX_ASYNC_BUDGET_WINDOW_MS) {\n    budget.startedAtMs = now\n    budget.used = 0\n  }\n  budget.used += 1\n  if (budget.used > maximum) {\n    throw new SandboxRuntimeError(\n      \`Sandbox \${capability} exceeded the host rate budget of \${maximum} per \${SANDBOX_ASYNC_BUDGET_WINDOW_MS}ms.\`\n    )\n  }\n}\n\nfunction isLocalHttpHost(hostname: string) {\n  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'\n}\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `const SANDBOX_INTERRUPT_CHECK_BUDGET = 128\nconst SANDBOX_EXECUTION_BUDGET_ERROR =\n  'Sandbox execution exceeded the host instruction budget.'\nconst RESET_EXECUTION_BUDGET = '__vibecanvasResetExecutionBudget'\n`,
    newText: `const SANDBOX_INTERRUPT_CHECK_BUDGET = 128\nconst SANDBOX_INTERRUPT_WINDOW_CHECK_BUDGET = 1_024\nconst SANDBOX_EXECUTION_BUDGET_ERROR =\n  'Sandbox execution exceeded the host instruction budget.'\nconst RESET_EXECUTION_BUDGET = '__vibecanvasResetExecutionBudget'\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `  let remainingInterruptChecks = SANDBOX_INTERRUPT_CHECK_BUDGET\n  Object.defineProperty(runtime, RESET_EXECUTION_BUDGET, {\n    configurable: false,\n    enumerable: false,\n    value: () => {\n      remainingInterruptChecks = SANDBOX_INTERRUPT_CHECK_BUDGET\n    },\n    writable: false,\n  })\n  runtime.setInterruptHandler(() => {\n    remainingInterruptChecks -= 1\n    return remainingInterruptChecks < 0\n  })\n`,
    newText: `  let executionWindowStartedAtMs = Date.now()\n  let remainingInterruptChecks = SANDBOX_INTERRUPT_CHECK_BUDGET\n  let remainingWindowInterruptChecks = SANDBOX_INTERRUPT_WINDOW_CHECK_BUDGET\n  Object.defineProperty(runtime, RESET_EXECUTION_BUDGET, {\n    configurable: false,\n    enumerable: false,\n    value: () => {\n      const now = Date.now()\n      if (\n        now < executionWindowStartedAtMs\n        || now - executionWindowStartedAtMs >= SANDBOX_ASYNC_BUDGET_WINDOW_MS\n      ) {\n        executionWindowStartedAtMs = now\n        remainingWindowInterruptChecks = SANDBOX_INTERRUPT_WINDOW_CHECK_BUDGET\n      }\n      remainingInterruptChecks = SANDBOX_INTERRUPT_CHECK_BUDGET\n    },\n    writable: false,\n  })\n  runtime.setInterruptHandler(() => {\n    remainingInterruptChecks -= 1\n    remainingWindowInterruptChecks -= 1\n    return remainingInterruptChecks < 0 || remainingWindowInterruptChecks < 0\n  })\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `  const pendingFetches = new Set<SandboxFetchRecord>()\n  const pendingBridgeCalls = new Set<SandboxBridgeRecord>()\n`,
    newText: `  const pendingFetches = new Set<SandboxFetchRecord>()\n  const pendingBridgeCalls = new Set<SandboxBridgeRecord>()\n  const createRateBudget = (): SandboxRateBudget => ({\n    startedAtMs: Date.now(),\n    used: 0,\n  })\n  const timerScheduleRateBudget = createRateBudget()\n  const timerCallbackRateBudget = createRateBudget()\n  const fetchStartRateBudget = createRateBudget()\n  const bridgeStartRateBudget = createRateBudget()\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `      } catch (error) {\n        pendingJobDrainPasses = 0\n        reportRuntimeError(error)\n        return\n      }\n`,
    newText: `      } catch (error) {\n        pendingJobDrainPasses = 0\n        reportRuntimeError(error)\n        disposeVmRuntime()\n        return\n      }\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `    const callback = timer.callback.dup()\n    const args = timer.args.map((arg) => arg.dup())\n\n    try {\n      resetRuntimeExecutionBudget(runtime)\n      const result = context.callFunction(callback, context.undefined, args)\n      const returnedHandle = context.unwrapResult(result)\n      returnedHandle.dispose()\n      flushPendingJobs(runtime, context, false)\n      schedulePendingJobDrain()\n    } catch (error) {\n      reportRuntimeError(error)\n    } finally {\n      callback.dispose()\n      for (const arg of args) {\n        arg.dispose()\n      }\n\n      if (!timer.repeat) {\n        disposeTimerRecord(timer)\n      }\n    }\n`,
    newText: `    const callback = timer.callback.dup()\n    const args = timer.args.map((arg) => arg.dup())\n    let failure: unknown\n\n    try {\n      consumeSandboxRateBudget(\n        timerCallbackRateBudget,\n        SANDBOX_MAX_TIMER_CALLBACKS_PER_WINDOW,\n        'timer callbacks'\n      )\n      resetRuntimeExecutionBudget(runtime)\n      const result = context.callFunction(callback, context.undefined, args)\n      const returnedHandle = context.unwrapResult(result)\n      returnedHandle.dispose()\n      flushPendingJobs(runtime, context, false)\n      schedulePendingJobDrain()\n    } catch (error) {\n      failure = error\n    } finally {\n      callback.dispose()\n      for (const arg of args) {\n        arg.dispose()\n      }\n\n      if (!timer.repeat) {\n        disposeTimerRecord(timer)\n      }\n    }\n\n    if (failure !== undefined) {\n      reportRuntimeError(failure)\n      disposeVmRuntime()\n    }\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `    nextTimerId += 1\n    const timerId = nextTimerId\n    const delayValue = context.getNumber(delayHandle)\n    const delay =\n      Number.isFinite(delayValue) && delayValue > 0 ? delayValue : 0\n`,
    newText: `    if (timers.size >= SANDBOX_MAX_ACTIVE_TIMERS) {\n      throw new SandboxRuntimeError(\n        \`Sandbox timers exceeded the host cap of \${SANDBOX_MAX_ACTIVE_TIMERS} active timers.\`\n      )\n    }\n    consumeSandboxRateBudget(\n      timerScheduleRateBudget,\n      SANDBOX_MAX_TIMER_SCHEDULES_PER_WINDOW,\n      'timer scheduling'\n    )\n\n    nextTimerId += 1\n    const timerId = nextTimerId\n    const delayValue = context.getNumber(delayHandle)\n    const delay = Number.isFinite(delayValue)\n      ? Math.min(Math.max(delayValue, SANDBOX_MIN_TIMER_DELAY_MS), 2_147_483_647)\n      : SANDBOX_MIN_TIMER_DELAY_MS\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `      const args = argHandles.map((argHandle, index) =>\n        normalizeBridgeValue(\n          context.dump(argHandle),\n          \`argument[\${index}]\`\n        )\n      )\n\n      const deferred = context.newPromise()\n`,
    newText: `      const args = argHandles.map((argHandle, index) =>\n        normalizeBridgeValue(\n          context.dump(argHandle),\n          \`argument[\${index}]\`\n        )\n      )\n\n      if (pendingBridgeCalls.size >= SANDBOX_MAX_PENDING_BRIDGE_CALLS) {\n        throw new SandboxRuntimeError(\n          \`Sandbox hostBridge exceeded the host cap of \${SANDBOX_MAX_PENDING_BRIDGE_CALLS} pending calls.\`\n        )\n      }\n      consumeSandboxRateBudget(\n        bridgeStartRateBudget,\n        SANDBOX_MAX_BRIDGE_STARTS_PER_WINDOW,\n        'hostBridge calls'\n      )\n\n      const deferred = context.newPromise()\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `      const request = normalizeFetchRequest(\n        context.getString(inputHandle),\n        !initHandle || context.typeof(initHandle) === 'undefined'\n          ? undefined\n          : context.dump(initHandle)\n      )\n\n      const deferred = context.newPromise()\n`,
    newText: `      const request = normalizeFetchRequest(\n        context.getString(inputHandle),\n        !initHandle || context.typeof(initHandle) === 'undefined'\n          ? undefined\n          : context.dump(initHandle)\n      )\n\n      if (pendingFetches.size >= SANDBOX_MAX_PENDING_FETCHES) {\n        throw new SandboxRuntimeError(\n          \`Sandbox fetch() exceeded the host cap of \${SANDBOX_MAX_PENDING_FETCHES} pending requests.\`\n        )\n      }\n      consumeSandboxRateBudget(\n        fetchStartRateBudget,\n        SANDBOX_MAX_FETCH_STARTS_PER_WINDOW,\n        'fetch() calls'\n      )\n\n      const deferred = context.newPromise()\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `  const disposeVmRuntime = () => {\n    if (destroyed) return\n    try {\n      destroyed = true\n`,
    newText: `  const disposeVmRuntime = () => {\n    if (destroyed) return\n    try {\n      destroyed = true\n      pendingJobDrainPasses = 0\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `  private readonly renderer: HostRenderer\n  private runner: VmRunner | null = null\n  private failed = false\n`,
    newText: `  private readonly renderer: HostRenderer\n  private runner: VmRunner | null = null\n  private readonly bootAbortController = new AbortController()\n  private failed = false\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `  destroy() {\n    this.runner?.destroy()\n`,
    newText: `  destroy() {\n    this.bootAbortController.abort()\n    this.runner?.destroy()\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `      debug: this.props.debug,\n      hostBridge: this.hostBridge,\n      onMessage: (message) => {\n`,
    newText: `      debug: this.props.debug,\n      hostBridge: this.hostBridge,\n      signal: this.bootAbortController.signal,\n      onMessage: (message) => {\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `  private controller: SandboxController | null = null\n  private currentSignature = ''\n`,
    newText: `  private controller: SandboxController | null = null\n  private mountingController: SandboxController | null = null\n  private currentSignature = ''\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `  private destroyController() {\n    this.controller?.destroy()\n`,
    newText: `  private destroyController() {\n    this.mountingController?.destroy()\n    this.mountingController = null\n    this.controller?.destroy()\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `    const nextController = new SandboxController(\n`,
    newText: `    this.mountingController?.destroy()\n    const nextController = new SandboxController(\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `      }\n    )\n\n    try {\n      await nextController.mount()\n    } catch (error) {\n`,
    newText: `      }\n    )\n    this.mountingController = nextController\n\n    try {\n      await nextController.mount()\n    } catch (error) {\n      if (this.mountingController === nextController) {\n        this.mountingController = null\n      }\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `      return\n    }\n\n    if (version !== this.syncVersion) {\n`,
    newText: `      return\n    }\n\n    if (this.mountingController === nextController) {\n      this.mountingController = null\n    }\n\n    if (version !== this.syncVersion) {\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `  debug?: boolean\n  hostBridge?: HostBridge\n  onMessage: (message: VmToHostMessage) => void\n`,
    newText: `  debug?: boolean\n  hostBridge?: HostBridge\n  signal?: AbortSignal\n  onMessage: (message: VmToHostMessage) => void\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `const SANDBOX_FETCH_TIMEOUT_MS = 15_000\nconst SANDBOX_FETCH_MAX_RESPONSE_BYTES = 1_000_000\nconst SANDBOX_MAX_ACTIVE_TIMERS = 64\n`,
    newText: `const SANDBOX_FETCH_TIMEOUT_MS = 15_000\nconst SANDBOX_FETCH_MAX_RESPONSE_BYTES = 1_000_000\nconst SANDBOX_BOOT_TIMEOUT_MS = 10_000\nconst SANDBOX_PROMISE_POLL_INTERVAL_MS = 10\nconst SANDBOX_MAX_ACTIVE_TIMERS = 64\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `}\n\nfunction isLocalHttpHost(hostname: string) {\n  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'\n}\n`,
    newText: `}\n\nasync function readBoundedSandboxFetchBody(response: Response): Promise<Uint8Array> {\n  const contentLength = response.headers.get('content-length')\n  if (\n    contentLength\n    && Number.isFinite(Number(contentLength))\n    && Number(contentLength) > SANDBOX_FETCH_MAX_RESPONSE_BYTES\n  ) {\n    await response.body?.cancel().catch(() => undefined)\n    throw new SandboxRuntimeError(\n      \`Sandbox fetch() response exceeded \${SANDBOX_FETCH_MAX_RESPONSE_BYTES} bytes.\`\n    )\n  }\n\n  if (!response.body) return new Uint8Array()\n  const reader = response.body.getReader()\n  const chunks: Uint8Array[] = []\n  let byteLength = 0\n  let complete = false\n  try {\n    while (true) {\n      const chunk = await reader.read()\n      if (chunk.done) {\n        complete = true\n        break\n      }\n      byteLength += chunk.value.byteLength\n      if (byteLength > SANDBOX_FETCH_MAX_RESPONSE_BYTES) {\n        throw new SandboxRuntimeError(\n          \`Sandbox fetch() response exceeded \${SANDBOX_FETCH_MAX_RESPONSE_BYTES} bytes.\`\n        )\n      }\n      chunks.push(chunk.value)\n    }\n\n    const bodyBytes = new Uint8Array(byteLength)\n    let offset = 0\n    for (const chunk of chunks) {\n      bodyBytes.set(chunk, offset)\n      offset += chunk.byteLength\n    }\n    return bodyBytes\n  } finally {\n    if (!complete) await reader.cancel().catch(() => undefined)\n    reader.releaseLock()\n  }\n}\n\nfunction isLocalHttpHost(hostname: string) {\n  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'\n}\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `async function settleHandle(runtime: any, context: any, handle: any) {\n  const settledResult = context.resolvePromise(handle)\n  flushPendingJobs(runtime, context, false)\n  const settledHandle = context.unwrapResult(await settledResult)\n  settledHandle.dispose()\n  flushPendingJobs(runtime, context, false)\n}\n\nasync function evalModule(runtime: any, context: any, code: string, fileName: string) {\n  resetRuntimeExecutionBudget(runtime)\n  try {\n    const result = await context.evalCodeAsync(code, fileName, { type: 'module' })\n    const handle = context.unwrapResult(result)\n    try {\n      await settleHandle(runtime, context, handle)\n    } finally {\n      handle.dispose()\n    }\n  } catch (error) {\n    throw normalizeSandboxExecutionError(error)\n  }\n}\n`,
    newText: `function sandboxCancellationError(signal: AbortSignal) {\n  return signal.reason instanceof Error\n    ? signal.reason\n    : new SandboxRuntimeError('Sandbox boot was cancelled by its host.')\n}\n\nfunction waitForSandboxPromisePoll(signal?: AbortSignal): Promise<void> {\n  if (signal?.aborted) return Promise.reject(sandboxCancellationError(signal))\n\n  return new Promise((resolve, reject) => {\n    const onAbort = () => {\n      globalThis.clearTimeout(timeoutHandle)\n      signal?.removeEventListener('abort', onAbort)\n      reject(signal ? sandboxCancellationError(signal) : new SandboxRuntimeError(\n        'Sandbox boot was cancelled by its host.'\n      ))\n    }\n    const timeoutHandle = globalThis.setTimeout(() => {\n      signal?.removeEventListener('abort', onAbort)\n      resolve()\n    }, SANDBOX_PROMISE_POLL_INTERVAL_MS)\n    signal?.addEventListener('abort', onAbort, { once: true })\n  })\n}\n\nasync function settleHandle(\n  runtime: any,\n  context: any,\n  handle: any,\n  cancellationSignal?: AbortSignal\n) {\n  while (true) {\n    if (cancellationSignal?.aborted) {\n      throw sandboxCancellationError(cancellationSignal)\n    }\n    flushPendingJobs(runtime, context, false)\n    const state = context.getPromiseState(handle)\n    if (state.type === 'pending') {\n      await waitForSandboxPromisePoll(cancellationSignal)\n      continue\n    }\n    const settledHandle = context.unwrapResult(state)\n    if (!state.notAPromise) settledHandle.dispose()\n    flushPendingJobs(runtime, context, false)\n    return\n  }\n}\n\nasync function evalModule(\n  runtime: any,\n  context: any,\n  code: string,\n  fileName: string,\n  cancellationSignal?: AbortSignal,\n  setActiveHandleDisposer?: (disposer: (() => void) | null) => void\n) {\n  resetRuntimeExecutionBudget(runtime)\n  try {\n    const result = context.evalCode(code, fileName, { type: 'module' })\n    const handle = context.unwrapResult(result)\n    let handleDisposed = false\n    const disposeHandle = () => {\n      if (handleDisposed) return\n      handleDisposed = true\n      if (handle.alive) handle.dispose()\n    }\n    setActiveHandleDisposer?.(disposeHandle)\n    try {\n      await settleHandle(runtime, context, handle, cancellationSignal)\n    } finally {\n      setActiveHandleDisposer?.(null)\n      disposeHandle()\n    }\n  } catch (error) {\n    throw normalizeSandboxExecutionError(error)\n  }\n}\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `): Promise<VmRunner> {\n  const quickJs = await getQuickJsModule(!!options.debug)\n`,
    newText: `): Promise<VmRunner> {\n  let bootStopped = false\n  let disposeBootRuntime: (() => void) | null = null\n  const bootCancellationController = new AbortController()\n  let rejectBootCancellation!: (error: Error) => void\n  const bootCancellation = new Promise<never>((_resolve, reject) => {\n    rejectBootCancellation = reject\n  })\n  const stopBoot = (error: Error) => {\n    if (bootStopped) return\n    bootStopped = true\n    rejectBootCancellation(error)\n    bootCancellationController.abort(error)\n    disposeBootRuntime?.()\n  }\n  const abortBoot = () => stopBoot(\n    new SandboxRuntimeError('Sandbox boot was cancelled by its host.')\n  )\n  options.signal?.addEventListener('abort', abortBoot, { once: true })\n  const bootTimeoutHandle = globalThis.setTimeout(() => {\n    stopBoot(new SandboxRuntimeError(\n      \`Sandbox boot exceeded the host deadline of \${SANDBOX_BOOT_TIMEOUT_MS}ms.\`\n    ))\n  }, SANDBOX_BOOT_TIMEOUT_MS)\n  if (options.signal?.aborted) abortBoot()\n\n  try {\n  const quickJs = await Promise.race([\n    getQuickJsModule(!!options.debug),\n    bootCancellation,\n  ])\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `  const context = runtime.newContext()\n  let destroyed = false\n`,
    newText: `  const context = runtime.newContext()\n  let destroyed = false\n  let activeBootHandleDisposer: (() => void) | null = null\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `  const disposeVmRuntime = () => {\n    if (destroyed) return\n    try {\n      destroyed = true\n      pendingJobDrainPasses = 0\n`,
    newText: `  const disposeVmRuntime = () => {\n    if (destroyed) return\n    try {\n      activeBootHandleDisposer?.()\n      activeBootHandleDisposer = null\n      destroyed = true\n      pendingJobDrainPasses = 0\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `  }\n\n  runtime.setModuleLoader(\n`,
    newText: `  }\n  disposeBootRuntime = disposeVmRuntime\n  if (bootStopped) {\n    disposeVmRuntime()\n    await bootCancellation\n  }\n\n  runtime.setModuleLoader(\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `      \`import \${JSON.stringify(VM_BOOTSTRAP_MODULE_ID)}\`,\n    '/__arrow_sandbox/bootstrap-loader.js'\n  )\n`,
    newText: `      \`import \${JSON.stringify(VM_BOOTSTRAP_MODULE_ID)}\`,\n      '/__arrow_sandbox/bootstrap-loader.js',\n      bootCancellationController.signal,\n      (disposer) => { activeBootHandleDisposer = disposer }\n  )\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `    \`await globalThis.__arrowSandboxInit(\${JSON.stringify(initPayload)})\`,\n    '/__arrow_sandbox/init.js'\n  )\n`,
    newText: `    \`await globalThis.__arrowSandboxInit(\${JSON.stringify(initPayload)})\`,\n    '/__arrow_sandbox/init.js',\n    bootCancellationController.signal,\n    (disposer) => { activeBootHandleDisposer = disposer }\n  )\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `  return {\n    async dispatch(message: HostToVmMessage) {\n      await dispatchToVm(message)\n    },\n    destroy() {\n      disposeVmRuntime()\n    },\n  }\n}\n`,
    newText: `  return {\n    async dispatch(message: HostToVmMessage) {\n      await dispatchToVm(message)\n    },\n    destroy() {\n      disposeVmRuntime()\n    },\n  }\n  } finally {\n    bootStopped = true\n    disposeBootRuntime = null\n    globalThis.clearTimeout(bootTimeoutHandle)\n    options.signal?.removeEventListener('abort', abortBoot)\n  }\n}\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `          const contentLength = response.headers.get('content-length')\n          if (\n            contentLength &&\n            Number.isFinite(Number(contentLength)) &&\n            Number(contentLength) > SANDBOX_FETCH_MAX_RESPONSE_BYTES\n          ) {\n            throw new SandboxRuntimeError(\n              \`Sandbox fetch() response exceeded \${SANDBOX_FETCH_MAX_RESPONSE_BYTES} bytes.\`\n            )\n          }\n\n          const bodyBuffer = new Uint8Array(await response.arrayBuffer())\n          if (bodyBuffer.byteLength > SANDBOX_FETCH_MAX_RESPONSE_BYTES) {\n            throw new SandboxRuntimeError(\n              \`Sandbox fetch() response exceeded \${SANDBOX_FETCH_MAX_RESPONSE_BYTES} bytes.\`\n            )\n          }\n`,
    newText: `          const bodyBytes = await readBoundedSandboxFetchBody(response)\n          if (!record.active || destroyed) return\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `            bodyBytes: bodyBuffer,\n`,
    newText: `            bodyBytes,\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `interface SandboxBridgeRecord {\n  deferred: any\n  active: boolean\n}\n\nexport interface VmRunner {\n`,
    newText: `interface SandboxBridgeRecord {\n  deferred: any\n  active: boolean\n}\n\ninterface SandboxDispatchRecord {\n  message: HostToVmMessage\n  resolve: () => void\n  reject: (error: unknown) => void\n}\n\nexport interface VmRunner {\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `const SANDBOX_BOOT_TIMEOUT_MS = 10_000\nconst SANDBOX_PROMISE_POLL_INTERVAL_MS = 10\nconst SANDBOX_MAX_ACTIVE_TIMERS = 64\n`,
    newText: `const SANDBOX_BOOT_TIMEOUT_MS = 10_000\nconst SANDBOX_PROMISE_POLL_INTERVAL_MS = 10\nconst SANDBOX_EVENT_DISPATCH_TIMEOUT_MS = 1_000\nconst SANDBOX_MAX_PENDING_EVENT_DISPATCHES = 16\nconst SANDBOX_MAX_ACTIVE_TIMERS = 64\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `  const bootCancellationController = new AbortController()\n`,
    newText: `  const runnerCancellationController = new AbortController()\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `    bootCancellationController.abort(error)\n`,
    newText: `    runnerCancellationController.abort(error)\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `  const context = runtime.newContext()\n  let destroyed = false\n  let activeBootHandleDisposer: (() => void) | null = null\n  let nextTimerId = 0\n`,
    newText: `  const context = runtime.newContext()\n  let destroyed = false\n  let activeEvaluationHandleDisposer: (() => void) | null = null\n  let activeDispatch = false\n  let nextDispatchId = 0\n  let runtimeFatalError: Error | null = null\n  const dispatchQueue: SandboxDispatchRecord[] = []\n  let nextTimerId = 0\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `  const dispatchToVm = async (message: HostToVmMessage) => {\n    if (destroyed) return\n\n    await evalModule(\n      runtime,\n      context,\n      \`await globalThis.__arrowSandboxDispatch(\${JSON.stringify(message)})\`,\n      \`/__arrow_sandbox/dispatch-\${Date.now()}.js\`\n    )\n    schedulePendingJobDrain()\n  }\n`,
    newText: `  const settleQueuedDispatches = (error?: Error) => {\n    for (const record of dispatchQueue.splice(0)) {\n      if (error) record.reject(error)\n      else record.resolve()\n    }\n  }\n\n  const failVmRuntime = (error: unknown) => {\n    if (runtimeFatalError) return runtimeFatalError\n    const normalized = normalizeSandboxExecutionError(error)\n    runtimeFatalError = normalized instanceof Error\n      ? normalized\n      : new SandboxRuntimeError(String(normalized))\n    runnerCancellationController.abort(runtimeFatalError)\n    disposeVmRuntime()\n    return runtimeFatalError\n  }\n\n  const dispatchToVm = async (message: HostToVmMessage) => {\n    if (destroyed) return\n\n    nextDispatchId += 1\n    const timeoutHandle = globalThis.setTimeout(() => {\n      failVmRuntime(new SandboxRuntimeError(\n        \`Sandbox event dispatch exceeded the host deadline of \${SANDBOX_EVENT_DISPATCH_TIMEOUT_MS}ms.\`\n      ))\n    }, SANDBOX_EVENT_DISPATCH_TIMEOUT_MS)\n    try {\n      await evalModule(\n        runtime,\n        context,\n        \`await globalThis.__arrowSandboxDispatch(\${JSON.stringify(message)})\`,\n        \`/__arrow_sandbox/dispatch-\${nextDispatchId}.js\`,\n        runnerCancellationController.signal,\n        (disposer) => { activeEvaluationHandleDisposer = disposer }\n      )\n      if (!destroyed) schedulePendingJobDrain()\n    } finally {\n      globalThis.clearTimeout(timeoutHandle)\n    }\n  }\n\n  const drainDispatchQueue = async () => {\n    if (activeDispatch || destroyed) return\n    activeDispatch = true\n    try {\n      while (!destroyed && dispatchQueue.length > 0) {\n        const record = dispatchQueue.shift()!\n        try {\n          await dispatchToVm(record.message)\n          record.resolve()\n        } catch (error) {\n          if (destroyed && !runtimeFatalError) {\n            record.resolve()\n            return\n          }\n          const fatalError = runtimeFatalError ?? failVmRuntime(error)\n          record.reject(fatalError)\n          return\n        }\n      }\n    } finally {\n      activeDispatch = false\n    }\n  }\n\n  const enqueueDispatch = (message: HostToVmMessage): Promise<void> => {\n    if (destroyed) {\n      return runtimeFatalError ? Promise.reject(runtimeFatalError) : Promise.resolve()\n    }\n\n    if (message.type === 'event' && message.payload.event.type === 'pointermove') {\n      for (let index = dispatchQueue.length - 1; index >= 0; index -= 1) {\n        const queued = dispatchQueue[index]!\n        if (\n          queued.message.type === 'event'\n          && queued.message.payload.event.type === 'pointermove'\n          && queued.message.payload.handlerId === message.payload.handlerId\n        ) {\n          queued.message = message\n          return Promise.resolve()\n        }\n      }\n    }\n\n    const pendingDispatchCount = dispatchQueue.length + (activeDispatch ? 1 : 0)\n    if (pendingDispatchCount >= SANDBOX_MAX_PENDING_EVENT_DISPATCHES) {\n      const error = failVmRuntime(new SandboxRuntimeError(\n        \`Sandbox events exceeded the host cap of \${SANDBOX_MAX_PENDING_EVENT_DISPATCHES} pending dispatches.\`\n      ))\n      return Promise.reject(error)\n    }\n\n    return new Promise((resolve, reject) => {\n      dispatchQueue.push({ message, resolve, reject })\n      void drainDispatchQueue()\n    })\n  }\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `  const disposeVmRuntime = () => {\n    if (destroyed) return\n    try {\n      activeBootHandleDisposer?.()\n      activeBootHandleDisposer = null\n      destroyed = true\n      pendingJobDrainPasses = 0\n`,
    newText: `  const disposeVmRuntime = () => {\n    if (destroyed) return\n    try {\n      destroyed = true\n      runnerCancellationController.abort(new SandboxRuntimeError(\n        'Sandbox runtime was destroyed by its host.'\n      ))\n      activeEvaluationHandleDisposer?.()\n      activeEvaluationHandleDisposer = null\n      settleQueuedDispatches(runtimeFatalError ?? undefined)\n      pendingJobDrainPasses = 0\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `      bootCancellationController.signal,\n      (disposer) => { activeBootHandleDisposer = disposer }\n`,
    newText: `      runnerCancellationController.signal,\n      (disposer) => { activeEvaluationHandleDisposer = disposer }\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `    bootCancellationController.signal,\n    (disposer) => { activeBootHandleDisposer = disposer }\n`,
    newText: `    runnerCancellationController.signal,\n    (disposer) => { activeEvaluationHandleDisposer = disposer }\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `    async dispatch(message: HostToVmMessage) {\n      await dispatchToVm(message)\n`,
    newText: `    async dispatch(message: HostToVmMessage) {\n      await enqueueDispatch(message)\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `const SANDBOX_MAX_BRIDGE_STARTS_PER_WINDOW = 64\nconst HOST_BRIDGE_MODULE_PREFIX = '/__arrow_sandbox/host-bridge/'\nconst textDecoder = new TextDecoder()\n`,
    newText: `const SANDBOX_MAX_BRIDGE_STARTS_PER_WINDOW = 64\n${vmMessageValidationSource}\n`,
  },
  {
    path: 'src/host/quickjs.ts',
    oldText: `  const hostSend = context.newFunction('__arrowHostSend', (messageHandle: any) => {\n    const message = context.getString(messageHandle)\n    options.onMessage(JSON.parse(message))\n  })\n`,
    newText: `  const hostSend = context.newFunction('__arrowHostSend', (messageHandle: any) => {\n    if (context.typeof(messageHandle) !== 'string') {\n      throw sandboxProtocolError('must be serialized as a string')\n    }\n    const message = context.getString(messageHandle)\n    options.onMessage(parseSandboxVmMessage(message))\n  })\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `const SANDBOX_TAG_NAME = 'arrow-sandbox'\nconst sandboxHostRecords = new Map<string, SandboxHostRecord>()\n`,
    newText: `const SANDBOX_TAG_NAME = 'arrow-sandbox'\nconst SANDBOX_MAX_INITIAL_PATCHES = 1_024\nconst sandboxHostRecords = new Map<string, SandboxHostRecord>()\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `          case 'render':\n            if (!activated) {\n              initialTree = message.tree\n              return\n            }\n`,
    newText: `          case 'render':\n            if (!activated) {\n              if (initialTree !== null) {\n                throw new Error('Sandbox VM emitted more than one initial render tree.')\n              }\n              initialTree = message.tree\n              return\n            }\n`,
  },
  {
    path: 'src/host/instance.ts',
    oldText: `          case 'patch':\n            if (!activated) {\n              initialPatches.push(...message.patches)\n              return\n            }\n`,
    newText: `          case 'patch':\n            if (!activated) {\n              if (\n                initialPatches.length + message.patches.length\n                  > SANDBOX_MAX_INITIAL_PATCHES\n              ) {\n                throw new Error(\n                  \`Sandbox VM exceeded the boot cap of \${SANDBOX_MAX_INITIAL_PATCHES} initial patches.\`\n                )\n              }\n              initialPatches.push(...message.patches)\n              return\n            }\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `const SAFE_INPUT_TYPES = new Set([\n  'button', 'checkbox', 'color', 'date', 'datetime-local', 'email', 'hidden',\n  'month', 'number', 'password', 'radio', 'range', 'reset', 'search', 'submit',\n  'tel', 'text', 'time', 'url', 'week',\n])\n`,
    newText: `const SAFE_INPUT_TYPES = new Set([\n  'button', 'checkbox', 'color', 'date', 'datetime-local', 'email', 'hidden',\n  'month', 'number', 'password', 'radio', 'range', 'reset', 'search', 'submit',\n  'tel', 'text', 'time', 'url', 'week',\n])\nconst SANDBOX_MAX_LIVE_RENDER_NODES = 4_096\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `  private readonly delegatedListeners = new Map<string, EventListener>()\n\n  constructor(options: RendererOptions) {\n`,
    newText: `  private readonly delegatedListeners = new Map<string, EventListener>()\n  private liveNodeCount = 0\n\n  constructor(options: RendererOptions) {\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `    this.nodes.clear()\n    this.regions.clear()\n    this.elementEvents.clear()\n  }\n`,
    newText: `    this.nodes.clear()\n    this.regions.clear()\n    this.elementEvents.clear()\n    this.liveNodeCount = 0\n  }\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `      case 'element': {\n        assertSafeSandboxTag(serialized.tag, serialized.namespace)\n        const element =\n`,
    newText: `      case 'element': {\n        assertSafeSandboxTag(serialized.tag, serialized.namespace)\n        this.reserveLiveNode(serialized.id)\n        const element =\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `      case 'text': {\n        const text = document.createTextNode(serialized.text)\n`,
    newText: `      case 'text': {\n        this.reserveLiveNode(serialized.id)\n        const text = document.createTextNode(serialized.text)\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `      case 'region': {\n        const fragment = document.createDocumentFragment()\n`,
    newText: `      case 'region': {\n        this.reserveLiveNode(serialized.id)\n        const fragment = document.createDocumentFragment()\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `    if (nodeId) {\n      this.nodes.delete(nodeId)\n      this.elementEvents.delete(nodeId)\n    }\n`,
    newText: `    if (nodeId) {\n      this.nodes.delete(nodeId)\n      this.elementEvents.delete(nodeId)\n      this.liveNodeCount -= 1\n    }\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `    if (regionId) {\n      this.regions.delete(regionId)\n    }\n`,
    newText: `    if (regionId) {\n      this.regions.delete(regionId)\n      this.liveNodeCount -= 1\n    }\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `  private writeAttribute(\n`,
    newText: `  private reserveLiveNode(nodeId: string) {\n    if (this.nodes.has(nodeId) || this.regions.has(nodeId)) {\n      throw new Error('Sandbox render contains a duplicate live node id.')\n    }\n    if (this.liveNodeCount >= SANDBOX_MAX_LIVE_RENDER_NODES) {\n      throw new Error(\n        \`Sandbox render exceeded the host cap of \${SANDBOX_MAX_LIVE_RENDER_NODES} live nodes.\`\n      )\n    }\n    this.liveNodeCount += 1\n  }\n\n  private writeAttribute(\n`,
  },
  {
    path: 'src/host/renderer.ts',
    oldText: `  private setEventBinding(nodeId: string, eventType: string, handlerId: string) {\n    assertSafeSandboxEvent(eventType)\n    const bindings = this.elementEvents.get(nodeId) || new Map<string, string>()\n`,
    newText: `  private setEventBinding(nodeId: string, eventType: string, handlerId: string) {\n    assertSafeSandboxEvent(eventType)\n    if (!(this.nodes.get(nodeId) instanceof Element)) {\n      throw new Error('Sandbox event binding references an unknown element node.')\n    }\n    const bindings = this.elementEvents.get(nodeId) || new Map<string, string>()\n`,
  },
];

function applyPatch(path, oldText, newText) {
  const source = readFileSync(path, 'utf8');
  const relativePath = path.slice(path.lastIndexOf('/src/') + 1);
  const finalGuards = requiredSecurityGuards
    .filter(([guardPath]) => guardPath === relativePath)
    .map(([, guard]) => guard);
  if (finalGuards.length > 0 && finalGuards.every((guard) => source.includes(guard))) {
    return false;
  }
  if (source.includes(newText)) return false;
  if (checkOnly) return false;
  if (!source.includes(oldText)) {
    // A later exact patch may deliberately refine this segment. Mandatory
    // final guards below keep both installation and --check fail-closed.
    return false;
  }
  if (!checkOnly) writeFileSync(path, source.replace(oldText, newText));
  return true;
}

const requiredSecurityGuards = [
  ['src/host/renderer.ts', 'const SAFE_HTML_TAGS = new Set(['],
  ['src/host/renderer.ts', "'fieldset', 'footer', 'form'"],
  ['src/host/renderer.ts', "'reset', 'submit'"],
  ['src/host/renderer.ts', 'const SAFE_BUTTON_TYPES = new Set(['],
  ['src/host/renderer.ts', "element.addEventListener('submit', preventSandboxFormNavigation)"],
  ['src/host/renderer.ts', 'assertSafeSandboxTag(serialized.tag, serialized.namespace)'],
  ['src/host/renderer.ts', 'assertSafeSandboxAttribute(element, name, value)'],
  ['src/host/renderer.ts', 'assertSafeSandboxEvent(eventType)'],
  ['src/host/renderer.ts', 'const SANDBOX_MAX_LIVE_RENDER_NODES = 4_096'],
  ['src/host/renderer.ts', 'const SANDBOX_MAX_LIVE_RENDER_DEPTH = 32'],
  ['src/host/renderer.ts', 'const SANDBOX_MAX_LIVE_TEXT_CHARACTERS = 262_144'],
  ['src/host/renderer.ts', 'const SANDBOX_MAX_LIVE_ATTRIBUTES = 4_096'],
  ['src/host/renderer.ts', 'const SANDBOX_MAX_LIVE_ATTRIBUTES_PER_ELEMENT = 64'],
  ['src/host/renderer.ts', 'const SANDBOX_MAX_LIVE_ATTRIBUTE_CHARACTERS = 262_144'],
  ['src/host/renderer.ts', 'const SANDBOX_MAX_LIVE_EVENTS = 1_024'],
  ['src/host/renderer.ts', 'const SANDBOX_MAX_LIVE_EVENTS_PER_ELEMENT = 16'],
  ['src/host/renderer.ts', 'private readonly regionDepths = new Map<string, number>()'],
  ['src/host/renderer.ts', 'private readonly liveNodeIds = new Set<string>()'],
  ['src/host/renderer.ts', 'private reserveLiveNode(nodeId: string, depth: number, domNodeCount = 1)'],
  ['src/host/renderer.ts', 'private reserveLiveText(characterCount: number)'],
  ['src/host/renderer.ts', 'private fail(error: unknown)'],
  ['src/host/renderer.ts', 'this.onError(normalized)'],
  ['src/host/renderer.ts', 'this.liveNodeCount -= 2'],
  ['src/host/renderer.ts', 'Sandbox event binding references an unknown element node.'],
  ['src/host/instance.ts', 'const TRUSTED_HOST_LAYOUT_CSS = ['],
  ['src/host/instance.ts', 'function assertSafeSandboxCss(cssText: string | undefined)'],
  ['src/host/instance.ts', 'assertSafeSandboxCss(cssText)'],
  ['src/host/instance.ts', 'Comments cannot split a security-sensitive token'],
  ['src/host/instance.ts', 'private fail(error: unknown, fromRenderer = false)'],
  ['src/host/instance.ts', 'this.onFatal(this, error)'],
  ['src/host/instance.ts', 'if (this.controller !== controller)'],
  ['src/host/instance.ts', "this.dataset.ready = 'error'"],
  ['src/host/instance.ts', 'if (!this.failed) this.handleError(error)'],
  ['src/host/instance.ts', 'private readonly bootAbortController = new AbortController()'],
  ['src/host/instance.ts', 'private deferRunnerDestroy = false'],
  ['src/host/instance.ts', 'private mountingController: SandboxController | null = null'],
  ['src/host/instance.ts', 'onError: (error) => this.fail(error, true)'],
  ['src/host/instance.ts', 'if (this.deferRunnerDestroy) queueMicrotask(() => runner.destroy())'],
  ['src/host/instance.ts', 'if (this.failed) return'],
  ['src/host/instance.ts', 'signal: this.bootAbortController.signal'],
  ['src/host/instance.ts', 'const SANDBOX_MAX_INITIAL_PATCHES = 1_024'],
  ['src/host/instance.ts', 'Sandbox VM exceeded the boot cap of'],
  ['src/host/instance.ts', 'Sandbox VM emitted more than one initial render tree.'],
  [
    'src/host/instance.ts',
    'if (this.mountingController !== nextController) {\n      nextController.destroy()\n      return\n    }\n    this.mountingController = null',
  ],
  ['src/host/instance.ts', 'if (this.failed) throw this.fatalError'],
  ['src/host/instance.ts', 'private reportSandboxError(error: unknown)'],
  ['src/host/quickjs.ts', 'const SANDBOX_INTERRUPT_WINDOW_CHECK_BUDGET = 1_024'],
  ['src/host/quickjs.ts', 'Sandbox execution exceeded the host instruction budget.'],
  ['src/host/quickjs.ts', 'remainingWindowInterruptChecks -= 1'],
  ['src/host/quickjs.ts', 'const SANDBOX_MAX_ACTIVE_TIMERS = 64'],
  ['src/host/quickjs.ts', 'const SANDBOX_MAX_PENDING_FETCHES = 8'],
  ['src/host/quickjs.ts', 'const SANDBOX_MAX_PENDING_BRIDGE_CALLS = 16'],
  ['src/host/quickjs.ts', 'const SANDBOX_MAX_BRIDGE_IDENTIFIER_CHARACTERS = 256'],
  ['src/host/quickjs.ts', 'const SANDBOX_MAX_VM_MESSAGES_PER_WINDOW = 256'],
  ['src/host/quickjs.ts', "'timer callbacks'"],
  ['src/host/quickjs.ts', "'timer scheduling'"],
  ['src/host/quickjs.ts', "'fetch() calls'"],
  ['src/host/quickjs.ts', "'hostBridge calls'"],
  ['src/host/quickjs.ts', "'VM messages'"],
  ['src/host/quickjs.ts', 'pendingJobDrainPasses = 0'],
  ['src/host/quickjs.ts', 'destroyed = true\n      runnerCancellationController.abort'],
  ['src/host/quickjs.ts', 'record.controller.abort()'],
  ['src/host/quickjs.ts', 'globalThis.__arrowHostBridge = undefined'],
  ['src/host/quickjs.ts', 'catch (error) {\n    disposeVmRuntime()\n    throw error'],
  ['src/host/quickjs.ts', 'disposeVmRuntime()'],
  ['src/host/quickjs.ts', 'const SANDBOX_BOOT_TIMEOUT_MS = 10_000'],
  ['src/host/quickjs.ts', 'const SANDBOX_PROMISE_POLL_INTERVAL_MS = 10'],
  ['src/host/quickjs.ts', 'const SANDBOX_EVENT_DISPATCH_TIMEOUT_MS = 1_000'],
  ['src/host/quickjs.ts', 'const SANDBOX_MAX_PENDING_EVENT_DISPATCHES = 16'],
  ['src/host/quickjs.ts', 'async function readBoundedSandboxFetchBody(response: Response)'],
  ['src/host/quickjs.ts', 'const bootCancellation = new Promise<never>'],
  ['src/host/quickjs.ts', 'const runnerCancellationController = new AbortController()'],
  ['src/host/quickjs.ts', 'const state = context.getPromiseState(handle)'],
  ['src/host/quickjs.ts', 'const result = context.evalCode(code, fileName'],
  ['src/host/quickjs.ts', 'activeEvaluationHandleDisposer?.()'],
  ['src/host/quickjs.ts', 'interface SandboxDispatchRecord'],
  ['src/host/quickjs.ts', 'const dispatchQueue: SandboxDispatchRecord[] = []'],
  ['src/host/quickjs.ts', 'const settleQueuedDispatches = (error?: Error)'],
  ['src/host/quickjs.ts', 'const enqueueDispatch = (message: HostToVmMessage): Promise<void>'],
  ['src/host/quickjs.ts', "message.payload.event.type === 'pointermove'"],
  ['src/host/quickjs.ts', 'Sandbox events exceeded the host cap of'],
  ['src/host/quickjs.ts', 'Sandbox event dispatch exceeded the host deadline of'],
  ['src/host/quickjs.ts', 'disposeBootRuntime = disposeVmRuntime'],
  ['src/host/quickjs.ts', 'const bodyBytes = await readBoundedSandboxFetchBody(response)'],
  ['src/host/quickjs.ts', '            bodyBytes,\n'],
  ['src/host/quickjs.ts', '      await enqueueDispatch(message)'],
  ['src/host/quickjs.ts', 'const SANDBOX_MAX_VM_MESSAGE_BYTES = 1_000_000'],
  ['src/host/quickjs.ts', 'const SANDBOX_MAX_BRIDGE_VALUE_NODES = 10_000'],
  ['src/host/quickjs.ts', 'const SANDBOX_MAX_BRIDGE_VALUE_DEPTH = 32'],
  ['src/host/quickjs.ts', 'const SANDBOX_MAX_BRIDGE_VALUE_UTF8_BYTES = 1_000_000'],
  ['src/host/quickjs.ts', 'function normalizeBridgeHandle('],
  ['src/host/quickjs.ts', 'active.some((activeHandle) => context.eq(handle, activeHandle))'],
  ['src/host/quickjs.ts', 'const bridgeValueBudget = createSandboxBridgeValueBudget()'],
  ['src/host/quickjs.ts', 'normalizeBridgeValue(value, \'return value\', bridgeValueBudget)'],
  ['src/host/quickjs.ts', 'function parseSandboxVmMessage(serialized: string): VmToHostMessage'],
  ['src/host/quickjs.ts', 'function assertSandboxSerializedNodes('],
  ['src/host/quickjs.ts', 'options.onMessage(parseSandboxVmMessage(message))'],
];

let changed = 0;
for (const packageJsonPath of packageJsonPaths) {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (packageJson.version !== PINNED_VERSION) {
    throw new Error(
      `[patch-arrow-sandbox-security] expected ${PINNED_VERSION}, found ${String(packageJson.version)}`,
    );
  }
  const quickJsPackageJsonPath = createRequire(packageJsonPath)
    .resolve('quickjs-emscripten/package.json');
  const quickJsPackageJson = JSON.parse(readFileSync(quickJsPackageJsonPath, 'utf8'));
  if (quickJsPackageJson.version !== PINNED_QUICKJS_VERSION) {
    throw new Error(
      `[patch-arrow-sandbox-security] expected QuickJS ${PINNED_QUICKJS_VERSION}, found ${String(quickJsPackageJson.version)}`,
    );
  }
  const packageRoot = dirname(packageJsonPath);
  for (const patch of patches) {
    if (applyPatch(join(packageRoot, patch.path), patch.oldText, patch.newText)) changed += 1;
  }
  for (const [relativePath, expectedSource] of pinnedSources) {
    const sourcePath = join(packageRoot, relativePath);
    if (readFileSync(sourcePath, 'utf8') === expectedSource) continue;
    if (checkOnly) {
      throw new Error(
        `[patch-arrow-sandbox-security] pinned source drift: ${relativePath}`,
      );
    }
    writeFileSync(sourcePath, expectedSource);
    changed += 1;
  }
  for (const [relativePath, guard] of requiredSecurityGuards) {
    if (!readFileSync(join(packageRoot, relativePath), 'utf8').includes(guard)) {
      throw new Error(
        `[patch-arrow-sandbox-security] required final guard is missing: ${relativePath}: ${guard}`,
      );
    }
  }
}

console.log(
  checkOnly
    ? `[patch-arrow-sandbox-security] verified ${patches.length} transformations and ${pinnedSources.length} pinned sources on ${packageJsonPaths.length} package(s)`
    : `[patch-arrow-sandbox-security] ${changed > 0 ? `patched ${changed} segment(s)` : 'already patched'}`,
);
