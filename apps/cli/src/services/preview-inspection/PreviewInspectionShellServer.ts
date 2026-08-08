import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { join, normalize, relative } from 'node:path';
import type {
  TPreviewInspectionShellLease,
  TPreviewInspectionShellLeasePort,
} from './interface';

type TPreviewInspectionShellServerConfig = Readonly<{
  distPath: string;
  createToken?: () => string;
}>;

const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
  'Content-Security-Policy': [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});

export class PreviewInspectionShellServer
implements TPreviewInspectionShellLeasePort {
  readonly path: string;
  readonly #createToken: () => string;
  readonly #tokens = new Set<string>();
  #server: ReturnType<typeof Bun.serve> | undefined;

  constructor(config: TPreviewInspectionShellServerConfig) {
    this.path = normalize(config.distPath);
    this.#createToken = config.createToken
      ?? (() => randomBytes(24).toString('base64url'));
  }

  async open(_jobId: string): Promise<TPreviewInspectionShellLease> {
    const entry = join(this.path, 'index.html');
    const entryStat = await stat(entry).catch(() => null);
    if (entryStat === null || !entryStat.isFile()) {
      throw Object.assign(
        new Error(
          'Preview inspection shell is missing. Run `bun run --cwd apps/preview-inspection-shell build` and restart Omnidraw.',
        ),
        { code: 'INSPECTION_SHELL_MISSING' },
      );
    }
    const server = this.#server ??= this.#start();
    let token = this.#createToken();
    while (this.#tokens.has(token)) token = this.#createToken();
    this.#tokens.add(token);
    let active = true;
    return Object.freeze({
      url: `http://${server.hostname}:${server.port}/${token}/index.html`,
      release: (): void => {
        if (!active) return;
        active = false;
        this.#tokens.delete(token);
      },
    });
  }

  async stop(): Promise<void> {
    this.#tokens.clear();
    this.#server?.stop(true);
    this.#server = undefined;
  }

  #start(): ReturnType<typeof Bun.serve> {
    return Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      development: false,
      fetch: (request) => this.#fetch(request),
    });
  }

  async #fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: SECURITY_HEADERS,
      });
    }
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const token = segments.shift();
    if (token === undefined || !this.#tokens.has(token)) {
      return new Response('Not Found', { status: 404, headers: SECURITY_HEADERS });
    }
    const requested = segments.length === 0 ? 'index.html' : segments.join('/');
    if (
      requested.includes('\\')
      || requested.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) return new Response('Not Found', { status: 404, headers: SECURITY_HEADERS });
    const absolute = normalize(join(this.path, requested));
    if (relative(this.path, absolute).startsWith('..')) {
      return new Response('Not Found', { status: 404, headers: SECURITY_HEADERS });
    }
    const fileStat = await stat(absolute).catch(() => null);
    if (fileStat === null || !fileStat.isFile()) {
      return new Response('Not Found', { status: 404, headers: SECURITY_HEADERS });
    }
    const file = Bun.file(absolute);
    return new Response(request.method === 'HEAD' ? null : file, {
      headers: {
        ...SECURITY_HEADERS,
        'Content-Type': file.type || 'application/octet-stream',
      },
    });
  }
}
