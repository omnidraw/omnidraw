import { Effect } from 'effect';
import {
  WidgetAuthority,
  type TWidgetPublicationRequest,
  type TWidgetPublicationResult,
  type WidgetProgramError,
} from './service.widgets';

export function txPublishWidget(
  args: TWidgetPublicationRequest,
): Effect.Effect<TWidgetPublicationResult, WidgetProgramError, WidgetAuthority> {
  return Effect.gen(function*() {
    const authority = yield* WidgetAuthority;
    return yield* authority.publish(args);
  });
}
