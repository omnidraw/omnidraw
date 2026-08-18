import { apiWidgetRuntimeConfig } from './api.runtime-config';
import {
  apiWidgetAuthoringInspect,
  apiWidgetAuthoringResolve,
  apiWidgetAuthoringValidate,
} from './api.authoring';
import { apiWidgetCatalogEvents } from './api.catalog-events';
import { apiWidgetCatalogGet } from './api.catalog-get';
import { apiWidgetCatalogRefresh } from './api.catalog-refresh';
import {
  apiWidgetCatalogFileRead,
  apiWidgetCatalogFilesList,
} from './api.catalog-files';
import { apiWidgetConfigSaveDraft } from './api.config-save';
import {
  apiWidgetDeletionCommit,
  apiWidgetDeletionPlan,
} from './api.deletion';
import {
  apiWidgetBuildAndPublish,
  apiWidgetPublishMetadata,
  apiWidgetUpdatePublishedIcon,
} from './api.publication';
import { apiWidgetPlacementResolve } from './api.placement-resolve';
import {
  apiWidgetPreviewBuildState,
  apiWidgetPreviewClose,
  apiWidgetPreviewInvoke,
  apiWidgetPreviewLoad,
  apiWidgetPreviewOpen,
  apiWidgetPreviewRebuild,
  apiWidgetPreviewRebuildDraft,
} from './api.preview';
import { apiWidgetRuntimeLoad } from './api.runtime-load-widget';

const widgetHandlers = {
  authoring: {
    resolve: apiWidgetAuthoringResolve,
    validate: apiWidgetAuthoringValidate,
    inspect: apiWidgetAuthoringInspect,
  },
  catalog: {
    get: apiWidgetCatalogGet,
    refresh: apiWidgetCatalogRefresh,
    files: {
      list: apiWidgetCatalogFilesList,
      read: apiWidgetCatalogFileRead,
    },
    events: apiWidgetCatalogEvents,
  },
  config: {
    saveDraft: apiWidgetConfigSaveDraft,
  },
  deletion: {
    plan: apiWidgetDeletionPlan,
    commit: apiWidgetDeletionCommit,
  },
  publication: {
    publishMetadata: apiWidgetPublishMetadata,
    updateIcon: apiWidgetUpdatePublishedIcon,
    buildAndPublish: apiWidgetBuildAndPublish,
  },
  placement: {
    resolve: apiWidgetPlacementResolve,
  },
  preview: {
    buildState: apiWidgetPreviewBuildState,
    open: apiWidgetPreviewOpen,
    rebuild: apiWidgetPreviewRebuild,
    rebuildDraft: apiWidgetPreviewRebuildDraft,
    load: apiWidgetPreviewLoad,
    close: apiWidgetPreviewClose,
    invoke: apiWidgetPreviewInvoke,
  },
  runtime: {
    config: apiWidgetRuntimeConfig,
    load: apiWidgetRuntimeLoad,
  },
};

export { widgetHandlers };
