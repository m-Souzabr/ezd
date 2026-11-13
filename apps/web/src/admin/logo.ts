import { MAX_LOGO_CHARS } from '@ezd/core';

import { encodeRgbPng, pngDataUrl } from '../editor/png';

/** The box a logo is scaled to fit, in pixels. The PDF draws it about 44 points high. */
export const LOGO_BOX = { width: 300, height: 120 } as const;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

/**
 * Turns an image the user picked into the logo a quote keeps: an RGB PNG without an alpha
 * channel (a PDF embeds one asynchronously, so the same quote would not always give the
 * same file), scaled down to fit the box and flattened onto white. Throws an `Error` whose
 * message says what is wrong with the file.
 */
export async function fileToLogo(file: Blob): Promise<string> {
  if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
    throw new Error('The logo must be a PNG or a JPEG image.');
  }
  if (file.size > MAX_FILE_BYTES) throw new Error('That image is over 4 MB.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That file could not be read as an image.');
  }
  const scale = Math.min(1, LOGO_BOX.width / bitmap.width, LOGO_BOX.height / bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare the image.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const url = pngDataUrl(
    await encodeRgbPng(width, height, context.getImageData(0, 0, width, height).data),
  );
  if (url.length > MAX_LOGO_CHARS) {
    throw new Error('That logo is too detailed. Use a simpler image, under 150 KB.');
  }
  return url;
}

/** A plain plan drawing for the PDF preview: an outline of a room on white, as an RGB PNG. */
export async function samplePlanImage(): Promise<string> {
  const width = 480;
  const height = 270;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  const paint = (x: number, y: number, shade: number) => {
    const at = (y * width + x) * 4;
    rgba[at] = rgba[at + 1] = rgba[at + 2] = shade;
  };
  for (let x = 40; x < 440; x += 1) for (const y of [40, 41, 228, 229]) paint(x, y, 71);
  for (let y = 40; y < 230; y += 1) for (const x of [40, 41, 438, 439]) paint(x, y, 71);
  for (let x = 42; x < 200; x += 1) for (let y = 42; y < 70; y += 1) paint(x, y, 219);
  return pngDataUrl(await encodeRgbPng(width, height, rgba));
}
