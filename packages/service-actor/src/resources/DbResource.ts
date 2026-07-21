/**
 * @file Legacy actor adapter for the neutral local DbResource provider.
 */

import { Database } from '@vibecanvas/service-db/DbServiceTurso/turso-native';
import {
  DbResource as LocalDbResource,
  type TDatabaseFactory,
  type TDbResourceConfig as TLocalDbResourceConfig,
} from '@vibecanvas/resource-runtime/local';

export type TDbResourceConfig = Omit<TLocalDbResourceConfig, 'databaseFactory'> & Readonly<{
  databaseFactory?: TDatabaseFactory;
}>;

export class DbResource extends LocalDbResource {
  constructor(config: TDbResourceConfig) {
    super({
      ...config,
      databaseFactory: config.databaseFactory
        ?? ((databasePath, options) => new Database(databasePath, options)),
    });
  }
}

export type { TDatabaseFactory } from '@vibecanvas/resource-runtime/local';
