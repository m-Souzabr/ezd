import type { Catalog } from '../catalog/index.js';
import { applyCommand, type Command, type CommandError } from '../commands/index.js';
import type { DesignDocument } from '../document/index.js';
import { ok, type Result } from '../result.js';
import { createContext } from './context.js';
import type { RulesConfig } from './config.js';
import { RULES } from './rules/index.js';
import type { Severity, Violation } from './types.js';

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const compareViolations = (a: Violation, b: Violation): number =>
  SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
  compareText(a.ruleId, b.ruleId) ||
  compareText(a.itemIds.join(), b.itemIds.join()) ||
  compareText(a.message, b.message);

/** What makes two violations the same one: the rule and the set of things involved. */
const violationKey = (violation: Violation): string =>
  `${violation.ruleId}|${[...violation.itemIds].sort().join()}`;

/**
 * Everything the design rules find wrong with a document, sorted by severity, then rule
 * id, then item ids. Pure and deterministic. The document must be a valid one, as
 * `parseDocument` returns.
 *
 * `rules` turns rules off, changes their severity and sets their thresholds; without it
 * the defaults apply.
 *
 * These are design-quality rules, not building-code checks.
 */
export function validate(doc: DesignDocument, catalog: Catalog, rules?: RulesConfig): Violation[] {
  const ctx = createContext(doc, catalog, rules);
  return RULES.flatMap((rule) => rule.check(ctx)).sort(compareViolations);
}

/**
 * Applies a command and validates the result. `introduced` holds the violations the
 * document did not have before, matched on rule id and item ids.
 *
 * The command is applied even when it introduces violations; whether to block on them is
 * the caller's choice. It fails only as `applyCommand` does with this catalog, which
 * includes an item the catalog does not allow.
 */
export function validateCommand(
  doc: DesignDocument,
  catalog: Catalog,
  cmd: Command,
  rules?: RulesConfig,
): Result<{ doc: DesignDocument; violations: Violation[]; introduced: Violation[] }, CommandError> {
  const applied = applyCommand(doc, cmd, { catalog });
  if (!applied.ok) return applied;
  const before = new Set(validate(doc, catalog, rules).map(violationKey));
  const violations = validate(applied.value.doc, catalog, rules);
  return ok({
    doc: applied.value.doc,
    violations,
    introduced: violations.filter((violation) => !before.has(violationKey(violation))),
  });
}
