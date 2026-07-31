import type { Accessor } from 'solid-js';
import { createSignal, mapArray } from 'solid-js';
import type { TBrowserTenantScope } from '@omnidraw/canvas/fn.browser-tenant-scope';
import { LOCAL_BROWSER_TENANT_SCOPE } from '@omnidraw/canvas/CONSTANTS';

type TBrowserTenantActivation = Readonly<{
  generation: number;
  scope: TBrowserTenantScope;
}>;

const initialScope = Object.freeze({
  ...LOCAL_BROWSER_TENANT_SCOPE,
  deploymentOrigin: globalThis.location?.origin ?? 'http://localhost',
}) satisfies TBrowserTenantScope;

const [browserTenantActivation, setBrowserTenantActivation] = createSignal<TBrowserTenantActivation>(
  Object.freeze({ generation: 0, scope: initialScope }),
);

function getBrowserTenantScope(): TBrowserTenantScope {
  return browserTenantActivation().scope;
}

function getBrowserTenantActivation(): TBrowserTenantActivation {
  return browserTenantActivation();
}

function activateBrowserTenantScope(scope: TBrowserTenantScope): void {
  const previous = browserTenantActivation();
  setBrowserTenantActivation(Object.freeze({
    generation: previous.generation + 1,
    scope: Object.freeze({ ...scope }),
  }));
}

function isBrowserTenantActivationCurrent(activation: TBrowserTenantActivation): boolean {
  return browserTenantActivation() === activation;
}

function createBrowserTenantBoundary<T>(
  render: (scope: TBrowserTenantScope) => T,
): Accessor<T[]> {
  return mapArray(
    () => [browserTenantActivation()],
    (activation) => render(activation.scope),
  );
}

export {
  activateBrowserTenantScope,
  createBrowserTenantBoundary,
  getBrowserTenantActivation,
  getBrowserTenantScope,
  isBrowserTenantActivationCurrent,
};
export type { TBrowserTenantActivation };
