import { apiWidgetRuntimeConfig } from './api.runtime-config';
import { apiWidgetCatalogEvents } from './api.catalog-events';
import { apiWidgetCatalogGet } from './api.catalog-get';
import { apiWidgetCatalogRefresh } from './api.catalog-refresh';
import {
  apiWidgetCatalogFileRead,
  apiWidgetCatalogFilesList,
} from './api.catalog-files';
import { apiWidgetConfigSaveDraft } from './api.config-save';
import {
  apiWidgetBuildAndPublish,
  apiWidgetPublishMetadata,
} from './api.publication';
import { apiWidgetPlacementResolve } from './api.placement-resolve';
import {
  apiWidgetPreviewClose,
  apiWidgetPreviewInvoke,
  apiWidgetPreviewLoad,
  apiWidgetPreviewOpen,
  apiWidgetPreviewRebuild,
  apiWidgetPreviewRebuildDraft,
} from './api.preview';
import { apiWidgetRuntimeLoad } from './api.runtime-load-widget';
import { apiRuntimeWidgetStateChange } from './api.runtime-widget-state-change';
import { apiRuntimeWidgetStateEvents } from './api.runtime-widget-state-events';
import { apiRuntimeWidgetStateGet } from './api.runtime-widget-state-get';

const widgetHandlers = {
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
  publication: {
    publishMetadata: apiWidgetPublishMetadata,
    buildAndPublish: apiWidgetBuildAndPublish,
  },
  placement: {
    resolve: apiWidgetPlacementResolve,
  },
  preview: {
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
    state: {
      get: apiRuntimeWidgetStateGet,
      change: apiRuntimeWidgetStateChange,
      events: apiRuntimeWidgetStateEvents,
    },
  },
};

export { widgetHandlers };
