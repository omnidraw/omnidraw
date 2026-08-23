import {
  BOUNDED_PNG_MAX_DECODED_BYTES,
  BOUNDED_PNG_MAX_DEFLATE_BLOCKS,
  BOUNDED_PNG_MAX_DEFLATE_SYMBOLS,
  BOUNDED_PNG_MAX_DEFLATE_WORK_UNITS,
  BOUNDED_PNG_MAX_INFLATED_BYTES,
} from './CONSTANTS';

export type TPngBase64Metadata = Readonly<{
  mimeType: 'image/png';
  byteSize: number;
  width: number;
  height: number;
}>;

export type TPngValidationReason =
  | 'invalid-base64'
  | 'invalid-dimensions'
  | 'invalid-ihdr'
  | 'invalid-png-crc'
  | 'invalid-png-signature'
  | 'invalid-png-structure'
  | 'oversized'
  | 'unsupported-mime-type';

export type TPngBase64Validation =
  | Readonly<{ ok: true; metadata: TPngBase64Metadata }>
  | Readonly<{
    ok: false;
    reason: TPngValidationReason;
  }>;

export type TPngBytesValidation =
  | Readonly<{ ok: true; metadata: TPngBase64Metadata }>
  | Readonly<{
    ok: false;
    reason: Exclude<TPngValidationReason, 'invalid-base64' | 'unsupported-mime-type'>;
  }>;

export type TValidateBoundedPngBase64 = Readonly<{
  mimeType: unknown;
  data: unknown;
}>;

function fnBase64Sextet(characterCode: number): number {
  if (characterCode >= 65 && characterCode <= 90) return characterCode - 65;
  if (characterCode >= 97 && characterCode <= 122) return characterCode - 71;
  if (characterCode >= 48 && characterCode <= 57) return characterCode + 4;
  if (characterCode === 43) return 62;
  if (characterCode === 47) return 63;
  return -1;
}

function fnHasCanonicalPaddingBits(data: string, paddingLength: number): boolean {
  if (paddingLength === 2) {
    return (fnBase64Sextet(data.charCodeAt(data.length - 3)) & 0b1111) === 0;
  }
  if (paddingLength === 1) {
    return (fnBase64Sextet(data.charCodeAt(data.length - 2)) & 0b11) === 0;
  }
  return true;
}

function fnIsCanonicalBase64(data: string, paddingLength: number): boolean {
  const contentLength = data.length - paddingLength;
  for (let index = 0; index < contentLength; index += 1) {
    if (fnBase64Sextet(data.charCodeAt(index)) < 0) return false;
  }
  for (let index = contentLength; index < data.length; index += 1) {
    if (data.charCodeAt(index) !== 61) return false;
  }
  return fnHasCanonicalPaddingBits(data, paddingLength);
}

function fnDecodeBase64(data: string, byteLength: number): Uint8Array {
  const decoded = new Uint8Array(byteLength);
  let decodedIndex = 0;

  for (let encodedIndex = 0; encodedIndex < data.length && decodedIndex < byteLength; encodedIndex += 4) {
    const first = fnBase64Sextet(data.charCodeAt(encodedIndex));
    const second = fnBase64Sextet(data.charCodeAt(encodedIndex + 1));
    const third = data.charCodeAt(encodedIndex + 2) === 61
      ? 0
      : fnBase64Sextet(data.charCodeAt(encodedIndex + 2));
    const fourth = data.charCodeAt(encodedIndex + 3) === 61
      ? 0
      : fnBase64Sextet(data.charCodeAt(encodedIndex + 3));

    decoded[decodedIndex] = (first << 2) | (second >> 4);
    decodedIndex += 1;
    if (decodedIndex < byteLength) {
      decoded[decodedIndex] = ((second & 0b1111) << 4) | (third >> 2);
      decodedIndex += 1;
    }
    if (decodedIndex < byteLength) {
      decoded[decodedIndex] = ((third & 0b11) << 6) | fourth;
      decodedIndex += 1;
    }
  }

  return decoded;
}

function fnReadUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) * 0x1000000
    + (bytes[offset + 1] ?? 0) * 0x10000
    + (bytes[offset + 2] ?? 0) * 0x100
    + (bytes[offset + 3] ?? 0);
}

function fnHasPngSignature(bytes: Uint8Array): boolean {
  return bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a;
}

function fnChunkTypeEquals(bytes: Uint8Array, offset: number, type: string): boolean {
  return bytes[offset] === type.charCodeAt(0)
    && bytes[offset + 1] === type.charCodeAt(1)
    && bytes[offset + 2] === type.charCodeAt(2)
    && bytes[offset + 3] === type.charCodeAt(3);
}

function fnHasValidChunkType(bytes: Uint8Array, offset: number): boolean {
  for (let index = 0; index < 4; index += 1) {
    const value = bytes[offset + index] ?? 0;
    const isLetter = (value >= 65 && value <= 90) || (value >= 97 && value <= 122);
    if (!isLetter) return false;
  }
  return ((bytes[offset + 2] ?? 0) & 0x20) === 0;
}

function fnCreateCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1
        ? 0xedb88320 ^ (value >>> 1)
        : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC32_TABLE = fnCreateCrc32Table();

function fnCrc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = (crc >>> 8) ^ (CRC32_TABLE[(crc ^ (bytes[index] ?? 0)) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function fnHasValidIhdrFields(bytes: Uint8Array): boolean {
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const validDepth = (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth ?? -1))
    || (colorType === 2 && [8, 16].includes(bitDepth ?? -1))
    || (colorType === 3 && [1, 2, 4, 8].includes(bitDepth ?? -1))
    || (colorType === 4 && [8, 16].includes(bitDepth ?? -1))
    || (colorType === 6 && [8, 16].includes(bitDepth ?? -1));

  return validDepth
    && bytes[26] === 0
    && bytes[27] === 0
    && (bytes[28] === 0 || bytes[28] === 1);
}

type TPngHeader = Readonly<{
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlaceMethod: 0 | 1;
}>;

type TPngScanlinePlan = Readonly<{
  rowByteLengths: ReadonlyArray<number>;
  rowCounts: ReadonlyArray<number>;
  sampleCounts: ReadonlyArray<number>;
  totalByteLength: number;
}>;

type TDeflateBudget = {
  blocksRemaining: number;
  symbolsRemaining: number;
  workRemaining: number;
};

type TBitReader = {
  readonly bytes: Uint8Array;
  readonly budget: TDeflateBudget;
  readonly endOffset: number;
  offset: number;
  bitBuffer: number;
  bitCount: number;
};

type THuffman = Readonly<{
  counts: Uint16Array;
  symbols: Uint16Array;
  maximumLength: number;
  empty: boolean;
}>;

type TInflateOutput = {
  readonly budget: TDeflateBudget;
  readonly history: Uint8Array;
  readonly plan: TPngScanlinePlan;
  readonly indexed: TIndexedInflateOutput | undefined;
  produced: number;
  adlerA: number;
  adlerB: number;
  passIndex: number;
  rowsRemaining: number;
  scanlineBytesRemaining: number;
  expectsFilter: boolean;
  complete: boolean;
};

type TIndexedInflateOutput = {
  readonly bitDepth: number;
  readonly paletteEntryCount: number;
  readonly previousRow: Uint8Array;
  filterType: number;
  byteIndex: number;
  samplesRemaining: number;
  left: number;
  upperLeft: number;
};

const ADAM7_X_START = [0, 4, 0, 2, 0, 1, 0] as const;
const ADAM7_Y_START = [0, 0, 4, 0, 2, 0, 1] as const;
const ADAM7_X_STEP = [8, 8, 4, 4, 2, 2, 1] as const;
const ADAM7_Y_STEP = [8, 8, 8, 4, 4, 2, 2] as const;

const DEFLATE_LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10,
  11, 13, 15, 17, 19, 23, 27, 31,
  35, 43, 51, 59, 67, 83, 99, 115,
  131, 163, 195, 227, 258,
] as const;

const DEFLATE_LENGTH_EXTRA_BITS = [
  0, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 2, 2, 2, 2,
  3, 3, 3, 3, 4, 4, 4, 4,
  5, 5, 5, 5, 0,
] as const;

const DEFLATE_DISTANCE_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13,
  17, 25, 33, 49, 65, 97, 129, 193,
  257, 385, 513, 769, 1_025, 1_537, 2_049, 3_073,
  4_097, 6_145, 8_193, 12_289, 16_385, 24_577,
] as const;

const DEFLATE_DISTANCE_EXTRA_BITS = [
  0, 0, 0, 0, 1, 1, 2, 2,
  3, 3, 4, 4, 5, 5, 6, 6,
  7, 7, 8, 8, 9, 9, 10, 10,
  11, 11, 12, 12, 13, 13,
] as const;

const DEFLATE_CODE_LENGTH_ORDER = [
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
] as const;

function fnPngChannelCount(colorType: number): number {
  if (colorType === 0 || colorType === 3) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  return 0;
}

function fnAdam7PassDimension(size: number, start: number, step: number): number {
  if (size <= start) return 0;
  return Math.floor((size - start + step - 1) / step);
}

function fnCreatePngScanlinePlan(header: TPngHeader): TPngScanlinePlan | undefined {
  const bitsPerPixel = fnPngChannelCount(header.colorType) * header.bitDepth;
  if (bitsPerPixel === 0) return undefined;

  const rowByteLengths: number[] = [];
  const rowCounts: number[] = [];
  const sampleCounts: number[] = [];
  const passCount = header.interlaceMethod === 0 ? 1 : 7;
  let totalByteLength = 0;

  for (let passIndex = 0; passIndex < passCount; passIndex += 1) {
    const passWidth = header.interlaceMethod === 0
      ? header.width
      : fnAdam7PassDimension(
        header.width,
        ADAM7_X_START[passIndex] ?? 0,
        ADAM7_X_STEP[passIndex] ?? 1,
      );
    const passHeight = header.interlaceMethod === 0
      ? header.height
      : fnAdam7PassDimension(
        header.height,
        ADAM7_Y_START[passIndex] ?? 0,
        ADAM7_Y_STEP[passIndex] ?? 1,
      );
    if (passWidth === 0 || passHeight === 0) continue;

    const rowByteLength = Math.ceil((passWidth * bitsPerPixel) / 8);
    const filteredRowByteLength = rowByteLength + 1;
    const remainingCapacity = BOUNDED_PNG_MAX_INFLATED_BYTES - totalByteLength;
    if (
      filteredRowByteLength > BOUNDED_PNG_MAX_INFLATED_BYTES
      || passHeight > Math.floor(remainingCapacity / filteredRowByteLength)
    ) return undefined;

    rowByteLengths.push(rowByteLength);
    rowCounts.push(passHeight);
    sampleCounts.push(passWidth);
    totalByteLength += filteredRowByteLength * passHeight;
  }

  if (totalByteLength === 0) return undefined;
  return { rowByteLengths, rowCounts, sampleCounts, totalByteLength };
}

function fnSpendDeflateWork(budget: TDeflateBudget, count: number): boolean {
  if (count < 0 || count > budget.workRemaining) return false;
  budget.workRemaining -= count;
  return true;
}

function fnReadBits(reader: TBitReader, count: number): number | undefined {
  if (!fnSpendDeflateWork(reader.budget, count)) return undefined;
  while (reader.bitCount < count) {
    if (reader.offset >= reader.endOffset) return undefined;
    reader.bitBuffer |= (reader.bytes[reader.offset] ?? 0) << reader.bitCount;
    reader.offset += 1;
    reader.bitCount += 8;
  }
  const mask = (1 << count) - 1;
  const value = reader.bitBuffer & mask;
  reader.bitBuffer >>>= count;
  reader.bitCount -= count;
  return value;
}

function fnAlignBitReader(reader: TBitReader): void {
  reader.bitBuffer = 0;
  reader.bitCount = 0;
}

function fnBuildHuffman(
  lengths: Uint8Array,
  allowEmpty: boolean,
  allowIncompleteSingle: boolean,
): THuffman | undefined {
  const counts = new Uint16Array(16);
  let symbolCount = 0;
  let maximumLength = 0;
  for (const length of lengths) {
    if (length > 15) return undefined;
    counts[length] = (counts[length] ?? 0) + 1;
    if (length > 0) {
      symbolCount += 1;
      maximumLength = Math.max(maximumLength, length);
    }
  }

  if (symbolCount === 0) {
    if (!allowEmpty) return undefined;
    return {
      counts,
      symbols: new Uint16Array(0),
      maximumLength: 0,
      empty: true,
    };
  }

  let codesRemaining = 1;
  for (let length = 1; length <= 15; length += 1) {
    codesRemaining = (codesRemaining << 1) - (counts[length] ?? 0);
    if (codesRemaining < 0) return undefined;
  }
  if (
    codesRemaining > 0
    && !(allowIncompleteSingle && symbolCount === 1 && maximumLength === 1)
  ) return undefined;

  const offsets = new Uint16Array(16);
  for (let length = 1; length < 15; length += 1) {
    offsets[length + 1] = (offsets[length] ?? 0) + (counts[length] ?? 0);
  }
  const symbols = new Uint16Array(symbolCount);
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol] ?? 0;
    if (length === 0) continue;
    const destination = offsets[length] ?? 0;
    symbols[destination] = symbol;
    offsets[length] = destination + 1;
  }

  return { counts, symbols, maximumLength, empty: false };
}

function fnDecodeHuffman(reader: TBitReader, huffman: THuffman): number | undefined {
  if (huffman.empty) return undefined;
  if (reader.budget.symbolsRemaining < 1 || !fnSpendDeflateWork(reader.budget, 1)) {
    return undefined;
  }
  reader.budget.symbolsRemaining -= 1;
  let code = 0;
  let firstCode = 0;
  let symbolOffset = 0;
  for (let length = 1; length <= huffman.maximumLength; length += 1) {
    const bit = fnReadBits(reader, 1);
    if (bit === undefined) return undefined;
    code |= bit;
    const count = huffman.counts[length] ?? 0;
    if (code >= firstCode && code < firstCode + count) {
      return huffman.symbols[symbolOffset + code - firstCode];
    }
    symbolOffset += count;
    firstCode = (firstCode + count) << 1;
    code <<= 1;
  }
  return undefined;
}

function fnAdvancePngPass(output: TInflateOutput): void {
  while (output.passIndex < output.plan.rowCounts.length) {
    const rowCount = output.plan.rowCounts[output.passIndex] ?? 0;
    if (rowCount > 0) {
      output.rowsRemaining = rowCount;
      output.expectsFilter = true;
      output.scanlineBytesRemaining = 0;
      if (output.indexed !== undefined) {
        const rowByteLength = output.plan.rowByteLengths[output.passIndex] ?? 0;
        output.indexed.previousRow.fill(0, 0, rowByteLength);
        output.indexed.filterType = 0;
        output.indexed.byteIndex = 0;
        output.indexed.samplesRemaining = output.plan.sampleCounts[output.passIndex] ?? 0;
        output.indexed.left = 0;
        output.indexed.upperLeft = 0;
      }
      return;
    }
    output.passIndex += 1;
  }
  output.complete = true;
  output.rowsRemaining = 0;
  output.scanlineBytesRemaining = 0;
  output.expectsFilter = false;
}

function fnPaethPredictor(left: number, above: number, upperLeft: number): number {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function fnValidateIndexedInflatedByte(
  output: TInflateOutput,
  filteredValue: number,
): boolean {
  const indexed = output.indexed;
  if (indexed === undefined) return true;
  const above = indexed.previousRow[indexed.byteIndex] ?? 0;
  const reconstructed = (
    indexed.filterType === 0
      ? filteredValue
      : indexed.filterType === 1
        ? filteredValue + indexed.left
        : indexed.filterType === 2
          ? filteredValue + above
          : indexed.filterType === 3
            ? filteredValue + Math.floor((indexed.left + above) / 2)
            : filteredValue + fnPaethPredictor(indexed.left, above, indexed.upperLeft)
  ) & 0xff;
  indexed.previousRow[indexed.byteIndex] = reconstructed;
  indexed.byteIndex += 1;
  indexed.left = reconstructed;
  indexed.upperLeft = above;

  const samplesPerByte = 8 / indexed.bitDepth;
  const sampleMask = (1 << indexed.bitDepth) - 1;
  const samplesToValidate = Math.min(indexed.samplesRemaining, samplesPerByte);
  if (!fnSpendDeflateWork(output.budget, samplesToValidate)) return false;
  for (let sampleIndex = 0; sampleIndex < samplesToValidate; sampleIndex += 1) {
    const shift = 8 - indexed.bitDepth * (sampleIndex + 1);
    const paletteIndex = (reconstructed >>> shift) & sampleMask;
    if (paletteIndex >= indexed.paletteEntryCount) return false;
  }
  indexed.samplesRemaining -= samplesToValidate;
  return true;
}

function fnWriteInflatedByte(output: TInflateOutput, value: number): boolean {
  if (
    output.complete
    || output.produced >= output.plan.totalByteLength
    || !fnSpendDeflateWork(output.budget, 1)
  ) return false;
  if (output.expectsFilter) {
    if (value < 0 || value > 4) return false;
    output.expectsFilter = false;
    output.scanlineBytesRemaining = output.plan.rowByteLengths[output.passIndex] ?? 0;
    if (output.indexed !== undefined) {
      output.indexed.filterType = value;
      output.indexed.byteIndex = 0;
      output.indexed.samplesRemaining = output.plan.sampleCounts[output.passIndex] ?? 0;
      output.indexed.left = 0;
      output.indexed.upperLeft = 0;
    }
  } else {
    if (!fnValidateIndexedInflatedByte(output, value)) return false;
    output.scanlineBytesRemaining -= 1;
    if (output.scanlineBytesRemaining === 0) {
      if (output.indexed !== undefined && output.indexed.samplesRemaining !== 0) return false;
      output.rowsRemaining -= 1;
      if (output.rowsRemaining > 0) {
        output.expectsFilter = true;
      } else {
        output.passIndex += 1;
        fnAdvancePngPass(output);
      }
    }
  }

  output.history[output.produced & 0x7fff] = value;
  output.produced += 1;
  output.adlerA += value;
  if (output.adlerA >= 65_521) output.adlerA -= 65_521;
  output.adlerB += output.adlerA;
  if (output.adlerB >= 65_521) output.adlerB -= 65_521;
  return true;
}

function fnCreateFixedHuffman(): Readonly<{
  literalLength: THuffman;
  distance: THuffman;
}> | undefined {
  const literalLengthCodeLengths = new Uint8Array(288);
  literalLengthCodeLengths.fill(8, 0, 144);
  literalLengthCodeLengths.fill(9, 144, 256);
  literalLengthCodeLengths.fill(7, 256, 280);
  literalLengthCodeLengths.fill(8, 280);
  const distanceCodeLengths = new Uint8Array(32);
  distanceCodeLengths.fill(5);
  const literalLength = fnBuildHuffman(literalLengthCodeLengths, false, false);
  const distance = fnBuildHuffman(distanceCodeLengths, false, false);
  if (literalLength === undefined || distance === undefined) return undefined;
  return { literalLength, distance };
}

function fnReadDynamicHuffman(reader: TBitReader): Readonly<{
  literalLength: THuffman;
  distance: THuffman;
}> | undefined {
  const literalLengthCountBits = fnReadBits(reader, 5);
  const distanceCountBits = fnReadBits(reader, 5);
  const codeLengthCountBits = fnReadBits(reader, 4);
  if (
    literalLengthCountBits === undefined
    || distanceCountBits === undefined
    || codeLengthCountBits === undefined
  ) return undefined;
  const literalLengthCount = literalLengthCountBits + 257;
  const distanceCount = distanceCountBits + 1;
  const codeLengthCount = codeLengthCountBits + 4;
  if (literalLengthCount > 286) return undefined;

  const codeLengthCodeLengths = new Uint8Array(19);
  for (let index = 0; index < codeLengthCount; index += 1) {
    const codeLength = fnReadBits(reader, 3);
    if (codeLength === undefined) return undefined;
    codeLengthCodeLengths[DEFLATE_CODE_LENGTH_ORDER[index] ?? 0] = codeLength;
  }
  const codeLengthHuffman = fnBuildHuffman(codeLengthCodeLengths, false, false);
  if (codeLengthHuffman === undefined) return undefined;

  const lengths = new Uint8Array(literalLengthCount + distanceCount);
  let index = 0;
  while (index < lengths.length) {
    const symbol = fnDecodeHuffman(reader, codeLengthHuffman);
    if (symbol === undefined) return undefined;
    if (symbol <= 15) {
      lengths[index] = symbol;
      index += 1;
      continue;
    }

    let repeatedLength = 0;
    let repeatCount: number | undefined;
    if (symbol === 16) {
      if (index === 0) return undefined;
      const extra = fnReadBits(reader, 2);
      if (extra === undefined) return undefined;
      repeatedLength = lengths[index - 1] ?? 0;
      repeatCount = extra + 3;
    } else if (symbol === 17) {
      const extra = fnReadBits(reader, 3);
      if (extra === undefined) return undefined;
      repeatCount = extra + 3;
    } else if (symbol === 18) {
      const extra = fnReadBits(reader, 7);
      if (extra === undefined) return undefined;
      repeatCount = extra + 11;
    } else {
      return undefined;
    }
    if (index + repeatCount > lengths.length) return undefined;
    lengths.fill(repeatedLength, index, index + repeatCount);
    index += repeatCount;
  }

  const literalLengthLengths = lengths.slice(0, literalLengthCount);
  const distanceLengths = lengths.slice(literalLengthCount);
  if ((literalLengthLengths[256] ?? 0) === 0) return undefined;
  const literalLength = fnBuildHuffman(literalLengthLengths, false, true);
  const distance = fnBuildHuffman(distanceLengths, true, true);
  if (literalLength === undefined || distance === undefined) return undefined;
  return { literalLength, distance };
}

function fnInflateCompressedBlock(
  reader: TBitReader,
  output: TInflateOutput,
  literalLength: THuffman,
  distance: THuffman,
  windowByteLength: number,
): boolean {
  while (true) {
    const symbol = fnDecodeHuffman(reader, literalLength);
    if (symbol === undefined) return false;
    if (symbol < 256) {
      if (!fnWriteInflatedByte(output, symbol)) return false;
      continue;
    }
    if (symbol === 256) return true;
    if (symbol < 257 || symbol > 285 || distance.empty) return false;

    const lengthIndex = symbol - 257;
    const lengthExtraBitCount = DEFLATE_LENGTH_EXTRA_BITS[lengthIndex] ?? 0;
    const lengthExtra = fnReadBits(reader, lengthExtraBitCount);
    if (lengthExtra === undefined) return false;
    const matchLength = (DEFLATE_LENGTH_BASE[lengthIndex] ?? 0) + lengthExtra;

    const distanceSymbol = fnDecodeHuffman(reader, distance);
    if (distanceSymbol === undefined || distanceSymbol > 29) return false;
    const distanceExtraBitCount = DEFLATE_DISTANCE_EXTRA_BITS[distanceSymbol] ?? 0;
    const distanceExtra = fnReadBits(reader, distanceExtraBitCount);
    if (distanceExtra === undefined) return false;
    const matchDistance = (DEFLATE_DISTANCE_BASE[distanceSymbol] ?? 0) + distanceExtra;
    if (
      matchDistance < 1
      || matchDistance > output.produced
      || matchDistance > windowByteLength
    ) return false;

    for (let index = 0; index < matchLength; index += 1) {
      const value = output.history[(output.produced - matchDistance) & 0x7fff] ?? 0;
      if (!fnWriteInflatedByte(output, value)) return false;
    }
  }
}

function fnValidatePngZlibStream(
  compressed: Uint8Array,
  plan: TPngScanlinePlan,
  indexedPalette: Readonly<{ bitDepth: number; entryCount: number }> | undefined,
): boolean {
  if (compressed.byteLength < 7) return false;
  const compressionMethodAndInfo = compressed[0] ?? 0;
  const flags = compressed[1] ?? 0;
  if (
    (compressionMethodAndInfo & 0x0f) !== 8
    || (compressionMethodAndInfo >>> 4) > 7
    || ((compressionMethodAndInfo << 8) + flags) % 31 !== 0
    || (flags & 0x20) !== 0
  ) return false;

  const trailerOffset = compressed.byteLength - 4;
  const budget: TDeflateBudget = {
    blocksRemaining: BOUNDED_PNG_MAX_DEFLATE_BLOCKS,
    symbolsRemaining: BOUNDED_PNG_MAX_DEFLATE_SYMBOLS,
    workRemaining: BOUNDED_PNG_MAX_DEFLATE_WORK_UNITS,
  };
  const reader: TBitReader = {
    bytes: compressed,
    budget,
    offset: 2,
    endOffset: trailerOffset,
    bitBuffer: 0,
    bitCount: 0,
  };
  const output: TInflateOutput = {
    budget,
    history: new Uint8Array(32_768),
    plan,
    indexed: indexedPalette === undefined
      ? undefined
      : {
        bitDepth: indexedPalette.bitDepth,
        paletteEntryCount: indexedPalette.entryCount,
        previousRow: new Uint8Array(Math.max(...plan.rowByteLengths)),
        filterType: 0,
        byteIndex: 0,
        samplesRemaining: 0,
        left: 0,
        upperLeft: 0,
      },
    produced: 0,
    adlerA: 1,
    adlerB: 0,
    passIndex: 0,
    rowsRemaining: 0,
    scanlineBytesRemaining: 0,
    expectsFilter: false,
    complete: false,
  };
  fnAdvancePngPass(output);
  const fixedHuffman = fnCreateFixedHuffman();
  if (fixedHuffman === undefined) return false;
  const windowByteLength = 1 << ((compressionMethodAndInfo >>> 4) + 8);

  let isFinalBlock = false;
  while (!isFinalBlock) {
    if (budget.blocksRemaining < 1 || !fnSpendDeflateWork(budget, 1)) return false;
    budget.blocksRemaining -= 1;
    const finalBlockBit = fnReadBits(reader, 1);
    const blockType = fnReadBits(reader, 2);
    if (finalBlockBit === undefined || blockType === undefined || blockType === 3) return false;
    isFinalBlock = finalBlockBit === 1;

    if (blockType === 0) {
      fnAlignBitReader(reader);
      if (reader.endOffset - reader.offset < 4) return false;
      const length = (reader.bytes[reader.offset] ?? 0)
        | ((reader.bytes[reader.offset + 1] ?? 0) << 8);
      const complement = (reader.bytes[reader.offset + 2] ?? 0)
        | ((reader.bytes[reader.offset + 3] ?? 0) << 8);
      reader.offset += 4;
      if ((length ^ 0xffff) !== complement || reader.endOffset - reader.offset < length) {
        return false;
      }
      for (let index = 0; index < length; index += 1) {
        if (!fnWriteInflatedByte(output, reader.bytes[reader.offset + index] ?? 0)) return false;
      }
      reader.offset += length;
      continue;
    }

    const huffman = blockType === 1 ? fixedHuffman : fnReadDynamicHuffman(reader);
    if (
      huffman === undefined
      || !fnInflateCompressedBlock(
        reader,
        output,
        huffman.literalLength,
        huffman.distance,
        windowByteLength,
      )
    ) return false;
  }

  if (
    reader.offset !== reader.endOffset
    || output.produced !== plan.totalByteLength
    || !output.complete
  ) return false;
  const actualAdler = ((output.adlerB << 16) | output.adlerA) >>> 0;
  return actualAdler === fnReadUint32BigEndian(compressed, trailerOffset);
}

function fnConcatenateIdat(bytes: Uint8Array, totalByteLength: number): Uint8Array {
  const compressed = new Uint8Array(totalByteLength);
  let sourceOffset = 8;
  let destinationOffset = 0;
  while (sourceOffset < bytes.byteLength) {
    const length = fnReadUint32BigEndian(bytes, sourceOffset);
    const typeOffset = sourceOffset + 4;
    const dataOffset = sourceOffset + 8;
    if (fnChunkTypeEquals(bytes, typeOffset, 'IDAT')) {
      compressed.set(bytes.subarray(dataOffset, dataOffset + length), destinationOffset);
      destinationOffset += length;
    }
    sourceOffset = dataOffset + length + 4;
  }
  return compressed;
}

export function fnValidateBoundedPngBytes(bytes: unknown): TPngBytesValidation {
  if (!(bytes instanceof Uint8Array)) {
    return { ok: false, reason: 'invalid-png-structure' };
  }
  if (bytes.byteLength > BOUNDED_PNG_MAX_DECODED_BYTES) {
    return { ok: false, reason: 'oversized' };
  }
  if (bytes.byteLength < 8 || !fnHasPngSignature(bytes)) {
    return { ok: false, reason: 'invalid-png-signature' };
  }

  let offset = 8;
  let chunkIndex = 0;
  let hasIhdr = false;
  let header: TPngHeader | undefined;
  let idatState: 'before' | 'during' | 'after' = 'before';
  let idatByteLength = 0;
  let hasPlte = false;
  let paletteEntryCount = 0;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 12) {
      return { ok: false, reason: 'invalid-png-structure' };
    }
    const length = fnReadUint32BigEndian(bytes, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    if (
      length > 0x7fffffff
      || length > bytes.byteLength - dataOffset - 4
      || !fnHasValidChunkType(bytes, typeOffset)
    ) return { ok: false, reason: 'invalid-png-structure' };
    const crcOffset = dataOffset + length;
    const nextOffset = crcOffset + 4;
    const isIhdr = fnChunkTypeEquals(bytes, typeOffset, 'IHDR');
    const isIdat = fnChunkTypeEquals(bytes, typeOffset, 'IDAT');
    const isIend = fnChunkTypeEquals(bytes, typeOffset, 'IEND');

    if (chunkIndex === 0) {
      if (!isIhdr || length !== 13 || !fnHasValidIhdrFields(bytes)) {
        return { ok: false, reason: 'invalid-ihdr' };
      }
      const width = fnReadUint32BigEndian(bytes, dataOffset);
      const height = fnReadUint32BigEndian(bytes, dataOffset + 4);
      if (width === 0 || height === 0 || width > 0x7fffffff || height > 0x7fffffff) {
        return { ok: false, reason: 'invalid-dimensions' };
      }
      hasIhdr = true;
      header = {
        width,
        height,
        bitDepth: bytes[dataOffset + 8] ?? 0,
        colorType: bytes[dataOffset + 9] ?? 0,
        interlaceMethod: (bytes[dataOffset + 12] ?? 0) as 0 | 1,
      };
    } else if (isIhdr || !hasIhdr) {
      return { ok: false, reason: 'invalid-ihdr' };
    }

    if (fnCrc32(bytes, typeOffset, crcOffset) !== fnReadUint32BigEndian(bytes, crcOffset)) {
      return { ok: false, reason: 'invalid-png-crc' };
    }
    const isPlte = fnChunkTypeEquals(bytes, typeOffset, 'PLTE');
    const isKnownCritical = isIhdr || isPlte || isIdat || isIend;
    if (((bytes[typeOffset] ?? 0) & 0x20) === 0 && !isKnownCritical) {
      return { ok: false, reason: 'invalid-png-structure' };
    }
    if (isPlte) {
      if (
        hasPlte
        || idatState !== 'before'
        || length === 0
        || length > 768
        || length % 3 !== 0
        || header === undefined
        || header.colorType === 0
        || header.colorType === 4
        || (header.colorType === 3 && length / 3 > 2 ** header.bitDepth)
      ) return { ok: false, reason: 'invalid-png-structure' };
      hasPlte = true;
      paletteEntryCount = length / 3;
    }
    if (isIdat) {
      if (idatState === 'after') return { ok: false, reason: 'invalid-png-structure' };
      if (header?.colorType === 3 && !hasPlte) {
        return { ok: false, reason: 'invalid-png-structure' };
      }
      idatState = 'during';
      idatByteLength += length;
    } else if (idatState === 'during') {
      idatState = 'after';
    }
    if (isIend) {
      if (
        length !== 0
        || idatByteLength === 0
        || nextOffset !== bytes.byteLength
        || header === undefined
      ) {
        return { ok: false, reason: 'invalid-png-structure' };
      }
      const scanlinePlan = fnCreatePngScanlinePlan(header);
      if (scanlinePlan === undefined) return { ok: false, reason: 'oversized' };
      const compressed = fnConcatenateIdat(bytes, idatByteLength);
      if (!fnValidatePngZlibStream(
        compressed,
        scanlinePlan,
        header.colorType === 3
          ? { bitDepth: header.bitDepth, entryCount: paletteEntryCount }
          : undefined,
      )) {
        return { ok: false, reason: 'invalid-png-structure' };
      }
      return {
        ok: true,
        metadata: {
          mimeType: 'image/png',
          byteSize: bytes.byteLength,
          width: fnReadUint32BigEndian(bytes, 16),
          height: fnReadUint32BigEndian(bytes, 20),
        },
      };
    }

    offset = nextOffset;
    chunkIndex += 1;
  }
  return { ok: false, reason: 'invalid-png-structure' };
}

export function fnValidateBoundedPngBase64(
  args: TValidateBoundedPngBase64,
): TPngBase64Validation {
  if (args.mimeType !== 'image/png') {
    return { ok: false, reason: 'unsupported-mime-type' };
  }
  if (typeof args.data !== 'string' || args.data.length === 0 || args.data.length % 4 !== 0) {
    return { ok: false, reason: 'invalid-base64' };
  }

  const maxEncodedLength = Math.ceil(BOUNDED_PNG_MAX_DECODED_BYTES / 3) * 4;
  if (args.data.length > maxEncodedLength) {
    return { ok: false, reason: 'oversized' };
  }
  const paddingLength = args.data.endsWith('==') ? 2 : args.data.endsWith('=') ? 1 : 0;
  if (!fnIsCanonicalBase64(args.data, paddingLength)) {
    return { ok: false, reason: 'invalid-base64' };
  }

  const byteSize = (args.data.length / 4) * 3 - paddingLength;
  if (byteSize > BOUNDED_PNG_MAX_DECODED_BYTES) {
    return { ok: false, reason: 'oversized' };
  }
  return fnValidateBoundedPngBytes(fnDecodeBase64(args.data, byteSize));
}
