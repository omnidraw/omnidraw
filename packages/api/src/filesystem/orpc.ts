import { implement } from '@orpc/server';
import { filesystemContract } from './contract';
import type { TFilesystemApiContext } from './types';

const baseFilesystemOs = implement(filesystemContract)
  .$context<TFilesystemApiContext>();

export { baseFilesystemOs };
