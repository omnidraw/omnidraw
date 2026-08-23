function hashStream(seed: number, stream: string): number {
  let hash = seed >>> 0;
  for (let index = 0; index < stream.length; index += 1) {
    hash ^= stream.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash === 0 ? 0x9e3779b9 : hash;
}

export type TSeededRandom = Readonly<{
  nextInt(stream: string, upperExclusive: number): number;
  snapshot(): Readonly<Record<string, number>>;
}>;

export function fnCreateSeededRandom(rootSeed: number): TSeededRandom {
  if (!Number.isSafeInteger(rootSeed)) throw new TypeError('Simulation seed must be a safe integer.');
  const states = new Map<string, number>();

  return Object.freeze({
    nextInt(stream: string, upperExclusive: number): number {
      if (!Number.isSafeInteger(upperExclusive) || upperExclusive < 1) {
        throw new TypeError('Seeded choice requires a positive option count.');
      }
      let value = states.get(stream) ?? hashStream(rootSeed, stream);
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      value >>>= 0;
      states.set(stream, value);
      return value % upperExclusive;
    },
    snapshot(): Readonly<Record<string, number>> {
      return Object.freeze(Object.fromEntries([...states.entries()].sort(([left], [right]) => left.localeCompare(right))));
    },
  });
}
