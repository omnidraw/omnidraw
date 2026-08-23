import { ZWidgetCapsuleHostConfiguration } from './contract';
import { baseWidgetOs } from './procedure-builder';

const apiWidgetRuntimeConfig = baseWidgetOs.runtime.config.handler(
  async ({ context }) => ZWidgetCapsuleHostConfiguration.parse(
    await context.widgetCapsuleHostConfiguration.read(),
  ),
);

export { apiWidgetRuntimeConfig };
