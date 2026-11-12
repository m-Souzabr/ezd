/** One problem found while validating input, located by a path such as `items[1].id`. */
export type Issue = { path: string; message: string };

/** `['room', 'walls', 0, 'end']` becomes `room.walls[0].end`. */
export function issuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((text, key) => {
    if (typeof key === 'number') return `${text}[${key}]`;
    return text === '' ? String(key) : `${text}.${String(key)}`;
  }, '');
}

/** One line per issue, for error messages. */
export function describeIssues(issues: readonly Issue[]): string {
  return issues
    .map((issue) => (issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`))
    .join('; ');
}
