import type { IActorResourceService } from '@vibecanvas/service-actor';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { ResourceService } from './ResourceService';

/** Account/request-scoped compatibility facade over one placement-owned store. */
class TenantResourceService implements IActorResourceService {
  readonly #owner: ResourceService;
  readonly #tenant: TTenantContext;

  constructor(owner: ResourceService, tenant: TTenantContext) {
    this.#owner = owner;
    this.#tenant = tenant;
  }

  attachConsumer: NonNullable<IActorResourceService['attachConsumer']> = (consumer) => (
    this.#owner.attachConsumer(consumer)
  );

  getActorStartAdmission: IActorResourceService['getActorStartAdmission'] = (args) => (
    this.#owner.getActorStartAdmission(this.#tenant, args)
  );
  completeActorStart: IActorResourceService['completeActorStart'] = (args) => (
    this.#owner.completeActorStart(this.#tenant, args)
  );
  call: IActorResourceService['call'] = (call) => this.#owner.call(this.#tenant, call);
  callWithDirectResourceBinding: IActorResourceService['callWithDirectResourceBinding'] = (call, binding) => (
    this.#owner.callWithDirectResourceBinding(this.#tenant, call, binding)
  );
}

export { TenantResourceService };
