import { createHash } from 'node:crypto';
import { fnValidatePreviewInspectionPng } from '../preview/fn.png';

const SCREENSHOT_LEASE_PATH = '/internal/widget-inspection-screenshot/';
const SCREENSHOT_LEASE_OPERATION_HEADER = 'X-Omnidraw-Widget-Inspection-Operation';
const DEFAULT_LEASE_TTL_MS = 30_000;
const DEFAULT_MAX_LEASES = 16;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1_024 * 1_024;

type TLease = {
  bytes: Uint8Array;
  expiresAtMs: number;
  operationDigestSha256: string;
};

type TWidgetScreenshotLeaseServiceConfig = Readonly<{
  baseUrl: string;
  createToken(): string;
  nowMs(): number;
  ttlMs?: number;
  maxLeases?: number;
  maxTotalBytes?: number;
}>;

export type TWidgetScreenshotLease = Readonly<{
  url: string;
  expiresAtMs: number;
}>;

function leaseError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/** In-memory, loopback-only, single-use delivery for an already-validated PNG. */
export class WidgetScreenshotLeaseService {
  readonly #config: Required<Omit<TWidgetScreenshotLeaseServiceConfig, 'baseUrl' | 'createToken' | 'nowMs'>>
    & Pick<TWidgetScreenshotLeaseServiceConfig, 'baseUrl' | 'createToken' | 'nowMs'>;
  readonly #leases = new Map<string, TLease>();
  #totalBytes = 0;
  #stopped = false;

  constructor(config: TWidgetScreenshotLeaseServiceConfig) {
    const base = new URL(config.baseUrl);
    if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.pathname !== '/') {
      throw new TypeError('Widget screenshot leases require an exact loopback HTTP base URL.');
    }
    this.#config = Object.freeze({
      ...config,
      baseUrl: base.href,
      ttlMs: config.ttlMs ?? DEFAULT_LEASE_TTL_MS,
      maxLeases: config.maxLeases ?? DEFAULT_MAX_LEASES,
      maxTotalBytes: config.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
    });
  }

  issue(args: Readonly<{
    operationId: string;
    bytes: Uint8Array;
    mimeType: 'image/png';
    width: number;
    height: number;
    byteSize: number;
    digestSha256: string;
  }>): TWidgetScreenshotLease {
    if (this.#stopped) {
      throw leaseError('SCREENSHOT_LEASE_UNAVAILABLE', 'Screenshot delivery is stopping.');
    }
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(args.operationId)) {
      throw new TypeError('Screenshot lease operation identity is invalid.');
    }
    this.#prune();
    const validation = fnValidatePreviewInspectionPng({
      bytes: args.bytes,
      expectedWidth: args.width,
      expectedHeight: args.height,
    });
    const digestSha256 = createHash('sha256').update(args.bytes).digest('hex');
    if (
      args.mimeType !== 'image/png'
      || !validation.ok
      || validation.byteSize !== args.byteSize
      || digestSha256 !== args.digestSha256
    ) {
      throw leaseError(
        'SCREENSHOT_LEASE_INVALID',
        'Screenshot bytes do not match their validated inspection metadata.',
      );
    }
    if (
      this.#leases.size >= this.#config.maxLeases
      || this.#totalBytes + args.bytes.byteLength > this.#config.maxTotalBytes
    ) {
      throw leaseError(
        'SCREENSHOT_LEASE_CAPACITY_EXCEEDED',
        'Screenshot delivery capacity is temporarily exhausted.',
      );
    }
    let token: string | undefined;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const candidate = this.#config.createToken();
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(candidate)) {
        throw new TypeError('Screenshot lease token is invalid.');
      }
      if (!this.#leases.has(candidate)) {
        token = candidate;
        break;
      }
    }
    if (token === undefined) {
      throw leaseError('SCREENSHOT_LEASE_TOKEN_EXHAUSTED', 'Screenshot lease identity is unavailable.');
    }
    const expiresAtMs = this.#config.nowMs() + this.#config.ttlMs;
    const bytes = new Uint8Array(args.bytes);
    this.#leases.set(token, {
      bytes,
      expiresAtMs,
      operationDigestSha256: createHash('sha256').update(args.operationId).digest('hex'),
    });
    this.#totalBytes += bytes.byteLength;
    return Object.freeze({
      url: new URL(`${SCREENSHOT_LEASE_PATH}${token}`, this.#config.baseUrl).href,
      expiresAtMs,
    });
  }

  /** Returns null for unrelated paths so the main HTTP edge can continue routing. */
  consume(request: Request): Response | null {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(SCREENSHOT_LEASE_PATH)) return null;
    this.#prune();
    if (request.method !== 'GET') return this.#notFound();
    const token = url.pathname.slice(SCREENSHOT_LEASE_PATH.length);
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(token) || url.search !== '') return this.#notFound();
    const lease = this.#leases.get(token);
    if (lease === undefined || lease.expiresAtMs <= this.#config.nowMs()) {
      if (lease !== undefined) this.#release(token, lease);
      return this.#notFound();
    }
    const operationId = request.headers.get(SCREENSHOT_LEASE_OPERATION_HEADER);
    if (
      operationId === null
      || !/^[A-Za-z0-9_-]{1,96}$/.test(operationId)
      || createHash('sha256').update(operationId).digest('hex') !== lease.operationDigestSha256
    ) return this.#notFound();
    this.#leases.delete(token);
    this.#totalBytes -= lease.bytes.byteLength;
    const responseBytes = new Uint8Array(lease.bytes);
    lease.bytes.fill(0);
    return new Response(responseBytes, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(responseBytes.byteLength),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    for (const [token, lease] of this.#leases) this.#release(token, lease);
  }

  #prune(): void {
    const now = this.#config.nowMs();
    for (const [token, lease] of this.#leases) {
      if (lease.expiresAtMs <= now) this.#release(token, lease);
    }
  }

  #release(token: string, lease: TLease): void {
    if (!this.#leases.delete(token)) return;
    this.#totalBytes -= lease.bytes.byteLength;
    lease.bytes.fill(0);
  }

  #notFound(): Response {
    return new Response('Not Found', {
      status: 404,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
}

export { SCREENSHOT_LEASE_OPERATION_HEADER, SCREENSHOT_LEASE_PATH };
export type { TWidgetScreenshotLeaseServiceConfig };
