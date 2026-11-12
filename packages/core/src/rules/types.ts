import type { Command } from '../commands/index.js';
import type { Id } from '../document/index.js';
import type { RuleContext } from './context.js';

export type Severity = 'error' | 'warning' | 'info';

export type Violation = {
  ruleId: string;
  severity: Severity;
  /** The items, openings or walls involved, the subject first. */
  itemIds: Id[];
  /** Plain English. Names the item and the problem, with lengths in inches. */
  message: string;
  /** Commands that would clear the violation, when there is an obvious way to. */
  fix?: Command[];
};

export type Rule = {
  id: string;
  severity: Severity;
  check(ctx: RuleContext): Violation[];
};

/** A violation before its rule stamps it with an id and a severity. */
export type Finding = Pick<Violation, 'itemIds' | 'message' | 'fix'>;

export const defineRule = (
  id: string,
  severity: Severity,
  find: (ctx: RuleContext) => Finding[],
): Rule => ({
  id,
  severity,
  check: (ctx) => find(ctx).map((finding) => ({ ruleId: id, severity, ...finding })),
});
