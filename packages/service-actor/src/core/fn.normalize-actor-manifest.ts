import type {
  TActorState,
  TResolvedTransition,
  TResolvedVibecanvasJson,
  TTransition,
  TVibecanvasJson,
} from './types';

export type TNormalizeTransitionResult = {
  transition: TResolvedTransition;
  warning?: string;
};

export type TNormalizeVibecanvasJsonResult = {
  manifest: TResolvedVibecanvasJson;
  warnings: string[];
};

export function fnNormalizeTransition(
  transition: TTransition,
  sourceState: TActorState,
  path = 'transition',
): TNormalizeTransitionResult {
  if ('targetState' in transition) {
    return {
      transition: {
        func: transition.func,
        targetState: transition.targetState,
        onError: transition.onError,
      },
    };
  }

  const [onlyTarget] = transition.allowedTargetStates;
  if (transition.allowedTargetStates.length === 1 && onlyTarget) {
    return {
      transition: {
        func: transition.func,
        targetState: onlyTarget,
        onError: transition.onError,
      },
    };
  }

  return {
    transition: {
      func: transition.func,
      targetState: sourceState,
      onError: transition.onError,
    },
    warning: `${path}.allowedTargetStates has ${transition.allowedTargetStates.length} entries; preserving legacy no-state-change behavior`,
  };
}

export function fnNormalizeVibecanvasJson(manifest: TVibecanvasJson): TNormalizeVibecanvasJsonResult {
  const warnings: string[] = [];
  const states = Object.fromEntries(Object.entries(manifest.actor.states).map(([stateName, config]) => {
    if (!config) return [stateName, config];

    const on = Object.fromEntries(Object.entries(config.on).map(([messageName, transition]) => {
      if (!transition) return [messageName, transition];
      const result = fnNormalizeTransition(
        transition,
        stateName as TActorState,
        `actor.states.${stateName}.on.${messageName}`,
      );
      if (result.warning) warnings.push(result.warning);
      return [messageName, result.transition];
    }));

    return [stateName, { ...config, on }];
  })) as TResolvedVibecanvasJson['actor']['states'];

  return {
    manifest: {
      ...manifest,
      actor: {
        ...manifest.actor,
        states,
      },
    },
    warnings,
  };
}
