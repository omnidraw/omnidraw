export const BOUNDED_PNG_MAX_DECODED_BYTES = 8 * 1024 * 1024;

// This bounds work after the PNG file's zlib stream is expanded. It covers the
// largest preview-inspection screenshot (2,560 x 2,048 RGBA) with headroom,
// while preventing a small compressed file from becoming an inflate bomb.
export const BOUNDED_PNG_MAX_INFLATED_BYTES = 64 * 1024 * 1024;

// DEFLATE control work is bounded separately from output bytes. A work unit is
// one consumed bit, decoded symbol, emitted byte, block, or indexed sample.
export const BOUNDED_PNG_MAX_DEFLATE_BLOCKS = 65_536;
export const BOUNDED_PNG_MAX_DEFLATE_SYMBOLS = 16 * 1024 * 1024;
export const BOUNDED_PNG_MAX_DEFLATE_WORK_UNITS = 96 * 1024 * 1024;
