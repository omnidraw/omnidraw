import { connect, type Database as TursoDatabase } from '@tursodatabase/database';
import { AutomergeService } from '@vibecanvas/service-automerge/AutomergeService';

type TStartedAutomergeService = AutomergeService & {
  readonly testDatabase: TursoDatabase;
};

export async function createStartedAutomergeService(): Promise<TStartedAutomergeService> {
  const testDatabase = await connect(':memory:');
  const service = new AutomergeService(testDatabase, {
    onElementCreate: () => {},
    onElementDelete: () => {},
  }) as TStartedAutomergeService;

  Object.defineProperty(service, 'testDatabase', {
    value: testDatabase,
  });

  service.start();
  return service;
}

export async function stopStartedAutomergeService(service: TStartedAutomergeService | undefined): Promise<void> {
  if (!service) return;

  service.stop();
}

export type { TStartedAutomergeService };
