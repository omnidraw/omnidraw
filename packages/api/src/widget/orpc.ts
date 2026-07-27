import { implement } from '@orpc/server';
import { widgetContract } from './contract';
import type { TWidgetApiContext } from './types';

const baseWidgetOs = implement(widgetContract)
  .$context<TWidgetApiContext>();

export { baseWidgetOs };
