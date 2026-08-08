import { describe, expect, test } from 'bun:test';
import { deflateSync } from 'node:zlib';
import {
  BOUNDED_PNG_MAX_DECODED_BYTES,
  BOUNDED_PNG_MAX_DEFLATE_BLOCKS,
  BOUNDED_PNG_MAX_DEFLATE_SYMBOLS,
  BOUNDED_PNG_MAX_DEFLATE_WORK_UNITS,
  BOUNDED_PNG_MAX_INFLATED_BYTES,
} from '../../src/image/CONSTANTS';
import {
  fnValidateBoundedPngBase64,
  fnValidateBoundedPngBytes,
} from '../../src/image/fn.png-base64';

const SYNTHETIC_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAE0lEQVR4nGP4z8DwHwwZGP6DAQBJyAn3FGMynQAAAABJRU5ErkJggg==';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngTestCrc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? 0xedb8_8320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngTestChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(chunk, 4);
  Buffer.from(data).copy(chunk, 8);
  chunk.writeUInt32BE(pngTestCrc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.byteLength);
  return chunk;
}

function pngTestAdler32(bytes: Uint8Array): number {
  let first = 1;
  let second = 0;
  for (const byte of bytes) {
    first = (first + byte) % 65_521;
    second = (second + first) % 65_521;
  }
  return ((second << 16) | first) >>> 0;
}

function pngTestStoredBlockFlood(emptyBlockCount: number, output: Uint8Array): Buffer {
  const compressed = Buffer.alloc(2 + emptyBlockCount * 5 + 5 + output.byteLength + 4);
  compressed[0] = 0x78;
  compressed[1] = 0x01;
  let offset = 2;
  for (let block = 0; block < emptyBlockCount; block += 1) {
    compressed[offset] = 0;
    compressed[offset + 3] = 0xff;
    compressed[offset + 4] = 0xff;
    offset += 5;
  }
  compressed[offset] = 1;
  compressed.writeUInt16LE(output.byteLength, offset + 1);
  compressed.writeUInt16LE(output.byteLength ^ 0xffff, offset + 3);
  Buffer.from(output).copy(compressed, offset + 5);
  compressed.writeUInt32BE(pngTestAdler32(output), offset + 5 + output.byteLength);
  return compressed;
}

function pngTestImage(args: Readonly<{
  width: number;
  height: number;
  scanlines?: Uint8Array;
  compressed?: Uint8Array;
  bitDepth?: number;
  colorType?: number;
  palette?: Uint8Array;
  interlaceMethod?: 0 | 1;
  splitIdatAt?: number;
}>): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(args.width, 0);
  ihdr.writeUInt32BE(args.height, 4);
  ihdr[8] = args.bitDepth ?? 8;
  ihdr[9] = args.colorType ?? 6;
  ihdr[12] = args.interlaceMethod ?? 0;
  const compressed = Buffer.from(args.compressed ?? deflateSync(args.scanlines ?? new Uint8Array(0)));
  const idatChunks = args.splitIdatAt === undefined
    ? [pngTestChunk('IDAT', compressed)]
    : [
      pngTestChunk('IDAT', compressed.subarray(0, args.splitIdatAt)),
      pngTestChunk('IDAT', compressed.subarray(args.splitIdatAt)),
    ];
  return Buffer.concat([
    PNG_SIGNATURE,
    pngTestChunk('IHDR', ihdr),
    ...(args.palette === undefined ? [] : [pngTestChunk('PLTE', args.palette)]),
    ...idatChunks,
    pngTestChunk('IEND', new Uint8Array(0)),
  ]);
}

function withChangedByte(offset: number, value: number): string {
  const bytes = Buffer.from(SYNTHETIC_PNG_BASE64, 'base64');
  bytes[offset] = value;
  return bytes.toString('base64');
}

describe('bounded PNG base64 validation', () => {
  test('records the 8 MiB ceiling and reads deterministic PNG metadata', () => {
    expect(BOUNDED_PNG_MAX_DECODED_BYTES).toBe(8 * 1024 * 1024);
    expect(BOUNDED_PNG_MAX_INFLATED_BYTES).toBe(64 * 1024 * 1024);
    expect(BOUNDED_PNG_MAX_DEFLATE_BLOCKS).toBe(65_536);
    expect(BOUNDED_PNG_MAX_DEFLATE_SYMBOLS).toBe(16 * 1024 * 1024);
    expect(BOUNDED_PNG_MAX_DEFLATE_WORK_UNITS).toBe(96 * 1024 * 1024);
    expect(fnValidateBoundedPngBase64({
      mimeType: 'image/png',
      data: SYNTHETIC_PNG_BASE64,
    })).toEqual({
      ok: true,
      metadata: {
        mimeType: 'image/png',
        byteSize: 76,
        width: 2,
        height: 2,
      },
    });
    expect(fnValidateBoundedPngBytes(Buffer.from(SYNTHETIC_PNG_BASE64, 'base64')))
      .toMatchObject({ ok: true, metadata: { width: 2, height: 2 } });
  });

  test('decodes stored and split IDAT streams, including Adam7 scanlines', () => {
    const scanline = Buffer.from([0, 0x12, 0x34, 0x56, 0xff]);
    const stored = deflateSync(scanline, { level: 0 });
    expect(fnValidateBoundedPngBytes(pngTestImage({
      width: 1,
      height: 1,
      compressed: stored,
      splitIdatAt: 3,
    }))).toMatchObject({ ok: true, metadata: { width: 1, height: 1 } });
    expect(fnValidateBoundedPngBytes(pngTestImage({
      width: 1,
      height: 1,
      scanlines: scanline,
      interlaceMethod: 1,
    }))).toMatchObject({ ok: true, metadata: { width: 1, height: 1 } });
    expect(fnValidateBoundedPngBytes(pngTestImage({
      width: 3,
      height: 3,
      scanlines: Buffer.alloc(42),
      interlaceMethod: 1,
    }))).toMatchObject({ ok: true, metadata: { width: 3, height: 3 } });
  });

  test('accepts scanline widths for every supported PNG color family', () => {
    const cases = [
      { width: 9, bitDepth: 1, colorType: 0, rowBytes: 2 },
      { width: 1, bitDepth: 16, colorType: 2, rowBytes: 6 },
      {
        width: 3,
        bitDepth: 4,
        colorType: 3,
        rowBytes: 2,
        palette: Buffer.from([0, 0, 0, 0xff, 0xff, 0xff]),
      },
      { width: 1, bitDepth: 16, colorType: 4, rowBytes: 4 },
      { width: 1, bitDepth: 16, colorType: 6, rowBytes: 8 },
    ] as const;
    for (const testCase of cases) {
      expect(fnValidateBoundedPngBytes(pngTestImage({
        width: testCase.width,
        height: 1,
        bitDepth: testCase.bitDepth,
        colorType: testCase.colorType,
        palette: 'palette' in testCase ? testCase.palette : undefined,
        scanlines: Buffer.alloc(testCase.rowBytes + 1),
      }))).toMatchObject({ ok: true, metadata: { width: testCase.width, height: 1 } });
    }
  });

  test('rejects out-of-range packed palette indices after filters and across Adam7', () => {
    const oneEntryPalette = Buffer.from([0, 0, 0]);
    for (const testCase of [
      { bitDepth: 1, packedIndex: 0x80 },
      { bitDepth: 2, packedIndex: 0x40 },
      { bitDepth: 4, packedIndex: 0x10 },
    ] as const) {
      expect(fnValidateBoundedPngBytes(pngTestImage({
        width: 1,
        height: 1,
        bitDepth: testCase.bitDepth,
        colorType: 3,
        palette: oneEntryPalette,
        scanlines: Buffer.from([0, testCase.packedIndex]),
      }))).toEqual({ ok: false, reason: 'invalid-png-structure' });
    }

    // Both stored bytes contain the legal index 1, but the second row's Up
    // filter reconstructs 0x10 + 0x10 to the out-of-range index 2.
    expect(fnValidateBoundedPngBytes(pngTestImage({
      width: 1,
      height: 2,
      bitDepth: 4,
      colorType: 3,
      palette: Buffer.from([0, 0, 0, 0xff, 0xff, 0xff]),
      scanlines: Buffer.from([0, 0x10, 2, 0x10]),
    }))).toEqual({ ok: false, reason: 'invalid-png-structure' });

    expect(fnValidateBoundedPngBytes(pngTestImage({
      width: 3,
      height: 3,
      bitDepth: 1,
      colorType: 3,
      palette: oneEntryPalette,
      scanlines: Buffer.alloc(12),
      interlaceMethod: 1,
    }))).toMatchObject({ ok: true, metadata: { width: 3, height: 3 } });

    const adam7Scanlines = Buffer.alloc(12);
    adam7Scanlines[11] = 0x80;
    expect(fnValidateBoundedPngBytes(pngTestImage({
      width: 3,
      height: 3,
      bitDepth: 1,
      colorType: 3,
      palette: oneEntryPalette,
      scanlines: adam7Scanlines,
      interlaceMethod: 1,
    }))).toEqual({ ok: false, reason: 'invalid-png-structure' });
  });

  test('reconstructs every PNG row filter before validating palette samples', () => {
    const threeEntryPalette = Buffer.from([
      0, 0, 0,
      0x7f, 0x7f, 0x7f,
      0xff, 0xff, 0xff,
    ]);
    expect(fnValidateBoundedPngBytes(pngTestImage({
      width: 3,
      height: 5,
      bitDepth: 4,
      colorType: 3,
      palette: threeEntryPalette,
      scanlines: Buffer.from([
        0, 0x10, 0x10,
        1, 0x10, 0x10,
        2, 0x10, 0xf0,
        3, 0x10, 0x08,
        4, 0xf0, 0x10,
      ]),
    }))).toMatchObject({ ok: true, metadata: { width: 3, height: 5 } });
  });

  test('decodes a dynamic-Huffman zlib stream', () => {
    const width = 16;
    const height = 16;
    const rowByteLength = 1 + width * 4;
    const scanlines = Buffer.alloc(height * rowByteLength);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = y * rowByteLength + 1 + x * 4;
        scanlines[offset] = (x * 17 + y * 3) & 0xff;
        scanlines[offset + 1] = (x * 5 + y * 11) & 0xff;
        scanlines[offset + 2] = (x ^ y) & 0xff;
        scanlines[offset + 3] = 0xff;
      }
    }
    const compressed = deflateSync(scanlines);
    expect(((compressed[2] ?? 0) >>> 1) & 0b11).toBe(0b10);
    expect(fnValidateBoundedPngBytes(pngTestImage({
      width,
      height,
      compressed,
      splitIdatAt: 101,
    }))).toMatchObject({ ok: true, metadata: { width, height } });
  });

  test('rejects unsupported MIME, malformed input, and non-canonical padding bits', () => {
    expect(fnValidateBoundedPngBase64({
      mimeType: 'image/jpeg',
      data: SYNTHETIC_PNG_BASE64,
    })).toEqual({ ok: false, reason: 'unsupported-mime-type' });
    expect(fnValidateBoundedPngBase64({ mimeType: 'image/png', data: 'not base64' }))
      .toEqual({ ok: false, reason: 'invalid-base64' });
    expect(fnValidateBoundedPngBase64({ mimeType: 'image/png', data: 'AB==' }))
      .toEqual({ ok: false, reason: 'invalid-base64' });
  });

  test('rejects PNG signature, first-IHDR, and dimension violations', () => {
    expect(fnValidateBoundedPngBase64({ mimeType: 'image/png', data: withChangedByte(0, 0) }))
      .toEqual({ ok: false, reason: 'invalid-png-signature' });
    expect(fnValidateBoundedPngBase64({ mimeType: 'image/png', data: withChangedByte(11, 12) }))
      .toEqual({ ok: false, reason: 'invalid-ihdr' });
    expect(fnValidateBoundedPngBase64({ mimeType: 'image/png', data: withChangedByte(12, 0x4a) }))
      .toEqual({ ok: false, reason: 'invalid-ihdr' });
    expect(fnValidateBoundedPngBase64({ mimeType: 'image/png', data: withChangedByte(19, 0) }))
      .toEqual({ ok: false, reason: 'invalid-dimensions' });
  });

  test('rejects encoded data beyond the decoded byte ceiling before decoding', () => {
    const oversized = 'A'.repeat(Math.ceil(BOUNDED_PNG_MAX_DECODED_BYTES / 3) * 4 + 4);
    expect(fnValidateBoundedPngBase64({ mimeType: 'image/png', data: oversized }))
      .toEqual({ ok: false, reason: 'oversized' });
  });

  test('rejects truncated chunks, bad CRCs, missing IDAT/IEND, and trailing bytes', () => {
    const bytes = Buffer.from(SYNTHETIC_PNG_BASE64, 'base64');
    expect(fnValidateBoundedPngBytes(bytes.subarray(0, 40)))
      .toEqual({ ok: false, reason: 'invalid-png-structure' });

    const badCrc = Buffer.from(bytes);
    badCrc[32] = (badCrc[32] ?? 0) ^ 1;
    expect(fnValidateBoundedPngBytes(badCrc))
      .toEqual({ ok: false, reason: 'invalid-png-crc' });

    const withoutIdat = Buffer.concat([bytes.subarray(0, 33), bytes.subarray(63)]);
    expect(fnValidateBoundedPngBytes(withoutIdat))
      .toEqual({ ok: false, reason: 'invalid-png-structure' });

    expect(fnValidateBoundedPngBytes(bytes.subarray(0, 63)))
      .toEqual({ ok: false, reason: 'invalid-png-structure' });
    expect(fnValidateBoundedPngBytes(Buffer.concat([bytes, Buffer.from([0])])))
      .toEqual({ ok: false, reason: 'invalid-png-structure' });
  });

  test('rejects empty IDAT and invalid DEFLATE data even when chunk CRCs are valid', () => {
    expect(fnValidateBoundedPngBytes(pngTestImage({
      width: 1,
      height: 1,
      compressed: new Uint8Array(0),
    }))).toEqual({ ok: false, reason: 'invalid-png-structure' });

    // 0x78 0x01 is a valid zlib header; the final DEFLATE block uses the
    // reserved block type, and the remaining bytes are a nominal Adler-32.
    expect(fnValidateBoundedPngBytes(pngTestImage({
      width: 1,
      height: 1,
      compressed: Buffer.from([0x78, 0x01, 0x07, 0, 0, 0, 1]),
    }))).toEqual({ ok: false, reason: 'invalid-png-structure' });

    const badAdler = Buffer.from(deflateSync(Buffer.from([0, 0x12, 0x34, 0x56, 0xff])));
    badAdler[badAdler.byteLength - 1] = (badAdler[badAdler.byteLength - 1] ?? 0) ^ 1;
    expect(fnValidateBoundedPngBytes(pngTestImage({
      width: 1,
      height: 1,
      compressed: badAdler,
    }))).toEqual({ ok: false, reason: 'invalid-png-structure' });
  });

  test('rejects decoded scanlines that are truncated or use an unknown filter', () => {
    expect(fnValidateBoundedPngBytes(pngTestImage({
      width: 2,
      height: 1,
      scanlines: Buffer.from([0, 0x12, 0x34, 0x56, 0xff]),
    }))).toEqual({ ok: false, reason: 'invalid-png-structure' });

    expect(fnValidateBoundedPngBytes(pngTestImage({
      width: 1,
      height: 1,
      scanlines: Buffer.from([5, 0x12, 0x34, 0x56, 0xff]),
    }))).toEqual({ ok: false, reason: 'invalid-png-structure' });

    expect(fnValidateBoundedPngBytes(pngTestImage({
      width: 1,
      height: 1,
      scanlines: Buffer.from([0, 0x12, 0x34, 0x56, 0xff, 0]),
    }))).toEqual({ ok: false, reason: 'invalid-png-structure' });
  });

  test('rejects declared scanline data beyond the bounded inflate ceiling', () => {
    expect(fnValidateBoundedPngBytes(pngTestImage({
      width: 4_096,
      height: 4_096,
      scanlines: Buffer.from([0]),
    }))).toEqual({ ok: false, reason: 'oversized' });
  });

  test('rejects a syntactically valid DEFLATE stream beyond the block budget', () => {
    const scanline = Buffer.from([0, 0, 0, 0, 0]);
    expect(fnValidateBoundedPngBytes(pngTestImage({
      width: 1,
      height: 1,
      compressed: pngTestStoredBlockFlood(BOUNDED_PNG_MAX_DEFLATE_BLOCKS, scanline),
    }))).toEqual({ ok: false, reason: 'invalid-png-structure' });
  });
});
