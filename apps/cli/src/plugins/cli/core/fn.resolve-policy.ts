/* eslint-disable functional-core/export-shape -- legacy default export kept for existing CLI update tests */
type TInstallMethod = 'curl' | 'npm' | 'unknown';

type TArgs = {
  method: TInstallMethod;
  envDisable: string | undefined;
  configAutoupdate: boolean | 'notify' | undefined;
};

type TResolvedPolicy = {
  mode: 'disabled' | 'notify' | 'install';
  reason: 'env' | 'config' | 'method' | 'default';
};

function fnCliUpdateResolvePolicy(args: TArgs): TErrTuple<TResolvedPolicy> {
  if (args.envDisable === '1') {
    return [{ mode: 'disabled', reason: 'env' }, null];
  }

  if (args.configAutoupdate === false) {
    return [{ mode: 'disabled', reason: 'config' }, null];
  }

  if (args.configAutoupdate === 'notify') {
    return [{ mode: 'notify', reason: 'config' }, null];
  }

  if (args.method !== 'curl') {
    return [{ mode: 'notify', reason: 'method' }, null];
  }

  return [{ mode: 'install', reason: 'default' }, null];
}

export default fnCliUpdateResolvePolicy;
export type { TArgs, TResolvedPolicy, TInstallMethod };
