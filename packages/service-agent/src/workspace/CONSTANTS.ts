import rootPackage from '../../../../package.json';
import sdkPackage from '../../../sdk/package.json';
import { fnResolveWidgetDependency } from './fn.resolve-widget-dependency';

export const SDK_CAPSULE_DEPENDENCY = fnResolveWidgetDependency({
  dependency: '@omnidraw/capsule',
  specifier: sdkPackage.dependencies['@omnidraw/capsule'],
  catalog: rootPackage.catalog,
});
export const SDK_PACKAGE_DEPENDENCY = fnResolveWidgetDependency({
  dependency: '@omnidraw/sdk',
  specifier: sdkPackage.version,
  catalog: rootPackage.catalog,
});
