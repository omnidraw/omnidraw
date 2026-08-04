import { fxScanWidgetCatalog } from './fx.scan-widget-catalog';
import { WIDGET_CATALOG_CONTRACTS } from './WidgetCatalogContracts';
import type {
  TPinnedWidgetCatalogRoot,
  TWidgetCatalogScanPortal,
  TWidgetCatalogSnapshot,
  TWidgetCatalogReadBarrier,
  TWidgetFilesystemCatalogConfig,
} from './typed';

/** Owns generation ordering while every returned catalog remains immutable. */
export class WidgetFilesystemCatalog {
  readonly #portal: TWidgetCatalogScanPortal;
  readonly #root: Promise<TPinnedWidgetCatalogRoot>;
  readonly #limits: TWidgetFilesystemCatalogConfig['limits'];
  readonly #barrier: TWidgetCatalogReadBarrier | null;
  #generation = 0;
  #current: TWidgetCatalogSnapshot | null = null;
  #refreshTail: Promise<void> = Promise.resolve();

  constructor(config: TWidgetFilesystemCatalogConfig) {
    this.#portal = Object.freeze({
      filesystem: config.filesystem,
      hash: config.hash,
      capsule: config.capsule,
      contracts: config.contracts ?? WIDGET_CATALOG_CONTRACTS,
    });
    this.#root = config.filesystem.pinRoot({ requestedPath: config.rootPath });
    this.#limits = config.limits;
    this.#barrier = config.barrier ?? null;
  }

  current(): TWidgetCatalogSnapshot | null {
    return this.#current;
  }

  refresh(): Promise<TWidgetCatalogSnapshot> {
    const operation = this.#refreshTail.then(async () => {
      const root = await this.#root;
      const scan = () => fxScanWidgetCatalog(this.#portal, {
          root,
          generation: this.#generation + 1,
          limits: this.#limits,
        });
      const snapshot = this.#barrier === null
        ? await scan()
        : await this.#barrier.withRead(scan);
      if (this.#current?.digestSha256 === snapshot.digestSha256) {
        return this.#current;
      }
      this.#generation = snapshot.generation;
      this.#current = snapshot;
      return snapshot;
    });
    this.#refreshTail = operation.then(() => undefined, () => undefined);
    return operation;
  }
}
