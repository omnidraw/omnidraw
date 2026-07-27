import type { TWidgetManifestV3 } from '@vibecanvas/widget-contract';
import type { TValidationResult } from '../types';
import { fnLintManifestShape } from './fn.manifest-shape';

export function fnValidateManifest(manifest: TWidgetManifestV3): TValidationResult {
  return fnLintManifestShape(manifest);
}
