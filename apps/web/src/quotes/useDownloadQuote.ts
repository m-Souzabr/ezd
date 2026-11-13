import { useMutation, useQueryClient } from '@tanstack/react-query';

import { api } from '../api/client';
import { quoteKey } from '../api/keys';
import { downloadQuotePdf } from './pdf';

/** Downloads a stored quote's PDF, reading the quote first if it is not at hand. */
export function useDownloadQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      downloadQuotePdf(
        await queryClient.fetchQuery({
          queryKey: quoteKey(id),
          queryFn: () => api.getQuote(id),
          staleTime: Infinity,
        }),
      ),
  });
}
