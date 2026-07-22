import type { TWidgetManifestV2 } from '@vibecanvas/widget-contract';
import type { TValidationResult } from '../types';
import { fnLintManifestShape } from './fn.manifest-shape';

export function fnValidateManifest(manifest: TWidgetManifestV2): TValidationResult {
  return fnLintManifestShape(manifest);
}
