import { Effect } from "effect";
import type { TFrontendTransportFailure } from "../app/service.frontend-transport";
import { fnApplyTerminal, fnRestoreTerminal } from "./fn.db-resource";
import { fxApply, fxRestore } from "./fx.db-resource";
import { DbResources } from "./service.db-resources";
import type { TDbApplyDetails } from "./types";

export const DB_OPERATION_POLL_INTERVAL_MS = 900;

export type TArgsPollDbOperation = Readonly<{
  kind: "apply" | "restore";
  operationId: string;
}>;

/** Polls one coordinated database operation on the Effect Clock until terminal. */
export function fxPollDbOperation(
  args: TArgsPollDbOperation,
): Effect.Effect<TDbApplyDetails, TFrontendTransportFailure, DbResources> {
  const poll: Effect.Effect<TDbApplyDetails, TFrontendTransportFailure, DbResources> = Effect.suspend(() => {
    const read = args.kind === "apply"
      ? fxApply({ applyId: args.operationId })
      : fxRestore({ restoreId: args.operationId });
    return read.pipe(
      Effect.flatMap((run) => {
        const terminal = args.kind === "apply"
          ? fnApplyTerminal(run.apply.status)
          : fnRestoreTerminal(run.apply.status);
        return terminal
          ? Effect.succeed(run)
          : Effect.sleep(DB_OPERATION_POLL_INTERVAL_MS).pipe(Effect.andThen(poll));
      }),
    );
  });
  return poll;
}
