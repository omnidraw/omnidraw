import type { TVibecanvasJson } from '@vibecanvas/service-actor/core/types';

export type TValidationResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export type TActorServiceReloader = {
  reload(): Promise<void>;
  getVibecanvasJson?(defId: string): (TVibecanvasJson & { manifest_path: string }) | null;
  reloadDefinitionInstances?(definitionName: string): Promise<void>;
};
