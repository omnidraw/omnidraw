import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createPngFixture } from '../../../tests/preview-inspection.png-fixture';
import {
  SCREENSHOT_LEASE_OPERATION_HEADER,
  WidgetScreenshotLeaseService,
} from './WidgetScreenshotLeaseService';

const OPERATION_A = 'inspection-operation-a';
const OPERATION_B = 'inspection-operation-b';

function leaseRequest(url: string, operationId: string, method = 'GET'): Request {
  return new Request(url, {
    method,
    headers: { [SCREENSHOT_LEASE_OPERATION_HEADER]: operationId },
  });
}

describe('WidgetScreenshotLeaseService', () => {
  test('serves one exact PNG once and hides expired or invalid leases', async () => {
    let now = 1_000;
    let sequence = 0;
    const service = new WidgetScreenshotLeaseService({
      baseUrl: 'http://127.0.0.1:3210/',
      createToken: () => `${String(sequence += 1).padStart(32, 'a')}`,
      nowMs: () => now,
      ttlMs: 50,
    });
    const bytes = createPngFixture(2, 2);
    const lease = service.issue({
      operationId: OPERATION_A,
      bytes,
      mimeType: 'image/png',
      width: 2,
      height: 2,
      byteSize: bytes.byteLength,
      digestSha256: createHash('sha256').update(bytes).digest('hex'),
    });

    expect(service.consume(new Request(lease.url))?.status).toBe(404);
    expect(service.consume(leaseRequest(lease.url, OPERATION_B))?.status).toBe(404);

    const first = service.consume(leaseRequest(lease.url, OPERATION_A));
    expect(first?.status).toBe(200);
    expect(first?.headers.get('content-type')).toBe('image/png');
    expect(first?.headers.get('cache-control')).toBe('no-store');
    expect(new Uint8Array(await first!.arrayBuffer())).toEqual(bytes);
    expect(service.consume(leaseRequest(lease.url, OPERATION_A))?.status).toBe(404);

    const expiring = service.issue({
      operationId: OPERATION_A,
      bytes,
      mimeType: 'image/png',
      width: 2,
      height: 2,
      byteSize: bytes.byteLength,
      digestSha256: createHash('sha256').update(bytes).digest('hex'),
    });
    now += 51;
    expect(service.consume(leaseRequest(expiring.url, OPERATION_A))?.status).toBe(404);

    const wrongMethod = service.issue({
      operationId: OPERATION_B,
      bytes,
      mimeType: 'image/png',
      width: 2,
      height: 2,
      byteSize: bytes.byteLength,
      digestSha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(service.consume(leaseRequest(wrongMethod.url, OPERATION_B, 'HEAD'))?.status).toBe(404);
    expect(service.consume(leaseRequest(wrongMethod.url, OPERATION_B))?.status).toBe(200);

    expect(() => service.issue({
      operationId: 'invalid operation id',
      bytes,
      mimeType: 'image/png',
      width: 2,
      height: 2,
      byteSize: bytes.byteLength,
      digestSha256: createHash('sha256').update(bytes).digest('hex'),
    })).toThrow('Screenshot lease operation identity is invalid.');
    service.stop();
  });
});
