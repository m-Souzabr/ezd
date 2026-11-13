import type { Quote } from '../api/client';

/** Renders the quote's PDF. The renderer is loaded only when a PDF is asked for. */
export async function renderQuotePdf(quote: Quote): Promise<Blob> {
  const [{ pdf }, { quoteDocument }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./QuotePdf'),
  ]);
  return pdf(quoteDocument(quote)).toBlob();
}

export const pdfFileName = (quote: Pick<Quote, 'number' | 'project_name'>): string =>
  `Quote ${quote.number} ${quote.project_name}`.replace(/[^A-Za-z0-9 _-]+/g, '').trim() + '.pdf';

/** Saves the quote's PDF through the browser. */
export async function downloadQuotePdf(quote: Quote): Promise<void> {
  const blob = await renderQuotePdf(quote);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = pdfFileName(quote);
  link.click();
  // Some browsers start the download only after the click has been handled.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
