// A PNG encoder for opaque RGB images. Browsers write a canvas as an RGBA PNG even when
// every pixel is opaque, and a PDF embeds an alpha channel asynchronously, so the same
// quote would not always give the same PDF. This writes 8-bit RGB with no alpha.

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** zlib, as an IDAT chunk holds it, by the browser's own compressor. */
async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(data as BodyInit).body!.pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * The pixels as an RGB PNG. `rgba` is four bytes a pixel, as `ImageData` holds them; the
 * alpha byte is dropped, so the pixels must already be opaque.
 */
export async function encodeRgbPng(width: number, height: number, rgba: Uint8ClampedArray) {
  // Each row starts with its filter type: 1 (sub), which stores each byte as the
  // difference from the one a pixel to its left. Flat colours become runs of zeros.
  const stride = width * 3 + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 1;
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const to = row + 1 + x * 3;
      for (let c = 0; c < 3; c += 1) {
        const left = x > 0 ? rgba[from - 4 + c]! : 0;
        raw[to + c] = (rgba[from + c]! - left) & 0xff;
      }
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const parts = [
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', await zlib(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

/** A PNG as a data URL. */
export function pngDataUrl(png: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < png.length; i += 0x8000) {
    binary += String.fromCharCode(...png.subarray(i, i + 0x8000));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}
