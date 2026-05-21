import { and, desc, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { TDrizzleDb } from './DbServiceBunSqlite/index';
import { sandbox_instances, sandbox_volumes } from './schema';
import type { TSandboxInstance, TSandboxInstanceStatus, TSandboxVolume, TSandboxVolumeStatus } from './model';

export type TFindSandboxInstanceArgs = {
  readonly namespace: string;
  readonly sandboxName: string;
  readonly sandboxTag: string;
  readonly image: string;
  readonly setupHash: string;
};

export type TUpsertSandboxInstanceArgs = {
  readonly namespace: string;
  readonly sandboxName: string;
  readonly sandboxTag: string;
  readonly image: string;
  readonly setupHash: string;
  readonly status: TSandboxInstanceStatus;
  readonly metadata: unknown;
  readonly lastError: string | null;
};

export type TFindReusableSandboxVolumeArgs = {
  readonly instanceId: string;
  readonly namespace: string;
  readonly volumeTag: string;
  readonly setupHash: string;
};

export type TUpsertSandboxVolumeArgs = {
  readonly instanceId: string;
  readonly namespace: string;
  readonly volumeName: string;
  readonly volumeTag: string;
  readonly setupHash: string;
  readonly status: TSandboxVolumeStatus;
  readonly reusable: boolean;
  readonly metadata: unknown;
  readonly lastError: string | null;
};

export interface ISandboxDb {
  findInstance(args: TFindSandboxInstanceArgs): TSandboxInstance | null;
  upsertInstance(args: TUpsertSandboxInstanceArgs): TSandboxInstance;
  findReusableVolumes(args: TFindReusableSandboxVolumeArgs): TSandboxVolume[];
  upsertVolume(args: TUpsertSandboxVolumeArgs): TSandboxVolume;
  updateInstanceStatus(args: { id: string; status: TSandboxInstanceStatus; lastError: string | null }): void;
}

export class SandboxDb implements ISandboxDb {
  constructor(private readonly db: TDrizzleDb) {}

  findInstance(args: TFindSandboxInstanceArgs): TSandboxInstance | null {
    return this.db.query.sandbox_instances.findFirst({
      where: and(
        eq(sandbox_instances.namespace, args.namespace),
        eq(sandbox_instances.sandbox_name, args.sandboxName),
        eq(sandbox_instances.sandbox_tag, args.sandboxTag),
        eq(sandbox_instances.image, args.image),
        eq(sandbox_instances.setup_hash, args.setupHash),
      ),
    }).sync() as TSandboxInstance | undefined ?? null;
  }

  upsertInstance(args: TUpsertSandboxInstanceArgs): TSandboxInstance {
    const now = new Date();
    return this.db.insert(sandbox_instances).values({
      id: randomUUID(),
      namespace: args.namespace,
      sandbox_name: args.sandboxName,
      sandbox_tag: args.sandboxTag,
      image: args.image,
      setup_hash: args.setupHash,
      status: args.status,
      metadata: args.metadata,
      last_error: args.lastError,
      host_checked_at: now,
      updated_at: now,
    }).onConflictDoUpdate({
      target: sandbox_instances.sandbox_name,
      set: {
        namespace: args.namespace,
        sandbox_tag: args.sandboxTag,
        image: args.image,
        setup_hash: args.setupHash,
        status: args.status,
        metadata: args.metadata,
        last_error: args.lastError,
        host_checked_at: now,
        updated_at: now,
      },
    }).returning().all()[0] as TSandboxInstance;
  }

  findReusableVolumes(args: TFindReusableSandboxVolumeArgs): TSandboxVolume[] {
    return this.db.query.sandbox_volumes.findMany({
      where: and(
        eq(sandbox_volumes.sandbox_instance_id, args.instanceId),
        eq(sandbox_volumes.namespace, args.namespace),
        eq(sandbox_volumes.volume_tag, args.volumeTag),
        eq(sandbox_volumes.setup_hash, args.setupHash),
        eq(sandbox_volumes.status, 'ready'),
        eq(sandbox_volumes.reusable, true),
      ),
      orderBy: [desc(sandbox_volumes.updated_at)],
    }).sync() as TSandboxVolume[];
  }

  upsertVolume(args: TUpsertSandboxVolumeArgs): TSandboxVolume {
    const now = new Date();
    return this.db.insert(sandbox_volumes).values({
      id: randomUUID(),
      sandbox_instance_id: args.instanceId,
      namespace: args.namespace,
      volume_name: args.volumeName,
      volume_tag: args.volumeTag,
      setup_hash: args.setupHash,
      status: args.status,
      reusable: args.reusable,
      metadata: args.metadata,
      last_error: args.lastError,
      host_checked_at: now,
      updated_at: now,
    }).onConflictDoUpdate({
      target: sandbox_volumes.volume_name,
      set: {
        sandbox_instance_id: args.instanceId,
        namespace: args.namespace,
        volume_tag: args.volumeTag,
        setup_hash: args.setupHash,
        status: args.status,
        reusable: args.reusable,
        metadata: args.metadata,
        last_error: args.lastError,
        host_checked_at: now,
        updated_at: now,
      },
    }).returning().all()[0] as TSandboxVolume;
  }

  updateInstanceStatus(args: { id: string; status: TSandboxInstanceStatus; lastError: string | null }): void {
    const now = new Date();
    this.db.update(sandbox_instances).set({ status: args.status, last_error: args.lastError, host_checked_at: now, updated_at: now }).where(eq(sandbox_instances.id, args.id)).run();
  }
}
