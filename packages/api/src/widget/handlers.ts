import { apiWidgetRuntimeConfig } from './api.runtime-config';
import { apiWidgetRuntimeLoad } from './api.runtime-load-widget';

const widgetHandlers = {
  runtime: {
    config: apiWidgetRuntimeConfig,
    load: apiWidgetRuntimeLoad,
  },
};

export { widgetHandlers };
