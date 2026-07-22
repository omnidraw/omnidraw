import {
  isValidAutomergeUrl,
  type DocHandleChangePayload,
} from '@automerge/automerge-repo';
import {
  createWidgetCollaborativeStatePort,
  type TMutableWidgetCollaborativeStateDocument,
  type TWidgetCollaborativeStateDocumentPort,
} from '@vibecanvas/ui-ai-chat/widget-runtime';
import { openAutomergeDocument, releaseAutomergeDocument } from './automerge';
import {
  getBrowserTenantActivation,
  getBrowserTenantScope,
  isBrowserTenantActivationCurrent,
} from './tenant';

function assertCurrentActivation(
  activation: ReturnType<typeof getBrowserTenantActivation>,
): void {
  if (!isBrowserTenantActivationCurrent(activation)) {
    throw new Error('Widget collaborative state tenant scope changed.');
  }
}

export const widgetCollaborativeStatePort = createWidgetCollaborativeStatePort({
  nowMs: () => Date.now(),
  isIdentityCurrent(identity) {
    return getBrowserTenantScope().orgId === identity.orgId;
  },
  async openDocument({ identity, signal }): Promise<TWidgetCollaborativeStateDocumentPort> {
    const activation = getBrowserTenantActivation();
    if (
      activation.scope.orgId !== identity.orgId
      || !isValidAutomergeUrl(identity.stateDocumentId)
    ) {
      throw new Error('Widget collaborative state document is unavailable.');
    }
    const handle = await openAutomergeDocument<TMutableWidgetCollaborativeStateDocument>(
      activation.scope,
      identity.stateDocumentId,
      signal,
    );
    try {
      assertCurrentActivation(activation);
    } catch (error) {
      await releaseAutomergeDocument(activation.scope, handle).catch(() => undefined);
      throw error;
    }
    let disposed = false;
    const listenerMap = new Map<() => void, (payload: DocHandleChangePayload<TMutableWidgetCollaborativeStateDocument>) => void>();
    return Object.freeze({
      read() {
        assertCurrentActivation(activation);
        return handle.doc();
      },
      change(mutator) {
        assertCurrentActivation(activation);
        handle.change(mutator);
      },
      subscribe(listener) {
        assertCurrentActivation(activation);
        const onChange = () => listener();
        listenerMap.set(listener, onChange);
        handle.on('change', onChange);
        return () => {
          const registered = listenerMap.get(listener);
          if (!registered) return;
          listenerMap.delete(listener);
          handle.off('change', registered);
        };
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const registered of listenerMap.values()) handle.off('change', registered);
        listenerMap.clear();
        void releaseAutomergeDocument(activation.scope, handle).catch(() => undefined);
      },
    });
  },
});
