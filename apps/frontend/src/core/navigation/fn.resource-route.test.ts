import { describe, expect, test } from 'bun:test';
import { fnBeginResourceRouteLoad, fnResolveResourceRouteLoad, type TResourceRouteLoadState } from './fn.resource-route';

type TResource = { id: string; name: string };

describe('resource route load state', () => {
  test('ignores an older response that finishes after the current resource response', () => {
    let state: TResourceRouteLoadState<TResource> = {
      requestId: 0,
      resourceId: '',
      resource: null,
      error: '',
    };
    state = fnBeginResourceRouteLoad({ state, requestId: 1, resourceId: 'resource-a' });
    state = fnBeginResourceRouteLoad({ state, requestId: 2, resourceId: 'resource-b' });
    state = fnResolveResourceRouteLoad({
      state,
      requestId: 2,
      resourceId: 'resource-b',
      resource: { id: 'resource-b', name: 'Current resource' },
      error: '',
    });
    state = fnResolveResourceRouteLoad({
      state,
      requestId: 1,
      resourceId: 'resource-a',
      resource: { id: 'resource-a', name: 'Stale resource' },
      error: '',
    });

    expect(state).toEqual({
      requestId: 2,
      resourceId: 'resource-b',
      resource: { id: 'resource-b', name: 'Current resource' },
      error: '',
    });
  });

  test('ignores a stale error after a newer resource has loaded', () => {
    const current = fnResolveResourceRouteLoad({
      state: fnBeginResourceRouteLoad<TResource>({
        state: { requestId: 1, resourceId: 'resource-a', resource: null, error: '' },
        requestId: 2,
        resourceId: 'resource-b',
      }),
      requestId: 2,
      resourceId: 'resource-b',
      resource: { id: 'resource-b', name: 'Current resource' },
      error: '',
    });

    expect(fnResolveResourceRouteLoad({
      state: current,
      requestId: 1,
      resourceId: 'resource-a',
      resource: null,
      error: 'Old request failed',
    })).toBe(current);
  });
});
