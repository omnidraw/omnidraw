import { Context, Effect } from "effect";
import type { TFrontendTransportFailure } from "../app/service.frontend-transport";
import type {
  TPrivateRequestInput,
  TPrivateRequestOutput,
  TPrivateRequestPath,
} from "../app/private-operation-contract";

export type TDbResourceRequestPath = Extract<TPrivateRequestPath, `resource.${string}`>;

export class DbResources extends Context.Service<DbResources, {
  read<Path extends TDbResourceRequestPath>(path: Path, input: TPrivateRequestInput<Path>): Effect.Effect<TPrivateRequestOutput<Path>, TFrontendTransportFailure>;
  write<Path extends TDbResourceRequestPath>(path: Path, input: TPrivateRequestInput<Path>): Effect.Effect<TPrivateRequestOutput<Path>, TFrontendTransportFailure>;
}>()("omnidraw/frontend/core/resources/DbResources") {}

export const dbResourceRead = <Path extends TDbResourceRequestPath>(
  path: Path,
  input: TPrivateRequestInput<Path>,
): Effect.Effect<TPrivateRequestOutput<Path>, TFrontendTransportFailure, DbResources> =>
  DbResources.use((resources) => resources.read(path, input));

export const dbResourceWrite = <Path extends TDbResourceRequestPath>(
  path: Path,
  input: TPrivateRequestInput<Path>,
): Effect.Effect<TPrivateRequestOutput<Path>, TFrontendTransportFailure, DbResources> =>
  DbResources.use((resources) => resources.write(path, input));
