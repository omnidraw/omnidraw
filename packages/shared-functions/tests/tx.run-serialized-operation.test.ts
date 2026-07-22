import { describe, expect, test } from 'bun:test';
import { txRunSerializedOperation } from '../src/tx.run-serialized-operation';

function deferred(): Readonly<{ promise: Promise<void>; resolve: () => void }> {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe('txRunSerializedOperation', () => {
  test('allows same-scope nested work but queues unrelated async contexts', async () => {
    const scope = {};
    const entered = deferred();
    const release = deferred();
    const events: string[] = [];
    const first = txRunSerializedOperation({ scope }, {
      operation: async () => {
        events.push('outer');
        await txRunSerializedOperation({ scope }, {
          operation: async () => { events.push('nested'); },
        });
        entered.resolve();
        await release.promise;
        events.push('released');
      },
    });
    await entered.promise;

    let secondSettled = false;
    const second = txRunSerializedOperation({ scope }, {
      operation: async () => { events.push('second'); },
    }).finally(() => { secondSettled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(secondSettled).toBe(false);
    expect(events).toEqual(['outer', 'nested']);

    release.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(['outer', 'nested', 'released', 'second']);
  });

  test('does not poison the next operation after rejection', async () => {
    const scope = {};
    await expect(txRunSerializedOperation({ scope }, {
      operation: async () => { throw new Error('expected failure'); },
    })).rejects.toThrow('expected failure');
    await expect(txRunSerializedOperation({ scope }, {
      operation: async () => 'recovered',
    })).resolves.toBe('recovered');
  });

  test('expires inherited ownership after the owning operation completes', async () => {
    const scope = {};
    const triggerInheritedWork = deferred();
    const blockerEntered = deferred();
    const releaseBlocker = deferred();
    let inheritedWork!: Promise<void>;
    let inheritedSettled = false;
    await txRunSerializedOperation({ scope }, {
      operation: async () => {
        inheritedWork = triggerInheritedWork.promise.then(() => (
          txRunSerializedOperation({ scope }, {
            operation: async () => undefined,
          }).finally(() => { inheritedSettled = true; })
        ));
      },
    });

    const blocker = txRunSerializedOperation({ scope }, {
      operation: async () => {
        blockerEntered.resolve();
        await releaseBlocker.promise;
      },
    });
    await blockerEntered.promise;
    triggerInheritedWork.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(inheritedSettled).toBe(false);

    releaseBlocker.resolve();
    await Promise.all([blocker, inheritedWork]);
    expect(inheritedSettled).toBe(true);
  });
});
