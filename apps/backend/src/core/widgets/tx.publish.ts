import { Effect } from 'effect';
import {
  WidgetAuthority,
  type TWidgetPublicationRequest,
  type TWidgetPublicationResult,
  type WidgetProgramError,
} from './service.widgets';

export const txPublishWidget = Effect.fn('txPublishWidget')(function*(
  args: TWidgetPublicationRequest,
): Effect.fn.Return<TWidgetPublicationResult, WidgetProgramError, WidgetAuthority> {
  const authority = yield* WidgetAuthority;
  return yield* authority.publish(args);
});
