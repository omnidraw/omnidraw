import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';
import type { TValidationResult } from '../types';
import { AJV } from '../../tools/CONSTANTS';

export function fnLintManifestJsonSchemas(manifest: TVibecanvasJson): TValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const compileJsonSchema = (label: string, schema: unknown) => {
    try {
      return AJV.compile(schema as object | boolean);
    } catch (error) {
      errors.push(`${label} is not a valid JSON Schema: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  if (manifest.actor.dataSchema !== undefined) {
    const validate = compileJsonSchema('actor.dataSchema', manifest.actor.dataSchema);
    if (validate && !validate(manifest.actor.initialData)) {
      errors.push(`actor.initialData does not match actor.dataSchema: ${AJV.errorsText(validate.errors)}`);
    }
  }

  Object.entries(manifest.actor.inputMsgSchema ?? {}).forEach(([name, schema]) => compileJsonSchema(`actor.inputMsgSchema.${name}`, schema));
  Object.entries(manifest.actor.outputMsgSchema ?? {}).forEach(([name, schema]) => compileJsonSchema(`actor.outputMsgSchema.${name}`, schema));

  return { ok: errors.length === 0, errors, warnings };
}
