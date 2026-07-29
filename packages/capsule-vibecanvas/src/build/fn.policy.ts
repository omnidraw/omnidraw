import type {
  CapsuleBuildPolicy,
  CapsuleBuildTarget,
  CapsuleCompleteBudgetMaximums,
} from '@omnidraw/capsule/protocol';
import type {
  TWidgetCapsuleBudgetRequest,
  TWidgetCapsuleBudgets,
  TWidgetCapsuleTarget,
} from '@vibecanvas/widget-contract';
import {
  VIBECANVAS_CAPSULE_ALLOWED_FEATURE_PROFILES,
  VIBECANVAS_CAPSULE_ALLOWED_TARGET,
  VIBECANVAS_CAPSULE_BUDGET_CEILINGS,
  VIBECANVAS_CAPSULE_BUILD_POLICY,
  VIBECANVAS_CAPSULE_DEFAULT_BUDGETS,
  VIBECANVAS_CAPSULE_GPU_FEATURE_PROFILES,
} from './CONSTANTS';

const BUDGET_KEYS = [
  'cpuMs',
  'memoryBytes',
  'domNodes',
  'handles',
  'messageBytes',
  'streamBytes',
  'assetBytes',
  'networkBytes',
  'gpuBytes',
  'lifecycleBytes',
] as const;

export function fnResolveVibecanvasCapsuleBudgets(
  request: TWidgetCapsuleBudgetRequest,
): TWidgetCapsuleBudgets {
  const result = {} as Record<(typeof BUDGET_KEYS)[number], number>;
  for (const key of BUDGET_KEYS) {
    const value = request[key] ?? VIBECANVAS_CAPSULE_DEFAULT_BUDGETS[key];
    if (
      typeof value !== 'number'
      || !Number.isFinite(value)
      || value < 0
      || value > VIBECANVAS_CAPSULE_BUDGET_CEILINGS[key]
      || (key !== 'cpuMs' && !Number.isSafeInteger(value))
    ) {
      throw new TypeError(`Capsule budget '${key}' exceeds Vibecanvas policy.`);
    }
    result[key] = value;
  }
  return Object.freeze(result);
}

export function fnVibecanvasCapsuleBuildTarget(args: Readonly<{
  target: TWidgetCapsuleTarget;
  entry: string;
}>): CapsuleBuildTarget {
  if (
    args.target.runtimeAbi !== VIBECANVAS_CAPSULE_ALLOWED_TARGET.runtimeAbi
    || args.target.domProfile !== VIBECANVAS_CAPSULE_ALLOWED_TARGET.domProfile
  ) {
    throw new TypeError('Widget Capsule target is outside Vibecanvas policy.');
  }
  const allowed = new Set<string>(VIBECANVAS_CAPSULE_ALLOWED_FEATURE_PROFILES);
  for (const profile of args.target.featureProfiles) {
    if (!allowed.has(profile)) {
      const suggestion = profile === 'webgl-v1'
        ? " Did you mean 'canvas-webgl-v1'?"
        : profile === 'webgpu-v1'
          ? " Did you mean 'canvas-webgpu-v1'?"
          : '';
      throw new TypeError(
        `Widget Capsule feature profile '${profile}' is not supported.${suggestion} `
        + `Supported profiles: ${VIBECANVAS_CAPSULE_ALLOWED_FEATURE_PROFILES.join(', ')}.`,
      );
    }
  }
  return Object.freeze({
    runtimeAbi: args.target.runtimeAbi,
    domProfile: args.target.domProfile,
    featureProfiles: Object.freeze([...args.target.featureProfiles].sort()),
    language: 'js',
  });
}

export function fnAssertVibecanvasCapsuleProfileBudgets(args: Readonly<{
  target: TWidgetCapsuleTarget;
  budgets: TWidgetCapsuleBudgets;
}>): void {
  const gpuProfile = args.target.featureProfiles.find(
    (profile) => VIBECANVAS_CAPSULE_GPU_FEATURE_PROFILES.includes(
      profile as (typeof VIBECANVAS_CAPSULE_GPU_FEATURE_PROFILES)[number],
    ),
  );
  if (gpuProfile === undefined || args.budgets.gpuBytes > 0) return;
  throw new TypeError(
    `Widget Capsule feature profile '${gpuProfile}' requires ui.budgets.gpuBytes `
    + `between 1 and ${String(VIBECANVAS_CAPSULE_BUDGET_CEILINGS.gpuBytes)} bytes.`,
  );
}

export function fnVibecanvasCapsuleBuildPolicy(): CapsuleBuildPolicy {
  return VIBECANVAS_CAPSULE_BUILD_POLICY as CapsuleBuildPolicy;
}

export function fnVibecanvasCapsuleCompleteBudgets(
  budgets: TWidgetCapsuleBudgets,
): CapsuleCompleteBudgetMaximums {
  return Object.freeze({ ...budgets });
}
