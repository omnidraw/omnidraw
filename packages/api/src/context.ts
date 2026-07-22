import type { TAgentApiContext } from './agent/types';
import type { TCanvasApiContext } from './canvas/types';
import type { TDbApiContext } from './db/types';
import type { TFileApiContext } from './file/types';
import type { TFunctionApiContext } from './function/types';
import type { TNotificationApiContext } from './notification/types';
import type { TResourceApiContext } from './resource/types';
import type { TToolApiContext } from './tool/types';
import type { TWidgetApiContext } from './widget/types';

type TApiContext = TAgentApiContext
  & TCanvasApiContext
  & TDbApiContext
  & TFileApiContext
  & TFunctionApiContext
  & TNotificationApiContext
  & TResourceApiContext
  & TToolApiContext
  & TWidgetApiContext;

export type {
  TAgentApiContext,
  TApiContext,
  TCanvasApiContext,
  TDbApiContext,
  TFileApiContext,
  TFunctionApiContext,
  TNotificationApiContext,
  TResourceApiContext,
  TToolApiContext,
  TWidgetApiContext,
};
