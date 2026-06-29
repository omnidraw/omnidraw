/* eslint-disable functional-core/fx-tx-params -- legacy fx API uses inline portal and args shapes */
import type { ICliConfig } from '@vibecanvas/cli/config';

export type TCanvasServerHealth = {
  ok: true;
  service: 'vibecanvas';
  version: string;
  compiled: boolean;
  port: number;
};

function getDefaultPort(compiled: boolean): number {
  return compiled ? 7496 : 3000;
}

function getPortCandidates(preferredPort: number, compiled: boolean): number[] {
  const ports = new Set<number>();
  ports.add(preferredPort);

  const fallbackStart = getDefaultPort(compiled);
  const span = compiled ? 100 : 8;
  for (let offset = 0; offset < span; offset += 1) {
    ports.add(fallbackStart + offset);
  }

  return [...ports];
}

async function readHealth(portal: { fetch: typeof fetch }, port: number): Promise<TCanvasServerHealth | null> {
  try {
    const response = await portal.fetch(`http://127.0.0.1:${port}/health`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(250),
    });
    if (!response.ok) return null;
    const payload = await response.json() as Partial<TCanvasServerHealth>;
    if (payload.ok !== true) return null;
    if (payload.service !== 'vibecanvas') return null;
    if (typeof payload.version !== 'string') return null;
    if (typeof payload.compiled !== 'boolean') return null;
    return {
      ok: true,
      service: 'vibecanvas',
      version: payload.version,
      compiled: payload.compiled,
      port,
    };
  } catch {
    return null;
  }
}

export async function fxDiscoverLocalCanvasServer(portal: { bun: typeof Bun }, args: { config: ICliConfig }): Promise<TCanvasServerHealth | null> {
  const candidates = getPortCandidates(args.config.port, args.config.compiled);

  for (const port of candidates) {
    const health = await readHealth({ fetch: portal.bun.fetch }, port);
    if (health) return health;
  }

  return null;
}
