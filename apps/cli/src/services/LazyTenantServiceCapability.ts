/**
 * Builds a method-only capability whose tenant service is resolved on first use.
 *
 * API handlers are asynchronous boundaries, so every forwarded method returns a
 * promise even when the underlying legacy method is synchronous.
 */
function createLazyTenantServiceCapability<TService extends object>(
  resolve: () => Promise<TService>,
): TService {
  let service: Promise<TService> | null = null;

  return new Proxy(Object.create(null) as TService, {
    get(_target, property) {
      if (property === 'then') return undefined;
      return (...args: unknown[]) => {
        service ??= resolve();
        return service.then((instance) => {
          const operation = Reflect.get(instance, property);
          if (typeof operation !== 'function') {
            throw new TypeError(`Tenant capability member '${String(property)}' is not callable.`);
          }
          return Reflect.apply(operation, instance, args);
        });
      };
    },
  });
}

export { createLazyTenantServiceCapability };
