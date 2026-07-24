import { ZWidgetCapsuleHostConfiguration } from './contract';
import { baseWidgetOs } from './orpc';

const apiWidgetRuntimeConfig = baseWidgetOs.runtime.config.handler(
  async ({ context }) => ZWidgetCapsuleHostConfiguration.parse(
    await context.widgetCapsuleHostConfiguration.read(),
  ),
);

export { apiWidgetRuntimeConfig };
