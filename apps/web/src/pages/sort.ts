export type Sort = { key: string; descending: boolean };

/** `-email` is the email column, descending. */
export const parseSort = (sort: string): Sort => ({
  key: sort.replace(/^-/, ''),
  descending: sort.startsWith('-'),
});
export const formatSort = (sort: Sort): string => (sort.descending ? `-${sort.key}` : sort.key);
