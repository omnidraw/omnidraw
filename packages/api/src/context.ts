import type { TActorsApiContext } from './actor/types';
import type { TAgentApiContext } from './agent/types';
import type { TCanvasApiContext } from './canvas/types';
import type { TDbApiContext } from './db/types';
import type { TFileApiContext } from './file/types';
import type { TFilesystemApiContext } from './filesystem/types';
import type { TFunctionApiContext } from './function/types';
import type { TNotificationApiContext } from './notification/types';
import type { TPtyApiContext } from './pty/types';
import type { TResourceApiContext } from './resource/types';
import type { TToolApiContext } from './tool/types';
import type { TWidgetApiContext } from './widget/types';

type TApiContext = TActorsApiContext
  & TAgentApiContext
  & TCanvasApiContext
  & TDbApiContext
  & TFileApiContext
  & TFilesystemApiContext
  & TFunctionApiContext
  & TNotificationApiContext
  & TPtyApiContext
  & TResourceApiContext
  & TToolApiContext
  & TWidgetApiContext;

export type {
  TActorsApiContext,
  TAgentApiContext,
  TApiContext,
  TCanvasApiContext,
  TDbApiContext,
  TFileApiContext,
  TFilesystemApiContext,
  TFunctionApiContext,
  TNotificationApiContext,
  TPtyApiContext,
  TResourceApiContext,
  TToolApiContext,
  TWidgetApiContext,
};
