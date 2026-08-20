import type {
  IInfiniteCanvasEngine,
  ITransientSceneOwner,
  TSerializedSceneCommand,
} from '@omnidraw/cangine';
import {
  createEvenOrderKeys,
  IDENTITY_TRANSFORM_2D,
  orderKeyBetween,
} from '@omnidraw/cangine';
import type {
  IStandardCanvasEditor,
  TWidgetActivation,
} from '@omnidraw/cangine/editor';
import {
  fnStringifyCanonicalCanvasJson,
  type TCanvasSceneNode,
  type TWidgetFrameNode,
} from '@omnidraw/canvas-contract';
import { Effect } from 'effect';
import type {
  TCanvasExtensionDocumentPort,
  TCanvasExtensionConfig,
  TCanvasExtensionInsertionNode,
  TCanvasExtensionContext,
  TCanvasExternalPlacementPort,
  TCanvasExternalWidgetPreview,
  TCanvasShellProjectionPort,
  TCanvasWidgetHostPort,
  TCanvasWidgetHostRegistration,
  TCanvasWidgetTitlebarModel,
} from '../extension';
import type { TReproductionTraceSink } from '../debug-trace/typed';
import type { CanvasDocumentService } from '../services/CanvasDocumentService';
import { CanvasEffectRuntime } from './CanvasEffectRuntime';
import {
  CANVAS_RUNTIME_CONTENT_LAYER_ID,
  fnCanvasContractNodeToCangine,
  fnCangineNodeToAuthoredCanvasContract,
} from './cangine-contract-adapter';

type TMountRecord = {
  readonly abort: AbortController;
  readonly contentHost: HTMLElement;
  readonly host: HTMLElement;
  readonly listeners: Set<(node: TWidgetFrameNode) => void>;
  node: TWidgetFrameNode;
  nodeSignature: string;
  titlebarModel: TCanvasWidgetTitlebarModel | null;
  titlebarElement: HTMLElement | null;
  cleanup: (() => void) | null;
  cleanupInvoked: boolean;
  retired: boolean;
};

type TPortalRecord = {
  readonly nodeId: string;
  readonly registrationId: string;
  readonly mounts: Set<TMountRecord>;
  unregister: () => void;
};

type TRegistrationRecord = {
  readonly registration: TCanvasWidgetHostRegistration;
  readonly actions: Set<AbortController>;
};

type TPlacementPreviewRecord = {
  readonly owner: ITransientSceneOwner;
  readonly nodeId: string;
  readonly title: string | undefined;
  disposed: boolean;
};

export type TCanvasExtensionBridgeOptions = Readonly<{
  config: TCanvasExtensionConfig;
  document: CanvasDocumentService;
  editor: IStandardCanvasEditor;
  engine: IInfiniteCanvasEngine;
  trace: TReproductionTraceSink | null;
  shell: TCanvasShellProjectionPort;
  subscribeWidgetActions(
    listener: (activation: TWidgetActivation) => void,
  ): () => void;
  onError(error: unknown): void;
}>;

function compareNodes(
  left: Readonly<TCanvasSceneNode>,
  right: Readonly<TCanvasSceneNode>,
): number {
  const order = left.orderKey.localeCompare(right.orderKey);
  return order === 0 ? left.id.localeCompare(right.id) : order;
}

function planFrontInsertion(
  engine: IInfiniteCanvasEngine,
  node: TCanvasExtensionInsertionNode,
): readonly TSerializedSceneCommand[] {
  if (engine.scene.has(node.id)) {
    throw new RangeError(`Canvas front insertion requires a new node ID; '${node.id}' already exists.`);
  }
  const parentId = node.parentId ?? CANVAS_RUNTIME_CONTENT_LAYER_ID;
  const siblings = engine.scene.childrenOf(parentId);
  const directOrderKey = orderKeyBetween(siblings.at(-1)?.orderKey ?? null, null);
  const siblingReorders: TSerializedSceneCommand[] = [];
  let orderKey = directOrderKey;
  if (orderKey === null) {
    const orderKeys = createEvenOrderKeys(siblings.length + 1);
    siblings.forEach((sibling, index) => {
      if (sibling.orderKey === orderKeys[index]) return;
      siblingReorders.push({
        type: 'reorder',
        nodeId: sibling.id,
        orderKey: orderKeys[index]!,
      });
    });
    orderKey = orderKeys.at(-1)!;
  }
  const orderedNode = fnCanvasContractNodeToCangine({
    ...node,
    orderKey,
  } as TCanvasSceneNode);
  return [
    ...siblingReorders,
    { type: 'upsert', node: orderedNode },
  ];
}

function mapSceneCommand(
  command: Parameters<TCanvasExtensionDocumentPort['commit']>[0]['commands'][number],
): TSerializedSceneCommand {
  switch (command.type) {
    case 'upsert':
      return { type: 'upsert', node: fnCanvasContractNodeToCangine(command.node) };
    case 'remove':
      return {
        type: 'remove',
        nodeId: command.nodeId,
        descendants: command.descendants ?? 'remove',
      };
    case 'reparent':
      return {
        type: 'reparent',
        nodeId: command.nodeId,
        parentId: command.parentId ?? CANVAS_RUNTIME_CONTENT_LAYER_ID,
        ...(command.orderKey === undefined ? {} : { orderKey: command.orderKey }),
      };
    case 'reorder':
      return { type: 'reorder', nodeId: command.nodeId, orderKey: command.orderKey };
  }
}

/** Private adapter from public, renderer-neutral extensions to Cangine. */
export class CanvasExtensionBridge {
  readonly context: TCanvasExtensionContext;
  readonly #options: TCanvasExtensionBridgeOptions;
  readonly #effects = new CanvasEffectRuntime();
  readonly #registrations = new Map<string, TRegistrationRecord>();
  readonly #portals = new Map<string, TPortalRecord>();
  readonly #placementPreviews = new Set<TPlacementPreviewRecord>();
  readonly #releaseDocument: () => void;
  readonly #releaseActions: () => void;
  readonly #releasePortalState: () => void;
  #disposed = false;

  constructor(options: TCanvasExtensionBridgeOptions) {
    this.#options = options;
    const document = this.#createDocumentPort();
    const widgets: TCanvasWidgetHostPort = Object.freeze({
      register: (registration) => this.#registerWidget(registration),
    });
    const placement = this.#createPlacementPort();
    this.context = Object.freeze({
      config: options.config,
      document,
      placement,
      widgets,
      trace: options.trace,
      shell: options.shell,
    });
    this.#releaseDocument = options.document.subscribeAuthored(() => {
      this.#reconcilePortals();
      this.#notifyMountedNodes();
      this.#refreshTitlebars();
    });
    this.#releaseActions = options.subscribeWidgetActions(
      (activation) => this.#handleActivation(activation),
    );
    this.#releasePortalState = options.engine.portals.subscribe(() => {
      this.#refreshTitlebars();
    });
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#releaseDocument();
    this.#releaseActions();
    this.#releasePortalState();
    for (const record of this.#registrations.values()) {
      for (const action of record.actions) action.abort();
      record.actions.clear();
    }
    this.#registrations.clear();
    for (const portal of [...this.#portals.values()]) this.#retirePortal(portal);
    this.#portals.clear();
    for (const preview of [...this.#placementPreviews]) {
      this.#disposePlacementPreview(preview);
    }
    await this.#effects.dispose();
  }

  #createPlacementPort(): TCanvasExternalPlacementPort {
    const assertFinitePoint = (point: Readonly<{ x: number; y: number }>) => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new RangeError('Canvas placement points must contain finite coordinates.');
      }
    };
    return Object.freeze({
      containsClientPoint: (point) => {
        assertFinitePoint(point);
        const bounds = this.#options.config.container.getBoundingClientRect();
        return point.x >= bounds.left
          && point.x <= bounds.right
          && point.y >= bounds.top
          && point.y <= bounds.bottom;
      },
      clientToWorld: (point) => {
        assertFinitePoint(point);
        const viewport = this.#options.engine.camera.clientToViewport(point);
        const world = this.#options.engine.camera.viewportToWorld(viewport);
        return Object.freeze({ x: world.x, y: world.y });
      },
      visibleWorldBounds: () => {
        const bounds = this.#options.engine.camera.visibleWorldBounds();
        return Object.freeze({ ...bounds });
      },
      viewportCenter: () => {
        const size = this.#options.engine.camera.viewportSize;
        const world = this.#options.engine.camera.viewportToWorld({
          x: size.width / 2,
          y: size.height / 2,
        });
        return Object.freeze({ x: world.x, y: world.y });
      },
      createWidgetPreview: (args) => this.#createPlacementPreview(args),
    });
  }

  #createPlacementPreview(args: Readonly<{
    nodeId: string;
    title?: string;
  }>): TCanvasExternalWidgetPreview {
    if (this.#disposed) throw new Error('Canvas extension bridge is disposed.');
    const nodeId = args.nodeId.trim();
    if (nodeId.length === 0 || nodeId !== args.nodeId) {
      throw new RangeError('Canvas placement preview node ID must be non-empty and trimmed.');
    }
    const record: TPlacementPreviewRecord = {
      owner: this.#options.engine.transients.createOwner(
        `omnidraw:external-placement:${nodeId}`,
      ),
      nodeId,
      title: args.title,
      disposed: false,
    };
    this.#placementPreviews.add(record);
    return Object.freeze({
      update: (worldBounds) => {
        if (record.disposed || this.#disposed) return;
        if (
          !Number.isFinite(worldBounds.x)
          || !Number.isFinite(worldBounds.y)
          || !Number.isFinite(worldBounds.width)
          || !Number.isFinite(worldBounds.height)
          || worldBounds.width <= 0
          || worldBounds.height <= 0
        ) {
          throw new RangeError(
            'Canvas placement preview bounds must be finite and have positive size.',
          );
        }
        record.owner.replace({
          band: 'world-overlay',
          hitTest: 'none',
          nodes: [{
            id: record.nodeId,
            kind: 'widget-frame',
            parentId: null,
            orderKey: 'm',
            transform: {
              ...IDENTITY_TRANSFORM_2D,
              position: { x: worldBounds.x, y: worldBounds.y },
            },
            size: {
              width: worldBounds.width,
              height: worldBounds.height,
            },
            ...(record.title === undefined ? {} : { title: record.title }),
          }],
        });
      },
      clear: () => {
        if (!record.disposed) record.owner.clear();
      },
      dispose: () => this.#disposePlacementPreview(record),
    });
  }

  #disposePlacementPreview(record: TPlacementPreviewRecord): void {
    if (record.disposed) return;
    record.disposed = true;
    this.#placementPreviews.delete(record);
    record.owner.destroy();
  }

  #createDocumentPort(): TCanvasExtensionDocumentPort {
    const authoredNodes = (): readonly TCanvasSceneNode[] => (
      this.#options.document.authoredNodes()
        .map((node) => fnCangineNodeToAuthoredCanvasContract(node))
        .sort(compareNodes)
    );
    return Object.freeze({
      item: (itemId) => this.#options.document.item(itemId),
      items: () => this.#options.document.items(),
      node: (nodeId) => {
        const node = this.#options.document.authoredNode(nodeId);
        return node === null ? null : fnCangineNodeToAuthoredCanvasContract(node);
      },
      nodes: authoredNodes,
      childrenOf: (parentId) => authoredNodes()
        .filter((node) => node.parentId === parentId),
      query: (query) => this.#options.document.query(query),
      commit: (mutation) => {
        if (this.#disposed) throw new Error('Canvas extension bridge is disposed.');
        if (mutation.source.trim().length === 0) {
          throw new RangeError('Canvas extension mutation source cannot be empty.');
        }
        if (mutation.commands.length === 0) {
          throw new RangeError('Canvas extension mutation requires at least one command.');
        }
        this.#options.editor.commitSceneMutation({
          source: mutation.source,
          ...(mutation.coalesceKey === undefined
            ? {}
            : { coalesceKey: mutation.coalesceKey }),
          commands: mutation.commands.map(mapSceneCommand),
        });
      },
      insertAtFront: (insertion) => {
        if (this.#disposed) throw new Error('Canvas extension bridge is disposed.');
        if (insertion.source.trim().length === 0) {
          throw new RangeError('Canvas extension insertion source cannot be empty.');
        }
        this.#options.editor.commitSceneMutation({
          source: insertion.source,
          commands: planFrontInsertion(this.#options.engine, insertion.node),
        });
      },
      setSelection: (nodeIds, options) => {
        this.#options.editor.setSelection(nodeIds, options);
      },
      subscribe: (listener) => this.#options.document.subscribeAuthored(() => {
        try {
          listener();
        } catch (error) {
          this.#options.onError(error);
        }
      }),
    });
  }

  #registerWidget(registration: TCanvasWidgetHostRegistration): () => void {
    if (this.#disposed) throw new Error('Canvas extension bridge is disposed.');
    const id = registration.id.trim();
    if (id.length === 0) throw new RangeError('Widget registration ID cannot be empty.');
    if (id !== registration.id) {
      throw new RangeError('Widget registration ID cannot contain surrounding whitespace.');
    }
    if (this.#registrations.has(id)) {
      throw new RangeError(`Widget registration '${id}' already exists.`);
    }
    const record: TRegistrationRecord = {
      registration,
      actions: new Set(),
    };
    this.#registrations.set(id, record);
    this.#reconcilePortals();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.#registrations.get(id) !== record) return;
      this.#registrations.delete(id);
      for (const action of record.actions) action.abort();
      record.actions.clear();
      this.#reconcilePortals();
    };
  }

  #widgetNode(nodeId: string): TWidgetFrameNode | null {
    const node = this.#options.document.authoredNode(nodeId);
    if (node === null || node.kind !== 'widget-frame') return null;
    const authored = fnCangineNodeToAuthoredCanvasContract(node);
    return authored.kind === 'widget-frame' ? authored : null;
  }

  #matchingRegistration(node: TWidgetFrameNode): TRegistrationRecord | null {
    for (const record of this.#registrations.values()) {
      try {
        if (record.registration.match(node)) return record;
      } catch (error) {
        this.#options.onError(error);
      }
    }
    return null;
  }

  #isAcceptedNode(node: TWidgetFrameNode): boolean {
    const accepted = this.#options.document.item(node.id)?.item;
    if (accepted === undefined) return false;
    return fnStringifyCanonicalCanvasJson(accepted)
      === fnStringifyCanonicalCanvasJson(node);
  }

  #reconcilePortals(): void {
    if (this.#disposed) return;
    const desired = new Map<string, TRegistrationRecord>();
    for (const node of this.#options.document.authoredNodes()) {
      if (node.kind !== 'widget-frame') continue;
      const authored = fnCangineNodeToAuthoredCanvasContract(node);
      if (authored.kind !== 'widget-frame') continue;
      const registration = this.#matchingRegistration(authored);
      if (registration !== null) desired.set(node.id, registration);
    }
    for (const portal of [...this.#portals.values()]) {
      const registration = desired.get(portal.nodeId);
      if (registration?.registration.id === portal.registrationId) continue;
      this.#retirePortal(portal);
      this.#portals.delete(portal.nodeId);
    }
    for (const [nodeId, registration] of desired) {
      if (this.#portals.has(nodeId)) continue;
      const node = this.#widgetNode(nodeId);
      // The authored frame is optimistic, but executable portal content cannot
      // start until this exact node image is accepted by durable authority.
      if (node === null || !this.#isAcceptedNode(node)) continue;
      const portal: TPortalRecord = {
        nodeId,
        registrationId: registration.registration.id,
        mounts: new Set(),
        unregister: () => undefined,
      };
      this.#portals.set(nodeId, portal);
      try {
        portal.unregister = this.#options.engine.portals.register({
          portalId: `omnidraw:widget:${nodeId}`,
          mount: ({ host }) => this.#mountWidget(portal, registration, host),
        });
      } catch (error) {
        this.#portals.delete(nodeId);
        this.#options.onError(error);
      }
    }
  }

  #mountWidget(
    portal: TPortalRecord,
    record: TRegistrationRecord,
    host: HTMLElement,
  ): void | (() => void) | Promise<void | (() => void)> {
    const node = this.#widgetNode(portal.nodeId);
    if (node === null) return;
    const contentHost = host.ownerDocument.createElement('div');
    contentHost.dataset.omnidrawWidgetContentHost = '';
    Object.assign(contentHost.style, {
      boxSizing: 'border-box',
      height: '100%',
      minHeight: '0',
      minWidth: '0',
      width: '100%',
    });
    // Cangine owns keyboard shortcuts outside widget content. Once focus has
    // entered a widget, keyboard events must first reach the embedded editor
    // and then stop at this inner boundary. Without the boundary Cangine's
    // portal surface consumes keydown before ProseMirror/guest editors can
    // update their state, leaving visible DOM text that cannot be submitted.
    const containKeyboardEvent = (event: KeyboardEvent) => {
      event.stopPropagation();
    };
    contentHost.addEventListener('keydown', containKeyboardEvent);
    contentHost.addEventListener('keyup', containKeyboardEvent);
    host.append(contentHost);
    const mount: TMountRecord = {
      abort: new AbortController(),
      contentHost,
      host,
      listeners: new Set(),
      node,
      nodeSignature: fnStringifyCanonicalCanvasJson(node),
      titlebarModel: null,
      titlebarElement: null,
      cleanup: null,
      cleanupInvoked: false,
      retired: false,
    };
    portal.mounts.add(mount);
    let result: ReturnType<TCanvasWidgetHostRegistration['mount']>;
    try {
      result = record.registration.mount(Object.freeze({
        node,
        container: contentHost,
        signal: mount.abort.signal,
        setTitlebar: (model: TCanvasWidgetTitlebarModel) => {
          if (mount.retired) return;
          mount.titlebarModel = Object.freeze({ ...model });
          this.#applyTitlebar(mount, record, host);
        },
        onNodeChange: (listener: (node: TWidgetFrameNode) => void) => {
          if (mount.retired) return () => undefined;
          mount.listeners.add(listener);
          return () => { mount.listeners.delete(listener); };
        },
      }));
    } catch (error) {
      this.#retireMount(portal, mount);
      throw error;
    }
    if (!(result instanceof Promise)) {
      if (result !== undefined && typeof result !== 'function') {
        this.#retireMount(portal, mount);
        throw new TypeError('Widget mount must return void, a disposer, or a Promise.');
      }
      mount.cleanup = result ?? null;
      return () => this.#retireMount(portal, mount);
    }
    return Promise.resolve(result).then((cleanup) => {
      if (cleanup !== undefined && typeof cleanup !== 'function') {
        throw new TypeError('Widget mount Promise must resolve to void or a disposer.');
      }
      if (mount.retired) {
        if (typeof cleanup === 'function') this.#invokeMountCleanup(mount, cleanup);
        return;
      }
      mount.cleanup = cleanup ?? null;
      return () => this.#retireMount(portal, mount);
    }, (error) => {
      this.#retireMount(portal, mount);
      throw error;
    });
  }

  #retireMount(portal: TPortalRecord, mount: TMountRecord): void {
    if (mount.retired) return;
    mount.retired = true;
    mount.abort.abort();
    mount.listeners.clear();
    mount.titlebarElement?.remove();
    mount.titlebarElement = null;
    portal.mounts.delete(mount);
    if (mount.cleanup !== null) this.#invokeMountCleanup(mount, mount.cleanup);
    mount.cleanup = null;
    mount.contentHost.remove();
  }

  #invokeMountCleanup(mount: TMountRecord, cleanup: () => void): void {
    if (mount.cleanupInvoked) return;
    mount.cleanupInvoked = true;
    try {
      cleanup();
    } catch (error) {
      this.#options.onError(error);
    }
  }

  #retirePortal(portal: TPortalRecord): void {
    for (const mount of [...portal.mounts]) this.#retireMount(portal, mount);
    try {
      portal.unregister();
    } catch (error) {
      this.#options.onError(error);
    }
  }

  #notifyMountedNodes(): void {
    for (const portal of this.#portals.values()) {
      const node = this.#widgetNode(portal.nodeId);
      if (node === null) continue;
      const signature = fnStringifyCanonicalCanvasJson(node);
      for (const mount of portal.mounts) {
        if (mount.retired || signature === mount.nodeSignature) continue;
        mount.node = node;
        mount.nodeSignature = signature;
        for (const listener of [...mount.listeners]) {
          try {
            listener(node);
          } catch (error) {
            this.#options.onError(error);
          }
        }
      }
    }
  }

  #applyTitlebar(
    mount: TMountRecord,
    registration: TRegistrationRecord,
    host: HTMLElement,
  ): void {
    mount.titlebarElement?.remove();
    mount.titlebarElement = null;
    const model = mount.titlebarModel;
    if (model === null) return;
    const titlebar = host.parentElement?.querySelector<HTMLElement>(
      ':scope > [data-vibecanvas-widget-titlebar]',
    );
    if (titlebar === undefined || titlebar === null) return;
    const surface = titlebar.ownerDocument.createElement('div');
    surface.dataset.omnidrawWidgetExtensionTitlebar = registration.registration.id;
    Object.assign(surface.style, {
      alignItems: 'center',
      display: 'flex',
      gap: '6px',
      height: '100%',
      maxWidth: '70%',
      position: 'absolute',
      right: '8px',
      top: '0',
      zIndex: '1',
    });
    if (model.title !== undefined) {
      const title = titlebar.ownerDocument.createElement('span');
      title.textContent = model.title;
      title.style.cssText = 'font:600 12px/16px system-ui,sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      surface.append(title);
    }
    if (model.badge !== undefined) {
      const badge = titlebar.ownerDocument.createElement('span');
      badge.textContent = model.badge;
      badge.style.cssText = 'font:600 10px/16px system-ui,sans-serif;opacity:.68;white-space:nowrap';
      surface.append(badge);
    }
    for (const action of model.actions ?? []) {
      const button = titlebar.ownerDocument.createElement('button');
      button.type = 'button';
      button.disabled = action.disabled ?? false;
      button.textContent = action.icon ?? action.label;
      button.setAttribute('aria-label', action.label);
      button.style.cssText = 'appearance:none;background:transparent;border:0;border-radius:5px;cursor:pointer;font:600 12px/16px system-ui,sans-serif;height:24px;padding:0 6px';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.#dispatchAction(registration, mount.node, action.id);
      });
      surface.append(button);
    }
    titlebar.append(surface);
    mount.titlebarElement = surface;
  }

  #refreshTitlebars(): void {
    if (this.#disposed) return;
    for (const portal of this.#portals.values()) {
      const registration = this.#registrations.get(portal.registrationId);
      if (registration === undefined) continue;
      for (const mount of portal.mounts) {
        if (mount.retired || mount.titlebarModel === null) continue;
        this.#applyTitlebar(mount, registration, mount.host);
      }
    }
  }

  #handleActivation(activation: TWidgetActivation): void {
    if (activation.type === 'traffic-light') {
      const node = this.#widgetNode(activation.widgetId);
      if (node === null) return;
      if (activation.control === 'close') {
        this.#options.editor.commitSceneMutation({
          source: 'omnidraw.widget-frame.close',
          commands: [{ type: 'remove', nodeId: node.id, descendants: 'remove' }],
        });
        return;
      }
      this.#options.editor.commitSceneMutation({
        source: 'omnidraw.widget-frame.minimize',
        commands: [mapSceneCommand({
          type: 'upsert',
          node: { ...node, collapsed: node.collapsed !== true },
        })],
      });
      return;
    }
    if (activation.type !== 'header-button' && activation.type !== 'dropdown-item') {
      return;
    }
    const node = this.#widgetNode(activation.widgetId);
    if (node === null) return;
    const record = this.#matchingRegistration(node);
    if (record === null) return;
    const actionId = activation.type === 'header-button'
      ? activation.itemId
      : `${activation.itemId}/${activation.dropdownItemId}`;
    this.#dispatchAction(record, node, actionId);
  }

  #dispatchAction(
    record: TRegistrationRecord,
    node: TWidgetFrameNode,
    actionId: string,
  ): void {
    const onAction = record.registration.onAction;
    if (onAction === undefined || this.#disposed) return;
    const abort = new AbortController();
    record.actions.add(abort);
    this.#effects.fork(
      Effect.tryPromise({
        try: async (runtimeSignal) => {
          const relayAbort = () => abort.abort();
          runtimeSignal.addEventListener('abort', relayAbort, { once: true });
          try {
            await onAction(Object.freeze({ node, actionId, signal: abort.signal }));
          } finally {
            runtimeSignal.removeEventListener('abort', relayAbort);
            record.actions.delete(abort);
          }
        },
        catch: (cause) => cause,
      }),
      (error) => this.#options.onError(error),
    );
  }
}
