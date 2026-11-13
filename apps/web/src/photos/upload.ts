/** What the server accepts. Checked here first, so a wrong file fails at once. */
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Why the file cannot be uploaded, or null. The server checks the content again. */
export function photoFileProblem(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return 'Choose a JPEG, PNG or WebP photo. HEIC photos can be converted on the phone first.';
  }
  if (file.size > MAX_PHOTO_BYTES) return 'The photo is larger than 10 MB. Choose a smaller one.';
  return null;
}
