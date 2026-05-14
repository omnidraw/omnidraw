import { z } from 'zod';

const JsonSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(JsonSchema), z.record(z.string(), JsonSchema),
]));

export const WorkerPortalSpecSchema = z.object({
  modulePath: z.string(),
  exportName: z.string().optional(),
  tableExportName: z.string().optional(),
});

export const StepRunnerRequestSchema = z.object({
  functionKind: z.enum(['fn', 'fx', 'tx']),
  functionName: z.string(),
  idempotencyKey: z.string().optional(),
  portalSpec: WorkerPortalSpecSchema,
  args: JsonSchema,
  previousResults: z.array(JsonSchema).optional(),
  workflowRunId: z.string(),
  workflowStepId: z.string(),
});

export const StepRunnerResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: JsonSchema }),
  z.object({ ok: z.literal(false), error: z.string(), stack: z.string().optional() }),
]);

export type TStepRunnerRequest = z.infer<typeof StepRunnerRequestSchema>;
export type TStepRunnerResponse = z.infer<typeof StepRunnerResponseSchema>;
