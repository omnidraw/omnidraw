import { ACTOR_WORKFLOW_KIND } from './CONSTANTS';
import type { TActorBundleManifest, TActorDefinitionRow, TActorInboxRow, TActorTransitionPlan } from './types';

export type TArgsEffectKind = {
  readonly name: string;
};

export function fnEffectKind(args: TArgsEffectKind): TWorkflowFunctionKind {
  if (args.name.startsWith('tx.')) return 'tx';
  if (args.name.startsWith('fx.')) return 'fx';
  return 'fn';
}

export type TArgsActorPortalSpec = {
  readonly definition: TActorDefinitionRow;
};

export function fnActorPortalSpec(args: TArgsActorPortalSpec): TWorkflowJson {
  const manifest = (args.definition.server_manifest ?? {}) as TActorBundleManifest;
  const entrypoint = manifest.entrypoint ?? manifest.modulePath ?? args.definition.functions_path;
  return {
    modulePath: manifest.modulePath ?? manifest.functionsPath ?? args.definition.functions_path,
    entrypoint,
    files: manifest.files ?? [],
  };
}

export type TArgsActorWorkflowRunId = {
  readonly inbox: TActorInboxRow;
};

export function fnActorWorkflowRunId(args: TArgsActorWorkflowRunId): string {
  return `actor:${args.inbox.actor_instance_id}:inbox:${args.inbox.message_id}`;
}

export type TArgsCreateActorWorkflowDefinition = {
  readonly inbox: TActorInboxRow;
  readonly definition: TActorDefinitionRow;
  readonly plan: TActorTransitionPlan;
};

export function fnCreateActorWorkflowDefinition(args: TArgsCreateActorWorkflowDefinition): TWorkflowDefinition {
  return {
    workflowKind: ACTOR_WORKFLOW_KIND,
    steps: args.plan.effects.map((effect, index) => {
      const functionKind = fnEffectKind({ name: effect });
      return {
        stepKey: `effect-${index}-${effect}`,
        stepIndex: index,
        phase: 'actor-effect',
        functionKind,
        functionName: effect,
        idempotencyKey: `actor:${args.inbox.actor_instance_id}:message:${args.inbox.message_id}:effect:${index}:${effect}`,
        portalSpec: fnActorPortalSpec({ definition: args.definition }),
        args: {
          state: args.plan.effectArgs.state,
          context: args.plan.effectArgs.context,
          message: args.plan.effectArgs.message,
        },
      };
    }),
  };
}
