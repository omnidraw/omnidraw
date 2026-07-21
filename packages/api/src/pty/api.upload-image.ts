import { ORPCError } from '@orpc/server';
import { createHash, randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join, posix } from 'path';
import { fnScopedKey, type TTenantContext } from '@vibecanvas/tenant-core';
import { fnExtensionFromPtyImageFormat } from './core/fn.extension-from-pty-image-format';
import { fxResolveFilesystemId } from './core/fx.resolve-filesystem-id';
import { basePtyOs } from './orpc';

function getBase64Payload(base64OrDataUrl: string): string {
  const match = base64OrDataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (match?.[1]) return match[1];
  return base64OrDataUrl;
}

function getRequestTempDirectory(tenant: TTenantContext) {
  const scope = fnScopedKey('pty-upload', [tenant.orgId, tenant.accountId, tenant.requestId]);
  const opaqueScope = createHash('sha256').update(scope).digest('hex');
  return posix.join('.vibecanvas', 'temp', 'pty-clipboard', opaqueScope);
}

async function uploadPtyImageToTemp(args: {
  tenant: TTenantContext;
  hostDirectory: string;
  base64: string;
  format: Parameters<typeof fnExtensionFromPtyImageFormat>[0];
}) {
  const base64Payload = getBase64Payload(args.base64).trim();
  const bytes = Buffer.from(base64Payload, 'base64');

  if (bytes.length === 0) {
    throw new Error('Invalid or empty image payload');
  }

  const virtualDirectory = getRequestTempDirectory(args.tenant);
  await mkdir(args.hostDirectory, { recursive: true });

  const fileName = `clipboard-${Date.now()}-${randomUUID()}.${fnExtensionFromPtyImageFormat(args.format)}`;
  const hostFilePath = join(args.hostDirectory, fileName);
  await writeFile(hostFilePath, bytes);

  return { path: posix.join(virtualDirectory, fileName) };
}

const apiUploadPtyImage = basePtyOs.uploadImage.handler(async ({ input, context }) => {
  const filesystemId = await fxResolveFilesystemId({ db: context.db }, { tenant: context.tenant, filesystemId: input.filesystemId });
  if (!filesystemId) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  const virtualDirectory = getRequestTempDirectory(context.tenant);
  const hostDirectory = context.filesystem.resolveHostPath(context.tenant, {
    filesystemId,
    path: virtualDirectory,
  });
  if (!hostDirectory) throw new ORPCError('NOT_FOUND', { message: 'No local filesystem registered' });
  return uploadPtyImageToTemp({
    tenant: context.tenant,
    hostDirectory,
    base64: input.body.base64,
    format: input.body.format,
  });
});

export { apiUploadPtyImage, getBase64Payload, getRequestTempDirectory, uploadPtyImageToTemp };
