import { DatabasePromise } from "@tursodatabase/database-common";
import type { DatabaseOpts, EncryptionCipher, NativeDatabase } from "@tursodatabase/database-common";
import { createRequire } from "node:module";
import path from "node:path";

type TNativeDatabaseConstructor = new (databasePath: string, opts?: Record<string, unknown>) => NativeDatabase;
type TNativeEncryptionCipher = Record<string, unknown>;
type TNativeBinding = {
  Database: TNativeDatabaseConstructor;
  EncryptionCipher?: TNativeEncryptionCipher;
};

const require = createRequire(import.meta.url);

const nativePackageByPlatform = {
  "darwin-arm64": {
    packageName: "@tursodatabase/database-darwin-arm64",
    fileName: "turso.darwin-arm64.node",
  },
  "linux-arm64": {
    packageName: "@tursodatabase/database-linux-arm64-gnu",
    fileName: "turso.linux-arm64-gnu.node",
  },
  "linux-x64": {
    packageName: "@tursodatabase/database-linux-x64-gnu",
    fileName: "turso.linux-x64-gnu.node",
  },
  "win32-x64": {
    packageName: "@tursodatabase/database-win32-x64-msvc",
    fileName: "turso.win32-x64-msvc.node",
  },
} as const;

type TNativePlatformKey = keyof typeof nativePackageByPlatform;

function getNativePlatformKey(): TNativePlatformKey {
  const key = `${process.platform}-${process.arch}`;
  if (key in nativePackageByPlatform) {
    return key as TNativePlatformKey;
  }

  throw new Error(`Unsupported Turso native platform for vibecanvas binary: ${key}`);
}

function getCompiledNativeAddonPath(fileName: string): string {
  return path.join(path.dirname(process.execPath), "..", "native", fileName);
}

function getSourceNativeAddonPath(packageName: string, fileName: string): string {
  const databaseEntrypoint = Bun.resolveSync("@tursodatabase/database", import.meta.url);
  const nativePackageLeaf = packageName.split("/").at(-1);
  if (!nativePackageLeaf) {
    throw new Error(`Invalid Turso native package name: ${packageName}`);
  }

  return path.join(path.dirname(databaseEntrypoint), "..", "..", nativePackageLeaf, fileName);
}

function isCompiledRuntime(): boolean {
  return (
    (typeof VIBECANVAS_COMPILED !== "undefined" && VIBECANVAS_COMPILED) ||
    process.env.VIBECANVAS_COMPILED === "true"
  );
}

function loadNativeBinding(): TNativeBinding {
  const nativePlatform = nativePackageByPlatform[getNativePlatformKey()];
  const nativePath = isCompiledRuntime()
    ? getCompiledNativeAddonPath(nativePlatform.fileName)
    : getSourceNativeAddonPath(nativePlatform.packageName, nativePlatform.fileName);

  try {
    return require(nativePath) as TNativeBinding;
  } catch (error) {
    throw new Error(`Failed to load Turso native addon at ${nativePath}`, { cause: error });
  }
}

function getCipherValue(cipher: EncryptionCipher, nativeCipher: TNativeEncryptionCipher | undefined): unknown {
  if (!nativeCipher) {
    throw new Error("Turso encryption is not supported by this native addon");
  }

  const cipherMap = {
    aes128gcm: nativeCipher.Aes128Gcm,
    aes256gcm: nativeCipher.Aes256Gcm,
    aegis256: nativeCipher.Aegis256,
    aegis256x2: nativeCipher.Aegis256x2,
    aegis128l: nativeCipher.Aegis128l,
    aegis128x2: nativeCipher.Aegis128x2,
    aegis128x4: nativeCipher.Aegis128x4,
  } satisfies Record<EncryptionCipher, unknown>;

  const value = cipherMap[cipher];
  if (value === undefined) {
    throw new Error(`Turso encryption cipher ${cipher} is not supported by this native addon`);
  }

  return value;
}

const nativeBinding = loadNativeBinding();

export class Database extends DatabasePromise {
  constructor(databasePath: string, opts: DatabaseOpts = {}) {
    const nativeOpts = { ...opts } as Record<string, unknown>;
    if (opts.encryption) {
      nativeOpts.encryption = {
        cipher: getCipherValue(opts.encryption.cipher, nativeBinding.EncryptionCipher),
        hexkey: opts.encryption.hexkey,
      };
    }

    super(new nativeBinding.Database(databasePath, nativeOpts));
  }
}
declare const VIBECANVAS_COMPILED: boolean | undefined;
