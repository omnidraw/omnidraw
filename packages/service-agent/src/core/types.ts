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
  getDbSchemaContext?(schemaId: string, version: number): Promise<{
    schema: { id: string; name: string; description: string | null; status: string };
    migrations: Array<{
      schema_id: string;
      version: number;
      name: string;
      sql: string;
      checksum: string;
      status: string;
    }>;
  } | null>;
};
