/**
 * @file Applies narrowly-scoped Automerge Repo runtime safety patches.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const targets = [join(process.cwd(), "node_modules/.bun")];
const checkOnly = process.argv.includes("--check");

const patches = [
  {
    suffix: "/node_modules/@automerge/automerge-repo/dist/helpers/throttle.js",
    oldText: "        }, wait);\n",
    newText: "        }, Math.max(0, wait));\n",
  },
  {
    suffix: "/node_modules/@automerge/automerge-repo/src/helpers/throttle.ts",
    oldText: "    }, wait)\n",
    newText: "    }, Math.max(0, wait))\n",
  },
  {
    suffix: "/node_modules/@automerge/automerge-repo/dist/Repo.js",
    oldText: `        const doc = handle.doc();
        // because this is an internal-ish function, we'll be extra careful about undefined docs here
        if (doc) {
            if (handle.isReady()) {
                handle.unload();
            }
            else {
                this.#log(\`WARN: removeFromCache called but handle for documentId: \${documentId} in unexpected state: \${handle.state}\`);
            }
            delete this.#handleCache[documentId];
            delete this.#progressCache[documentId];
            delete this.#saveFns[documentId];
            this.synchronizer.removeDocument(documentId);
        }
        else {
            this.#log(\`WARN: removeFromCache called but doc undefined for documentId: \${documentId}\`);
        }
`,
    newText: `        if (handle.isReady()) {
            handle.unload();
        }
        else if (!handle.inState([UNLOADED, DELETED, UNAVAILABLE])) {
            this.#log(\`WARN: removeFromCache called but handle for documentId: \${documentId} in unexpected state: \${handle.state}\`);
            return;
        }
        delete this.#handleCache[documentId];
        delete this.#progressCache[documentId];
        delete this.#saveFns[documentId];
        this.synchronizer.removeDocument(documentId);
`,
  },
  {
    suffix: "/node_modules/@automerge/automerge-repo/src/Repo.ts",
    oldText: `    const doc = handle.doc()
    // because this is an internal-ish function, we'll be extra careful about undefined docs here
    if (doc) {
      if (handle.isReady()) {
        handle.unload()
      } else {
        this.#log(
          \`WARN: removeFromCache called but handle for documentId: \${documentId} in unexpected state: \${handle.state}\`
        )
      }
      delete this.#handleCache[documentId]
      delete this.#progressCache[documentId]
      delete this.#saveFns[documentId]
      this.synchronizer.removeDocument(documentId)
    } else {
      this.#log(
        \`WARN: removeFromCache called but doc undefined for documentId: \${documentId}\`
      )
    }
`,
    newText: `    if (handle.isReady()) {
      handle.unload()
    } else if (!handle.inState([UNLOADED, DELETED, UNAVAILABLE])) {
      this.#log(
        \`WARN: removeFromCache called but handle for documentId: \${documentId} in unexpected state: \${handle.state}\`
      )
      return
    }
    delete this.#handleCache[documentId]
    delete this.#progressCache[documentId]
    delete this.#saveFns[documentId]
    this.synchronizer.removeDocument(documentId)
`,
  },
  {
    suffix: "/node_modules/@automerge/automerge-repo/dist/Repo.js",
    oldText: `        networkSubsystem.on("peer-disconnected", ({ peerId }) => {
            this.synchronizer.removePeer(peerId);
            this.#remoteHeadsSubscriptions.removePeer(peerId);
        });
`,
    newText: `        networkSubsystem.on("peer-disconnected", ({ peerId }) => {
            const { storageId } = this.peerMetadataByPeerId[peerId] || {};
            this.synchronizer.removePeer(peerId);
            this.#remoteHeadsSubscriptions.removePeer(peerId);
            delete this.peerMetadataByPeerId[peerId];
            if (storageId && !Object.values(this.peerMetadataByPeerId).some(metadata => metadata.storageId === storageId)) {
                delete this.#throttledSaveSyncStateHandlers[storageId];
            }
        });
`,
  },
  {
    suffix: "/node_modules/@automerge/automerge-repo/src/Repo.ts",
    oldText: `    networkSubsystem.on("peer-disconnected", ({ peerId }) => {
      this.synchronizer.removePeer(peerId)
      this.#remoteHeadsSubscriptions.removePeer(peerId)
    })
`,
    newText: `    networkSubsystem.on("peer-disconnected", ({ peerId }) => {
      const { storageId } = this.peerMetadataByPeerId[peerId] || {}
      this.synchronizer.removePeer(peerId)
      this.#remoteHeadsSubscriptions.removePeer(peerId)
      delete this.peerMetadataByPeerId[peerId]
      if (
        storageId &&
        !Object.values(this.peerMetadataByPeerId).some(
          metadata => metadata.storageId === storageId
        )
      ) {
        delete this.#throttledSaveSyncStateHandlers[storageId]
      }
    })
`,
  },
  {
    suffix: "/node_modules/@automerge/automerge-repo/dist/synchronizer/DocSynchronizer.js",
    oldText: `    #initSyncState(peerId, syncState) {
        const pendingCallbacks = this.#pendingSyncStateCallbacks[peerId];
        if (pendingCallbacks) {
            for (const callback of pendingCallbacks) {
                callback(syncState);
            }
        }
        delete this.#pendingSyncStateCallbacks[peerId];
        this.#syncStates[peerId] = syncState;
    }
`,
    newText: `    #initSyncState(peerId, syncState) {
        if (!this.#peers.includes(peerId)) {
            delete this.#pendingSyncStateCallbacks[peerId];
            delete this.#syncStates[peerId];
            return;
        }
        const pendingCallbacks = this.#pendingSyncStateCallbacks[peerId];
        if (pendingCallbacks) {
            for (const callback of pendingCallbacks) {
                callback(syncState);
            }
        }
        delete this.#pendingSyncStateCallbacks[peerId];
        this.#syncStates[peerId] = syncState;
    }
`,
  },
  {
    suffix: "/node_modules/@automerge/automerge-repo/src/synchronizer/DocSynchronizer.ts",
    oldText: `  #initSyncState(peerId: PeerId, syncState: A.SyncState) {
    const pendingCallbacks = this.#pendingSyncStateCallbacks[peerId]
    if (pendingCallbacks) {
      for (const callback of pendingCallbacks) {
        callback(syncState)
      }
    }

    delete this.#pendingSyncStateCallbacks[peerId]

    this.#syncStates[peerId] = syncState
  }
`,
    newText: `  #initSyncState(peerId: PeerId, syncState: A.SyncState) {
    if (!this.#peers.includes(peerId)) {
      delete this.#pendingSyncStateCallbacks[peerId]
      delete this.#syncStates[peerId]
      return
    }
    const pendingCallbacks = this.#pendingSyncStateCallbacks[peerId]
    if (pendingCallbacks) {
      for (const callback of pendingCallbacks) {
        callback(syncState)
      }
    }

    delete this.#pendingSyncStateCallbacks[peerId]

    this.#syncStates[peerId] = syncState
  }
`,
  },
  {
    suffix: "/node_modules/@automerge/automerge-repo/dist/synchronizer/DocSynchronizer.js",
    oldText: `    endSync(peerId) {
        this.#log(\`removing peer \${peerId}\`);
        this.#peers = this.#peers.filter(p => p !== peerId);
        delete this.#peerDocumentStatuses[peerId];
        this.#checkDocUnavailable();
    }
`,
    newText: `    endSync(peerId) {
        this.#log(\`removing peer \${peerId}\`);
        this.#peers = this.#peers.filter(p => p !== peerId);
        delete this.#peerDocumentStatuses[peerId];
        delete this.#pendingSyncStateCallbacks[peerId];
        delete this.#syncStates[peerId];
        this.#checkDocUnavailable();
    }
`,
  },
  {
    suffix: "/node_modules/@automerge/automerge-repo/src/synchronizer/DocSynchronizer.ts",
    oldText: `  endSync(peerId: PeerId) {
    this.#log(\`removing peer \${peerId}\`)
    this.#peers = this.#peers.filter(p => p !== peerId)
    delete this.#peerDocumentStatuses[peerId]
    this.#checkDocUnavailable()
  }
`,
    newText: `  endSync(peerId: PeerId) {
    this.#log(\`removing peer \${peerId}\`)
    this.#peers = this.#peers.filter(p => p !== peerId)
    delete this.#peerDocumentStatuses[peerId]
    delete this.#pendingSyncStateCallbacks[peerId]
    delete this.#syncStates[peerId]
    this.#checkDocUnavailable()
  }
`,
  },
  {
    suffix: "/node_modules/@automerge/automerge-repo/dist/synchronizer/CollectionSynchronizer.js",
    oldText: `        delete this.docSynchronizers[documentId];
        delete this.#docSetUp[documentId];
    }
`,
    newText: `        delete this.docSynchronizers[documentId];
        delete this.#docSetUp[documentId];
        this.#hasRequested.delete(documentId);
    }
`,
  },
  {
    suffix: "/node_modules/@automerge/automerge-repo/src/synchronizer/CollectionSynchronizer.ts",
    oldText: `    delete this.docSynchronizers[documentId]
    delete this.#docSetUp[documentId]
  }
`,
    newText: `    delete this.docSynchronizers[documentId]
    delete this.#docSetUp[documentId]
    this.#hasRequested.delete(documentId)
  }
`,
  },
];

function patchFile(path, oldText, newText) {
  const source = readFileSync(path, "utf8");
  if (!source.includes(oldText)) {
    if (source.includes(newText)) return false;
    throw new Error(`patch target not found in ${path}`);
  }
  if (checkOnly) throw new Error(`required patch is not installed in ${path}`);
  writeFileSync(path, source.replaceAll(oldText, newText));
  return true;
}

let changed = 0;
const matchedPatchIndexes = new Set();
for (const base of targets) {
  const entries = execSync(
    `find ${JSON.stringify(base)} -type f \\\( -path '*/node_modules/@automerge/automerge-repo/dist/helpers/throttle.js' -o -path '*/node_modules/@automerge/automerge-repo/src/helpers/throttle.ts' -o -path '*/node_modules/@automerge/automerge-repo/dist/Repo.js' -o -path '*/node_modules/@automerge/automerge-repo/src/Repo.ts' -o -path '*/node_modules/@automerge/automerge-repo/dist/synchronizer/DocSynchronizer.js' -o -path '*/node_modules/@automerge/automerge-repo/src/synchronizer/DocSynchronizer.ts' -o -path '*/node_modules/@automerge/automerge-repo/dist/synchronizer/CollectionSynchronizer.js' -o -path '*/node_modules/@automerge/automerge-repo/src/synchronizer/CollectionSynchronizer.ts' \\\)`, {
    stdio: ["ignore", "pipe", "ignore"],
  })
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean);

  for (const entry of entries) {
    for (const [patchIndex, patch] of patches.entries()) {
      if (!entry.endsWith(patch.suffix)) continue;
      matchedPatchIndexes.add(patchIndex);
      if (patchFile(entry, patch.oldText, patch.newText)) changed += 1;
    }
  }
}

if (matchedPatchIndexes.size !== patches.length) {
  const missing = patches
    .filter((_, index) => !matchedPatchIndexes.has(index))
    .map(({ suffix }) => suffix);
  throw new Error(`Automerge Repo patch inputs are missing: ${missing.join(', ')}`);
}

console.log(`[patch-automerge-repo-throttle] ${checkOnly ? "verified" : changed > 0 ? `patched ${changed} file(s)` : "already patched"}`);
