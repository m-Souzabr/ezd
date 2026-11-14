import { useMediaQuery } from '@/hooks/use-media-query';

/** Whether the screen is narrower than 768 px (below `md`). `sidebar.tsx` asks it. */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 47.99rem)');
}
