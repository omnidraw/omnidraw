import type { IService, IStoppableService } from '@vibecanvas/runtime';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type {
  TPty,
  TPtyAttachArgs,
  TPtyAttachment,
  TPtyCreateArgs,
  TPtyPathArgs,
  TPtyScopeArgs,
  TPtyUpdateArgs,
} from './types';

export interface IPtyService extends IService, IStoppableService {
  list(tenant: TTenantContext, args: TPtyScopeArgs): TPty[];
  get(tenant: TTenantContext, args: TPtyPathArgs): TPty | null;
  create(tenant: TTenantContext, args: TPtyCreateArgs): Promise<TPty>;
  update(tenant: TTenantContext, args: TPtyUpdateArgs): TPty | null;
  remove(tenant: TTenantContext, args: TPtyPathArgs): Promise<boolean>;
  attach(tenant: TTenantContext, args: TPtyAttachArgs): TPtyAttachment | null;
}
