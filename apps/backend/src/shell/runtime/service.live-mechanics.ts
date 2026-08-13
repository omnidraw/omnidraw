import { Context } from 'effect';
import type { ICanvasService } from '../canvas/authority';
import type { DbServiceTurso } from '../database/DbServiceTurso/DbServiceTurso';
import type { IEventPublisherService } from '../events/types';
import type { TApiContext } from '../api/context';
import type { ICliConfig } from '../cli/config';
import type { WidgetBuildGenerationService } from '../widget/WidgetBuildGenerationService';

/**
 * Live mechanics are deliberately exposed as narrow semantic capabilities.
 * No consumer receives a service locator or an application-sized object.
 */
export class BackendConfig extends Context.Service<BackendConfig, ICliConfig>()(
  'omnidraw/backend/BackendConfig',
) {}

export class LiveAgent extends Context.Service<LiveAgent, TApiContext['agent']>()(
  'omnidraw/backend/LiveAgent',
) {}

export class LiveCanvas extends Context.Service<LiveCanvas, ICanvasService>()(
  'omnidraw/backend/LiveCanvas',
) {}

export class LiveDatabase extends Context.Service<LiveDatabase, DbServiceTurso>()(
  'omnidraw/backend/LiveDatabase',
) {}

export class LiveEventPublisher extends Context.Service<
  LiveEventPublisher,
  IEventPublisherService
>()('omnidraw/backend/LiveEventPublisher') {}

export class LiveFunctionInvocation extends Context.Service<
  LiveFunctionInvocation,
  TApiContext['functionInvocation']
>()('omnidraw/backend/LiveFunctionInvocation') {}

export class LiveHumanResourceSecret extends Context.Service<
  LiveHumanResourceSecret,
  TApiContext['humanResourceSecret']
>()('omnidraw/backend/LiveHumanResourceSecret') {}

export class LiveResource extends Context.Service<LiveResource, TApiContext['resource']>()(
  'omnidraw/backend/LiveResource',
) {}

export class LiveWidgetCatalog extends Context.Service<
  LiveWidgetCatalog,
  TApiContext['widgetCatalog']
>()('omnidraw/backend/LiveWidgetCatalog') {}

export class LiveWidgetPreview extends Context.Service<
  LiveWidgetPreview,
  TApiContext['widgetPreview']
>()('omnidraw/backend/LiveWidgetPreview') {}

export class LiveWidgetHostConfiguration extends Context.Service<
  LiveWidgetHostConfiguration,
  TApiContext['widgetCapsuleHostConfiguration']
>()('omnidraw/backend/LiveWidgetHostConfiguration') {}

export class LiveWidgetLoadAdmission extends Context.Service<
  LiveWidgetLoadAdmission,
  TApiContext['widgetRuntimeLoadAdmission']
>()('omnidraw/backend/LiveWidgetLoadAdmission') {}

export class LiveWidgetState extends Context.Service<
  LiveWidgetState,
  TApiContext['widgetState']
>()('omnidraw/backend/LiveWidgetState') {}

export class LiveWidgetBuildGeneration extends Context.Service<
  LiveWidgetBuildGeneration,
  WidgetBuildGenerationService
>()('omnidraw/backend/LiveWidgetBuildGeneration') {}
