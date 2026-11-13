import { describe, expect, it } from 'vitest';

import { crc32, encodeRgbPng, pngDataUrl } from './png';

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(data as BodyInit).body!.pipeThrough(
    new DecompressionStream('deflate'),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The chunks of a PNG, checking each one's CRC. */
function chunks(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const found: { type: string; data: Uint8Array }[] = [];
  for (let at = 8; at < png.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    expect(view.getUint32(at + 8 + length)).toBe(crc32(png.subarray(at + 4, at + 8 + length)));
    found.push({ type, data });
    at += 12 + length;
  }
  return found;
}

describe('encodeRgbPng', () => {
  // Two by two: red, green; blue, white. The alpha bytes are ignored.
  const rgba = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 255, 255, 255, 0,
  ]);

  it('writes an 8-bit RGB PNG with no alpha channel', async () => {
    const png = await encodeRgbPng(2, 2, rgba);

    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const parts = chunks(png);
    expect(parts.map((part) => part.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect([...parts[0]!.data]).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0]);
  });

  it('stores each row with the sub filter, which decodes back to the pixels', async () => {
    const parts = chunks(await encodeRgbPng(2, 2, rgba));
    const raw = await inflate(parts[1]!.data);

    expect([...raw]).toEqual([
      // Filter 1, red, then green minus red.
      1, 255, 0, 0, 1, 255, 0,
      // Filter 1, blue, then white minus blue.
      1, 0, 0, 255, 255, 255, 0,
    ]);
  });

  it('gives the same bytes for the same pixels', async () => {
    expect(await encodeRgbPng(2, 2, rgba)).toEqual(await encodeRgbPng(2, 2, rgba));
  });

  it('makes a data URL', () => {
    expect(pngDataUrl(new Uint8Array([1, 2, 3]))).toBe('data:image/png;base64,AQID');
  });
});

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
