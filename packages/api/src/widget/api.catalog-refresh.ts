import { baseWidgetOs } from './orpc';
import { throwWidgetFilesystemApiError } from './api.filesystem-error';
import { fnProjectWidgetPublicCatalog } from './fn.catalog-public';

const apiWidgetCatalogRefresh = baseWidgetOs.catalog.refresh.handler(async ({ context }) => {
  try {
    return fnProjectWidgetPublicCatalog(await context.widgetCatalog.refresh());
  } catch (error) {
    throwWidgetFilesystemApiError(error);
  }
});

export { apiWidgetCatalogRefresh };
