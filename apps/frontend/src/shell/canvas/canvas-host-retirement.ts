import type {
  TCanvasHostRetirement,
  TCanvasHostRetirementPort,
} from '@omnidraw/canvas';
import { Effect, Semaphore } from 'effect';

type THostRetirementRegistration = Readonly<{
  retire: TCanvasHostRetirement;
}>;

export type TFrontendCanvasHostRetirementCoordinator = Readonly<{
  registration: TCanvasHostRetirementPort;
  retireAll(): Promise<void>;
}>;

export function createFrontendCanvasHostRetirementCoordinator(
  runPromise: <A, E>(program: Effect.Effect<A, E>) => Promise<A>,
):
  TFrontendCanvasHostRetirementCoordinator {
  const registrations = new Set<THostRetirementRegistration>();
  const retirementSemaphore = Semaphore.makeUnsafe(1);
  const registration = Object.freeze({
    register(retire: TCanvasHostRetirement): () => void {
      const entry = Object.freeze({ retire });
      registrations.add(entry);
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        registrations.delete(entry);
      };
    },
  }) satisfies TCanvasHostRetirementPort;

  const retireAllProgram = (): Effect.Effect<void, unknown> => Effect.suspend(() => {
        const attempted = new Set<THostRetirementRegistration>();
        let firstFailure: unknown | null = null;
        const drain = (): Effect.Effect<void, unknown> => Effect.suspend(() => {
          const snapshot = [...registrations].filter(
            (entry) => !attempted.has(entry),
          );
          if (snapshot.length === 0) {
            return firstFailure === null ? Effect.void : Effect.fail(firstFailure);
          }
          snapshot.forEach((entry) => attempted.add(entry));
          return Effect.all(snapshot.map(({ retire }, index) => Effect.tryPromise({
            try: retire,
            catch: (cause) => cause,
          }).pipe(
            Effect.as({ ok: true as const, index }),
            Effect.catch((failure) => Effect.succeed({ ok: false as const, index, failure })),
          )), { concurrency: 'unbounded' }).pipe(
            Effect.flatMap((results) => {
              for (const result of results) {
                if (result.ok) registrations.delete(snapshot[result.index]!);
                else if (firstFailure === null) {
                  firstFailure = result.failure;
                }
              }
              return drain();
            }),
          );
        });
        return drain();
      });

  const retireAll = (): Promise<void> => runPromise(
    retirementSemaphore.withPermits(1)(retireAllProgram()),
  );

  return Object.freeze({ registration, retireAll });
}
