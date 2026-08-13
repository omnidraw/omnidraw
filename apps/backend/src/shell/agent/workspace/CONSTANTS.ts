import sdkPackage from '@omnidraw/sdk/package.json';
import { fnResolveWidgetDependency } from './fn.resolve-widget-dependency';

export const SDK_PACKAGE_DEPENDENCY = fnResolveWidgetDependency({
  dependency: '@omnidraw/sdk',
  specifier: sdkPackage.version,
  catalog: {},
});
