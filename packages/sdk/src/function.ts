/** Portable server-function descriptors, authoring, and guest clients. */

export * from './function-client';
export * from './server';
export type {
  IWidgetFunctionHostPort,
} from './contracts/interface';
export type {
  TWidgetFunctionInvocation,
  TWidgetServerFunctionDescriptor,
  TWidgetServerFunctionEffect,
  TWidgetServerFunctionLimits,
  TWidgetServerFunctionResourceAccess,
} from './contracts/types';
export {
  WidgetServerFunctionDescriptorsValidator,
  ZWidgetServerFunctionDescriptors,
  fnCanonicalizeWidgetServerFunctionDescriptors,
  fnNormalizeWidgetServerFunctionDescriptors,
  fnValidateWidgetServerFunctionDescriptors,
} from './contracts/index';
