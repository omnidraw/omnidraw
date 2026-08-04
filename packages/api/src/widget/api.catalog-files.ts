import { baseWidgetOs } from './orpc';
import { throwWidgetFilesystemApiError } from './api.filesystem-error';

const apiWidgetCatalogFilesList = baseWidgetOs.catalog.files.list.handler(({
  context,
  input,
}) => {
  try {
    const files = context.widgetCatalog.listFiles(input);
    return Object.freeze({
      entries: Object.freeze(files.slice(0, 12_000)),
      truncated: files.length > 12_000,
    });
  } catch (error) {
    throwWidgetFilesystemApiError(error);
  }
});

const apiWidgetCatalogFileRead = baseWidgetOs.catalog.files.read.handler(async ({
  context,
  input,
}) => {
  try {
    return await context.widgetCatalog.readFile({ ...input, maximumBytes: 256 * 1_024 });
  } catch (error) {
    throwWidgetFilesystemApiError(error);
  }
});

export { apiWidgetCatalogFileRead, apiWidgetCatalogFilesList };
