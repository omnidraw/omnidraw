/** Portable server-function descriptors, authoring, and guest clients. */

export * from './function-client';
export * from './server';
export type {
  IWidgetFunctionHostPort,
} from './contracts/interface';
export type {
  TWidgetBrowserFunctionDescriptor,
  TWidgetFunctionInvocation,
  TWidgetServerFunctionDescriptor,
  TWidgetServerFunctionEffect,
  TWidgetServerFunctionLimits,
  TWidgetServerFunctionResourceAccess,
} from './contracts/types';
export {
  WidgetBrowserFunctionDescriptorsValidator,
  WidgetServerFunctionDescriptorsValidator,
  ZWidgetBrowserFunctionDescriptors,
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetBrowserFunctionDescriptors,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnNormalizeWidgetBrowserFunctionDescriptors,
  fnNormalizeWidgetServerFunctionDescriptors,
  fnValidateWidgetServerFunctionDescriptors,
} from './contracts/index';
