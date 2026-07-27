import { describe, expect, test } from 'bun:test';
import {
  NetworkAdapter,
  Repo,
  type PeerId,
  type PeerMetadata,
} from '@automerge/automerge-repo';

class ControlledNetworkAdapter extends NetworkAdapter {
  isReady(): boolean {
    return true;
  }

  whenReady(): Promise<void> {
    return Promise.resolve();
  }

  connect(peerId: PeerId, peerMetadata?: PeerMetadata): void {
    this.peerId = peerId;
    this.peerMetadata = peerMetadata;
  }

  send(): void {}

  disconnect(): void {}

  join(peerId: PeerId, peerMetadata: PeerMetadata): void {
    this.emit('peer-candidate', { peerId, peerMetadata });
  }

  leave(peerId: PeerId): void {
    this.emit('peer-disconnected', { peerId });
  }
}

describe('pinned Automerge Repo lifecycle cleanup', () => {
  test('does not retain metadata for disconnected peer churn', async () => {
    const network = new ControlledNetworkAdapter();
    const repo = new Repo({
      isEphemeral: true,
      network: [network],
      peerId: 'server-peer' as PeerId,
    });

    try {
      for (let index = 0; index < 2_048; index += 1) {
        const peerId = `peer-${index}` as PeerId;
        network.join(peerId, {
          isEphemeral: false,
          storageId: `storage-${index}`,
        });
        expect(repo.peerMetadataByPeerId[peerId]?.storageId).toBe(`storage-${index}`);
        network.leave(peerId);
      }

      expect(repo.peers).toEqual([]);
      expect(repo.peerMetadataByPeerId).toEqual({});
    } finally {
      await repo.shutdown();
    }
  });

  test('accepts a clean reconnect after peer cleanup', async () => {
    const network = new ControlledNetworkAdapter();
    const repo = new Repo({
      isEphemeral: true,
      network: [network],
      peerId: 'server-reconnect' as PeerId,
    });
    const peerId = 'reconnecting-peer' as PeerId;

    try {
      network.join(peerId, { storageId: 'storage-before' });
      expect(repo.peers).toEqual([peerId]);
      network.leave(peerId);
      expect(repo.peers).toEqual([]);
      expect(repo.peerMetadataByPeerId[peerId]).toBeUndefined();

      network.join(peerId, { storageId: 'storage-after' });
      expect(repo.peers).toEqual([peerId]);
      expect(repo.peerMetadataByPeerId[peerId]?.storageId).toBe('storage-after');
      network.leave(peerId);
      expect(repo.peerMetadataByPeerId).toEqual({});
    } finally {
      await repo.shutdown();
    }
  });
});
