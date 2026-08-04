import type { TWidgetManifestV4 } from '@omnidraw/widget-contract';
import type { TValidationResult } from '../types';
import { fnLintManifestShape } from './fn.manifest-shape';

export function fnValidateManifest(manifest: TWidgetManifestV4): TValidationResult {
  return fnLintManifestShape(manifest);
}
