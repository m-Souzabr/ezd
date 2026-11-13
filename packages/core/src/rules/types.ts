import type { z } from 'zod';

import type { Command } from '../commands/index.js';
import type { Id } from '../document/index.js';
import { isLockedRule, type RulesConfig, type SeveritySchema } from './config.js';
import type { RuleContext } from './context.js';

export type Severity = z.infer<typeof SeveritySchema>;

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

/**
 * Builds a rule. `severity` is the rule's own; the configuration may turn the rule off or
 * change it, except for the rules that protect the document's integrity.
 */
export const defineRule = (
  id: string,
  severity: Severity,
  find: (ctx: RuleContext) => Finding[],
): Rule => ({
  id,
  severity,
  check(ctx) {
    const setting = isLockedRule(id)
      ? undefined
      : ctx.config.rules[id as keyof RulesConfig['rules']];
    if (setting && !setting.enabled) return [];
    const level = setting?.severity ?? severity;
    return find(ctx).map((finding) => ({ ruleId: id, severity: level, ...finding }));
  },
});
