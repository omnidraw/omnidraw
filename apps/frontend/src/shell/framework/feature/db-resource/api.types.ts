import type { TFrontendTransportFailure } from "@/core/app/service.frontend-transport";

/** Promise result belongs at the Solid/browser edge, not in core programs. */
export type TApiResult<T> = readonly [TFrontendTransportFailure | null, T | undefined];
