import type {
  TCanvasRuntimeRetirement,
  TCanvasRuntimeRetirementPort,
} from '@omnidraw/canvas';

type TRuntimeRetirementRegistration = Readonly<{
  retire: TCanvasRuntimeRetirement;
}>;

export type TFrontendCanvasRuntimeRetirementCoordinator = Readonly<{
  registration: TCanvasRuntimeRetirementPort;
  retireAll(): Promise<void>;
}>;

export function createFrontendCanvasRuntimeRetirementCoordinator():
  TFrontendCanvasRuntimeRetirementCoordinator {
  const registrations = new Set<TRuntimeRetirementRegistration>();
  let retirementTail = Promise.resolve();
  const registration = Object.freeze({
    register(retire: TCanvasRuntimeRetirement): () => void {
      const entry = Object.freeze({ retire });
      registrations.add(entry);
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        registrations.delete(entry);
      };
    },
  }) satisfies TCanvasRuntimeRetirementPort;

  const retireAll = (): Promise<void> => {
    const retiring = retirementTail
      .catch(() => undefined)
      .then(async () => {
        const attempted = new Set<TRuntimeRetirementRegistration>();
        let failed = false;
        let failure: unknown;
        while (true) {
          const snapshot = [...registrations].filter(
            (entry) => !attempted.has(entry),
          );
          if (snapshot.length === 0) break;
          snapshot.forEach((entry) => attempted.add(entry));
          const results = await Promise.allSettled(
            snapshot.map(({ retire }) => retire()),
          );
          results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
              registrations.delete(snapshot[index]!);
            } else if (!failed) {
              failed = true;
              failure = result.reason;
            }
          });
        }
        if (failed) throw failure;
      });
    retirementTail = retiring;
    return retiring;
  };

  return Object.freeze({ registration, retireAll });
}

export const frontendCanvasRuntimeRetirementCoordinator =
  createFrontendCanvasRuntimeRetirementCoordinator();
