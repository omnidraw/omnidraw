type TUuid = ReturnType<Crypto['randomUUID']>;

function hashLabel(label: string, seed: number): number {
  let hash = seed;
  for (let index = 0; index < label.length; index += 1) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function testUuid(label: string): TUuid {
  const hex = [
    hashLabel(label, 0x811c9dc5),
    hashLabel(label, 0x9e3779b9),
    hashLabel(label, 0x85ebca6b),
    hashLabel(label, 0xc2b2ae35),
  ].map((value) => value.toString(16).padStart(8, '0')).join('');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function createTestCrypto(namespace: string): Pick<Crypto, 'randomUUID'> {
  let nextId = 0;
  return {
    randomUUID: () => testUuid(`${namespace}-${nextId += 1}`),
  };
}
