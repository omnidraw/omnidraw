import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import type {
  TPreviewInspectionShellBuild,
  TPreviewInspectionShellLease,
  TPreviewInspectionShellLeasePort,
} from './interface';

const INSPECTION_DIST_RECEIPT = '.omnidraw-inspection-dist.json';
const INSPECTION_DIST_FORMAT = 'omnidraw.preview-inspection-dist.v1';

type TVerifiedShellBuild = TPreviewInspectionShellBuild & Readonly<{
  files: ReadonlyMap<string, Readonly<{ bytes: number; sha256: string }>>;
}>;

type TPreviewInspectionShellServerConfig = Readonly<{
  distPath: string;
  createToken: () => string;
  readFile?: (path: string) => Promise<Uint8Array>;
}>;

const CONTENT_TYPES = Object.freeze<Record<string, string>>({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
});

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
  readonly #readFile: (path: string) => Promise<Uint8Array>;
  readonly #tokens = new Map<string, TVerifiedShellBuild>();
  #server: ReturnType<typeof Bun.serve> | undefined;

  constructor(config: TPreviewInspectionShellServerConfig) {
    this.path = normalize(config.distPath);
    this.#createToken = config.createToken;
    this.#readFile = config.readFile ?? ((path) => readFile(path));
  }

  async verify(): Promise<TPreviewInspectionShellBuild> {
    const build = await this.#verifyBuild();
    return Object.freeze({ buildId: build.buildId, rootPath: build.rootPath });
  }

  async open(_jobId: string): Promise<TPreviewInspectionShellLease> {
    const build = await this.#verifyBuild();
    const server = this.#server ??= this.#start();
    let token = this.#createToken();
    while (this.#tokens.has(token)) token = this.#createToken();
    this.#tokens.set(token, build);
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

  async #verifyBuild(): Promise<TVerifiedShellBuild> {
    const rootPath = await realpath(this.path).catch(() => null);
    if (rootPath === null) {
      throw Object.assign(
        new Error('Preview inspection shell is missing. Run the verified inspection build and retry.'),
        { code: 'INSPECTION_SHELL_MISSING' },
      );
    }
    const receiptPath = join(rootPath, INSPECTION_DIST_RECEIPT);
    const receiptBytes = await this.#readFile(receiptPath).catch(() => null);
    if (receiptBytes === null) {
      throw Object.assign(
        new Error('Preview inspection shell has no verified distribution receipt.'),
        { code: 'INSPECTION_SHELL_UNVERIFIED' },
      );
    }
    let receipt: unknown;
    try { receipt = JSON.parse(new TextDecoder().decode(receiptBytes)); } catch { receipt = null; }
    if (
      receipt === null
      || typeof receipt !== 'object'
      || !('format' in receipt)
      || receipt.format !== INSPECTION_DIST_FORMAT
      || !('buildId' in receipt)
      || typeof receipt.buildId !== 'string'
      || !/^sha256:[a-f0-9]{64}$/.test(receipt.buildId)
      || !('files' in receipt)
      || !Array.isArray(receipt.files)
    ) {
      throw Object.assign(new Error('Preview inspection shell receipt is malformed.'), {
        code: 'INSPECTION_SHELL_UNVERIFIED',
      });
    }
    const files = new Map<string, Readonly<{ bytes: number; sha256: string }>>();
    for (const value of receipt.files) {
      if (
        value === null
        || typeof value !== 'object'
        || !('path' in value)
        || typeof value.path !== 'string'
        || value.path.length === 0
        || value.path.includes('\\')
        || isAbsolute(value.path)
        || value.path.split('/').some((part: string) => part === '' || part === '.' || part === '..')
        || !('bytes' in value)
        || !Number.isSafeInteger(value.bytes)
        || (value.bytes as number) < 0
        || !('sha256' in value)
        || typeof value.sha256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(value.sha256)
        || files.has(value.path)
      ) {
        throw Object.assign(new Error('Preview inspection shell receipt contains an invalid file entry.'), {
          code: 'INSPECTION_SHELL_UNVERIFIED',
        });
      }
      files.set(value.path, Object.freeze({ bytes: value.bytes as number, sha256: value.sha256 }));
    }
    if (!files.has('index.html')) {
      throw Object.assign(new Error('Preview inspection shell receipt does not contain index.html.'), {
        code: 'INSPECTION_SHELL_UNVERIFIED',
      });
    }
    const exactPaths: string[] = [];
    const pending = [rootPath];
    while (pending.length > 0) {
      const directory = pending.pop()!;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = resolve(directory, entry.name);
        const nested = relative(rootPath, absolute).split(sep).join('/');
        if (nested === INSPECTION_DIST_RECEIPT) continue;
        if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
          throw Object.assign(new Error('Preview inspection shell contains an unverified filesystem entry.'), {
            code: 'INSPECTION_SHELL_UNVERIFIED',
          });
        }
        if (entry.isDirectory()) pending.push(absolute);
        else exactPaths.push(nested);
      }
    }
    exactPaths.sort();
    if (exactPaths.length !== files.size || exactPaths.some((path) => !files.has(path))) {
      throw Object.assign(new Error('Preview inspection shell files do not match the verified receipt.'), {
        code: 'INSPECTION_SHELL_UNVERIFIED',
      });
    }
    for (const [path, expected] of files) {
      const absolute = join(rootPath, path);
      const fileStat = await lstat(absolute).catch(() => null);
      if (fileStat === null || !fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size !== expected.bytes) {
        throw Object.assign(new Error('Preview inspection shell file identity does not match its receipt.'), {
          code: 'INSPECTION_SHELL_UNVERIFIED',
        });
      }
      const digest = createHash('sha256').update(await this.#readFile(absolute)).digest('hex');
      if (digest !== expected.sha256) {
        throw Object.assign(new Error('Preview inspection shell file identity does not match its receipt.'), {
          code: 'INSPECTION_SHELL_UNVERIFIED',
        });
      }
    }
    const identitySource = JSON.stringify([...files].map(([path, value]) => ({ path, ...value })));
    const buildId = `sha256:${createHash('sha256').update(identitySource).digest('hex')}` as const;
    if (receipt.buildId !== buildId) {
      throw Object.assign(new Error('Preview inspection shell build identity does not match its receipt.'), {
        code: 'INSPECTION_SHELL_UNVERIFIED',
      });
    }
    return Object.freeze({ buildId, rootPath, files });
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
    const build = token === undefined ? undefined : this.#tokens.get(token);
    if (build === undefined) {
      return new Response('Not Found', { status: 404, headers: SECURITY_HEADERS });
    }
    const requested = segments.length === 0 ? 'index.html' : segments.join('/');
    if (
      requested.includes('\\')
      || requested.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) return new Response('Not Found', { status: 404, headers: SECURITY_HEADERS });
    const expected = build.files.get(requested);
    if (expected === undefined) return new Response('Not Found', { status: 404, headers: SECURITY_HEADERS });
    const absolute = normalize(join(build.rootPath, requested));
    if (relative(build.rootPath, absolute).startsWith('..')) {
      return new Response('Not Found', { status: 404, headers: SECURITY_HEADERS });
    }
    const fileStat = await lstat(absolute).catch(() => null);
    if (fileStat === null || !fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size !== expected.bytes) {
      return new Response('Not Found', { status: 404, headers: SECURITY_HEADERS });
    }
    const bytes = await this.#readFile(absolute);
    if (createHash('sha256').update(bytes).digest('hex') !== expected.sha256) {
      return new Response('Not Found', { status: 404, headers: SECURITY_HEADERS });
    }
    const verifiedBody = Uint8Array.from(bytes);
    // The response owns the exact byte snapshot whose digest was checked above.
    // Reopening the path here would create a verification/use race if the file
    // were replaced after the read but before the response consumed it.
    return new Response(request.method === 'HEAD' ? null : verifiedBody.buffer, {
      headers: {
        ...SECURITY_HEADERS,
        'Content-Length': String(bytes.byteLength),
        'Content-Type': CONTENT_TYPES[extname(requested).toLowerCase()]
          ?? 'application/octet-stream',
      },
    });
  }
}
