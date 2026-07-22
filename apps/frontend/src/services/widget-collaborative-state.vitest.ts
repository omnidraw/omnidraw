import { afterEach, describe, expect, test, vi } from 'vitest';
import type { TBrowserTenantScope } from '@vibecanvas/canvas/fn.browser-tenant-scope';
import {
  activateBrowserTenantScope,
  getBrowserTenantScope,
} from './tenant';

const automerge = vi.hoisted(() => ({
  openAutomergeDocument: vi.fn(),
  releaseAutomergeDocument: vi.fn(async () => undefined),
}));

vi.mock('./automerge', () => automerge);

import { widgetCollaborativeStatePort } from './widget-collaborative-state';

const originalScope = getBrowserTenantScope();
const stateDocumentId = 'automerge:4P9w8qKtNvbzkexUwmBRETTKQgLf';

function tenantScope(): TBrowserTenantScope {
  return Object.freeze({
    accountId: 'account-a',
    cellId: 'cell-a',
    deploymentOrigin: 'https://cloud.example',
    orgId: 'org-a',
    placementEpoch: 1,
  });
}

afterEach(() => {
  automerge.openAutomergeDocument.mockReset();
  automerge.releaseAutomergeDocument.mockClear();
  activateBrowserTenantScope(originalScope);
});

describe('widget collaborative-state browser adapter', () => {
  test('releases an acquired document lease when the same tenant scope is reactivated', async () => {
    const scope = tenantScope();
    activateBrowserTenantScope(scope);
    const handle = Object.freeze({ documentId: '4P9w8qKtNvbzkexUwmBRETTKQgLf' });
    automerge.openAutomergeDocument.mockImplementation(async () => {
      activateBrowserTenantScope({ ...scope });
      return handle;
    });

    await expect(widgetCollaborativeStatePort.open({
      identity: {
        orgId: scope.orgId,
        canvasId: 'canvas-a',
        elementId: 'element-a',
        widgetInstanceId: 'instance-a',
        definitionId: 'definition-a',
        revisionId: 'revision-a',
        stateDocumentId,
      },
      signal: new AbortController().signal,
      isCurrent: () => true,
    })).rejects.toThrow('tenant scope changed');

    expect(automerge.releaseAutomergeDocument).toHaveBeenCalledOnce();
    expect(automerge.releaseAutomergeDocument).toHaveBeenCalledWith(scope, handle);
  });
});
