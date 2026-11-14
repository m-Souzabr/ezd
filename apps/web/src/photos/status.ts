import type { Photo } from '@/api/client';

/** What to call a draft's state in a badge. A badge always carries the text, never color alone. */
export function photoDraftStatusLabel(
  status: NonNullable<Photo['latest_draft']>['status'],
): string {
  switch (status) {
    case 'analyzing':
      return 'Analyzing';
    case 'ready':
      return 'Ready to correct';
    case 'failed':
      return 'Analysis failed';
    case 'confirmed':
      return 'Confirmed';
    case 'discarded':
      return 'Discarded';
  }
}
