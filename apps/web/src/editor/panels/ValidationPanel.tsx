import type { Severity, Violation } from '@ezd/core';
import {
  CircleAlertIcon,
  InfoIcon,
  type LucideIcon,
  TriangleAlertIcon,
  WrenchIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { useDesign, useDesignStore } from '../../store/context';
import { planBoundsOf } from '../../store/selectors';
import { asOne } from '../edits';
import { findTarget } from '../tools/select';
import { fitBounds } from '../viewport';
import { PanelSection } from './fields';

/** The severity is its icon and its word, not just its color. */
const GROUPS: {
  severity: Severity;
  title: string;
  icon: LucideIcon;
  variant: 'destructive' | 'warning' | 'outline';
  className?: string;
}[] = [
  {
    severity: 'error',
    title: 'Errors',
    icon: CircleAlertIcon,
    variant: 'destructive',
    // A solid badge: the tinted one is too faint for small text.
    className: 'bg-destructive text-primary-foreground',
  },
  { severity: 'warning', title: 'Warnings', icon: TriangleAlertIcon, variant: 'warning' },
  // The `info` badge's blue is a hair under AA contrast with its text, so this one is an outline.
  { severity: 'info', title: 'Suggestions', icon: InfoIcon, variant: 'outline' },
];

/** How far `Fit` zooms in on the items of a violation, in pixels per inch. */
const FRAME_SCALE = 6;

function ViolationRow({ violation }: { violation: Violation }) {
  const store = useDesignStore();

  /** Selects what the violation is about and, in the plan, brings it into view. */
  const show = () => {
    const state = store.getState();
    const ids = violation.itemIds.filter((id) => findTarget(state.doc, id));
    state.select(ids);
    const bounds = planBoundsOf(state.doc, ids);
    if (state.view.kind === 'plan' && bounds && state.canvasSize) {
      state.setViewport(fitBounds(bounds, state.canvasSize, FRAME_SCALE));
    }
  };

  const apply = () => {
    const state = store.getState();
    const command = asOne(violation.fix ?? [], `Fix ${violation.ruleId}`);
    if (!command) return;
    const executed = state.execute(command);
    state.notify(executed.ok ? null : executed.error.message);
  };

  return (
    <li data-rule-id={violation.ruleId} className="flex items-start gap-2 border-b px-3 py-2">
      <Button
        variant="ghost"
        className="h-auto min-w-0 flex-1 flex-col items-start justify-start px-1.5 py-1 text-left font-normal whitespace-normal"
        onClick={show}
      >
        <span className="text-sm">{violation.message}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{violation.ruleId}</span>
      </Button>
      {violation.fix && violation.fix.length > 0 && (
        <Button variant="outline" size="xs" className="shrink-0" onClick={apply}>
          <WrenchIcon aria-hidden="true" />
          Apply<span className="sr-only"> fix: {violation.message}</span>
        </Button>
      )}
    </li>
  );
}

/** The rule violations, grouped by severity. Each selects its items; some can be fixed. */
export function ValidationPanel() {
  const violations = useDesign((state) => state.violations);
  return (
    <PanelSection title={`Validation (${violations.length})`}>
      <div className="overflow-y-auto">
        {violations.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">No problems found.</p>
        )}
        {GROUPS.map(({ severity, title, icon: Icon, variant, className }) => {
          const group = violations.filter((violation) => violation.severity === severity);
          if (group.length === 0) return null;
          return (
            <section key={severity} aria-label={title}>
              <h3 className="border-b bg-background px-3 py-1.5">
                <Badge variant={variant} className={className}>
                  <Icon aria-hidden="true" />
                  {title} ({group.length})
                </Badge>
              </h3>
              <ul>
                {group.map((violation, i) => (
                  <ViolationRow
                    key={`${violation.ruleId}:${violation.itemIds.join()}:${i}`}
                    violation={violation}
                  />
                ))}
              </ul>
            </section>
          );
        })}
        <p className="px-3 py-2 text-xs text-muted-foreground">
          These checks are design guidance, not building-code compliance.
        </p>
      </div>
    </PanelSection>
  );
}
