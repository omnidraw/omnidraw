import type { TWidgetManifestV1 } from '@omnidraw/widget-contract';
import type { TValidationResult } from '../types';
import { fnLintManifestShape } from './fn.manifest-shape';

export function fnValidateManifest(manifest: TWidgetManifestV1): TValidationResult {
  return fnLintManifestShape(manifest);
}
