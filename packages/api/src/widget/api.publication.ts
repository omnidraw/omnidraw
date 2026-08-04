import { baseWidgetOs } from './orpc';
import { throwWidgetFilesystemApiError } from './api.filesystem-error';

const apiWidgetPublishMetadata = baseWidgetOs.publication.publishMetadata.handler(async ({
  context,
  input,
  signal,
}) => {
  try {
    const result = await context.widgetCatalog.publishMetadata({ ...input, signal });
    return Object.freeze({
      widgetKey: result.widgetKey,
      generation: result.generation,
      catalogDigestSha256: result.catalogDigestSha256,
    });
  } catch (error) {
    throwWidgetFilesystemApiError(error);
  }
});

const apiWidgetBuildAndPublish = baseWidgetOs.publication.buildAndPublish.handler(async ({
  context,
  input,
  signal,
}) => {
  try {
    const result = await context.widgetCatalog.buildAndPublish({ ...input, signal });
    return Object.freeze({
      widgetKey: result.widgetKey,
      generation: result.generation,
      catalogDigestSha256: result.catalogDigestSha256,
    });
  } catch (error) {
    throwWidgetFilesystemApiError(error);
  }
});

export { apiWidgetBuildAndPublish, apiWidgetPublishMetadata };
