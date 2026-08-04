import { baseWidgetOs } from './orpc';
import { fnProjectWidgetPublicCatalog } from './fn.catalog-public';

const apiWidgetCatalogGet = baseWidgetOs.catalog.get.handler(({ context }) => (
  fnProjectWidgetPublicCatalog(context.widgetCatalog.current())
));

export { apiWidgetCatalogGet };
