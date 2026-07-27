import { apiWidgetRuntimeConfig } from './api.runtime-config';
import { apiWidgetRuntimeLoad } from './api.runtime-load-widget';
import { apiRuntimeWidgetStateChange } from './api.runtime-widget-state-change';
import { apiRuntimeWidgetStateEvents } from './api.runtime-widget-state-events';
import { apiRuntimeWidgetStateGet } from './api.runtime-widget-state-get';

const widgetHandlers = {
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
