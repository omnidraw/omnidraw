# @vibecanvas/service-actor

Optional legacy actor compatibility runtime. This package is not part of the normal v2 widget execution, publication, or resource-management path.

## Ownership boundary

`ActorService` owns only legacy actor definitions, instances, message delivery, process supervision, and compatibility diagnostics. It must not construct, open, reconcile, close, publish, or expose management APIs for resources.

The host must inject `IActorResourceService`. That narrow bridge supports only:

- actor-start admission and completion
- guest actor resource calls
- direct resource bindings for legacy draft preview
- optional consumer attachment for resolving legacy manifest requirements

Neutral resource ownership lives in `@vibecanvas/resource-runtime` and the host Resource Service. ActorService may implement `IResourceUseCoordinator`-style inspection, drain, and release operations so the neutral owner can stop and resume affected legacy actors during database migration. This coordination does not transfer resource ownership to the actor runtime.

Never add resource catalog CRUD, bindings management, KV/secret data management, database draft/apply/restore methods, provider implementations, owner fences, or storage-root configuration back to this package.

## Legacy resource protocol

`src/legacy/resource-protocol.ts` is the only actor-resource module. It contains the minimal serializable guest-to-host call, direct-binding, gateway, and actor-start admission types required by the compatibility runtime.

Do not add providers, persistence contracts, database-management DTOs, or resource implementations there. Use neutral public types and `ResourceError`/`toSafeResourceError` from `@vibecanvas/resource-runtime`.

## Runtime roles

- `Actor` owns one running legacy actor instance and its serialized startup, input, timeout, activity, lifecycle, and error-recovery lane.
- `ActorSupervisor` discovers legacy manifests, restores persisted instances, coordinates inbox delivery/connections, persists snapshots, and supervises child processes.
- `ActorService` is the explicit LegacyActorPlugin facade for instance lifecycle, messaging, definition reads/deletion, resource-use coordination, and diagnostics.
- `icp-client.ts` runs guest actor functions in a child Bun process. Host orchestration must never import or execute guest functions directly.

Guest function classes remain compatibility behavior:

- `fn.*` receives no resource portal.
- `fx.*` receives permitted read-capable resource proxies.
- `tx.*` receives permitted read/write resource proxies.

The host derives actor, definition, run, function-class, binding, lifecycle, and permission authority. The child supplies only a slot, expected kind, operation, and serializable arguments. Never expose database handles, provider handles, physical paths, placement details, or effective authority to the guest.

## Public compatibility surface

The package export map is intentionally explicit. Preserve an existing entry only while repository-wide import search proves it is required:

- package root for `ActorService` and legacy manifest helpers/types
- `./Actor`
- `./icp-client`
- `./core/fn.normalize-actor-manifest`
- `./core/types`
- `./core/vibecanvasjson.zod`
- `./legacy/resource-protocol`

Do not restore a broad `./*` export. New v2 code must depend on widget, function, resource, runtime, and event public contracts instead of this package.

## Testing

- `tests/Actor.test.ts` covers the single-process legacy actor runtime.
- `tests/Actor.resource-ipc.test.ts` covers the injected neutral resource gateway protocol and safe error serialization.
- `tests/ActorSupervisor.test.ts` covers legacy definition/instance supervision.
- `tests/ActorService.composition.test.ts` guards the managed-service ownership and export boundary.
- `tests/ActorService.resource-data.test.ts` and `tests/ActorService.resource-apply.test.ts` exercise the neutral Resource Service fixture with legacy actors only as resource consumers.

Provider, persistence, resource-manager, and database-provider behavior belongs in `packages/resource-runtime/tests`, not here.

When editing `fn.*.ts`, `fx.*.ts`, or `tx.*.ts`, follow the root functional-core and file-type rules exactly.
