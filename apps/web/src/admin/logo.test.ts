import { afterEach, describe, expect, it, vi } from 'vitest';

import { fileToLogo, LOGO_BOX } from './logo';

afterEach(() => vi.unstubAllGlobals());

describe('fileToLogo', () => {
  it('takes only PNG and JPEG images', async () => {
    await expect(fileToLogo(new Blob(['<svg/>'], { type: 'image/svg+xml' }))).rejects.toThrow(
      'The logo must be a PNG or a JPEG image.',
    );
    await expect(fileToLogo(new Blob(['x'], { type: 'image/gif' }))).rejects.toThrow('PNG');
  });

  it('refuses a file over 4 MB without reading it', async () => {
    const big = new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], { type: 'image/png' });
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    await expect(fileToLogo(big)).rejects.toThrow('over 4 MB');
    expect(decode).not.toHaveBeenCalled();
  });

  it('says so when the browser cannot decode the file', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('bad')));
    await expect(fileToLogo(new Blob(['x'], { type: 'image/png' }))).rejects.toThrow(
      'could not be read as an image',
    );
  });

  it('scales a large image down to the box, flattens it on white and writes an RGB PNG', async () => {
    const bitmap = { width: LOGO_BOX.width * 2, height: LOGO_BOX.height * 4, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    const drawn: unknown[] = [];
    const context = {
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: (...args: unknown[]) => drawn.push(args),
      getImageData: (_x: number, _y: number, width: number, height: number) => ({
        data: new Uint8ClampedArray(width * height * 4).fill(255),
      }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
    );
    const url = await fileToLogo(new Blob(['x'], { type: 'image/jpeg' }));
    expect(url).toMatch(/^data:image\/png;base64,/);
    // Scaled by the tighter of the two limits: 120 high, so 150 wide.
    expect(drawn).toEqual([[bitmap, 0, 0, 150, 120]]);
    expect(context.fillStyle).toBe('#ffffff');
    expect(bitmap.close).toHaveBeenCalled();
    // The IHDR colour type, after the 8 byte signature, a length and the name.
    const bytes = Uint8Array.from(atob(url.split(',')[1]!), (c) => c.charCodeAt(0));
    expect(bytes[25]).toBe(2);
  });

  it('never makes a small image larger', async () => {
    const bitmap = { width: 20, height: 10, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    const drawn: unknown[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillRect: vi.fn(),
      drawImage: (...args: unknown[]) => drawn.push(args),
      getImageData: () => ({ data: new Uint8ClampedArray(20 * 10 * 4).fill(255) }),
    } as unknown as CanvasRenderingContext2D);
    await fileToLogo(new Blob(['x'], { type: 'image/png' }));
    expect(drawn).toEqual([[bitmap, 0, 0, 20, 10]]);
  });

  it('says so when the browser has no canvas to draw on', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 5, height: 5, close: vi.fn() }),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await expect(fileToLogo(new Blob(['x'], { type: 'image/png' }))).rejects.toThrow(
      'cannot prepare the image',
    );
  });
});
