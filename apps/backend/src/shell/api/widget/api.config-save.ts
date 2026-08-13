import { baseWidgetOs } from './procedure-builder';
import { throwWidgetFilesystemApiError } from './api.filesystem-error';

const apiWidgetConfigSaveDraft = baseWidgetOs.config.saveDraft.handler(async ({
  context,
  input,
  signal,
}) => {
  try {
    const result = await context.widgetCatalog.saveDraftConfig({ ...input, signal });
    return Object.freeze({
      widgetKey: result.widgetKey,
      generation: result.generation,
      catalogDigestSha256: result.catalogDigestSha256,
    });
  } catch (error) {
    throwWidgetFilesystemApiError(error);
  }
});

export { apiWidgetConfigSaveDraft };
