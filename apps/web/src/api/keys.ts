// Query keys shared by more than one file.

/** The list of saved versions of a design. One version is this key and its number. */
export const versionsKey = (designId: string) => ['designs', designId, 'versions'] as const;
