// Query keys shared by more than one file.

/** The list of saved versions of a design. One version is this key and its number. */
export const versionsKey = (designId: string) => ['designs', designId, 'versions'] as const;

/** The quotes of a design. */
export const quotesKey = (designId: string) => ['designs', designId, 'quotes'] as const;

/** One stored quote, which never changes. */
export const quoteKey = (id: string) => ['quotes', id] as const;
