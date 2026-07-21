import type { DocHandle } from '@automerge/automerge-repo';
import type { IService, IStartableService, IStoppableService } from '@vibecanvas/runtime';
import type { TTenantContext } from '@vibecanvas/tenant-core';
import type { WebSocketWithIsAlive } from './adapters/websocket.adapter';
import type { TAutomergeTenantMetrics } from './types/automerge-service.types';

export interface IAutomergeService extends IService, IStartableService, IStoppableService {
  createDocument<T>(tenantContext: TTenantContext, initialValue?: T): Promise<DocHandle<T>>;
  findDocument<T>(tenantContext: TTenantContext, automergeUrl: string): Promise<DocHandle<T>>;
  deleteDocument(tenantContext: TTenantContext, automergeUrl: string): Promise<void>;
  admitDocument(tenantContext: TTenantContext, automergeUrl: string): Promise<boolean>;
  releaseDocument(tenantContext: TTenantContext, automergeUrl: string): Promise<void>;
  notifyDocumentRegistered(tenantContext: TTenantContext, automergeUrl: string): Promise<void>;
  failDocumentRegistration(
    tenantContext: TTenantContext,
    automergeUrl: string,
    cause: unknown,
  ): void;
  openConnection(tenantContext: TTenantContext, socket: WebSocketWithIsAlive): void;
  receiveConnectionMessage(
    tenantContext: TTenantContext,
    socket: WebSocketWithIsAlive,
    message: string | Buffer,
  ): Promise<void>;
  closeConnection(
    tenantContext: TTenantContext,
    socket: WebSocketWithIsAlive,
    code: number,
    reason: string,
  ): void;
  pongConnection(tenantContext: TTenantContext, socket: WebSocketWithIsAlive, data: Buffer): void;
  getTenantMetrics(tenantContext: TTenantContext): TAutomergeTenantMetrics;
}
