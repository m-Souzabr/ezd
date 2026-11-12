import type { Severity, Violation } from '@ezd/core';

import { useDesign, useDesignStore } from '../../store/context';
import { planBoundsOf } from '../../store/selectors';
import { asOne } from '../edits';
import { findTarget } from '../tools/select';
import { fitBounds } from '../viewport';
import { BUTTON, PanelSection } from './fields';

const GROUPS: { severity: Severity; title: string; dot: string }[] = [
  { severity: 'error', title: 'Errors', dot: 'bg-red-600' },
  { severity: 'warning', title: 'Warnings', dot: 'bg-amber-500' },
  { severity: 'info', title: 'Suggestions', dot: 'bg-sky-500' },
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
    <li
      data-rule-id={violation.ruleId}
      className="flex items-start gap-2 border-b border-slate-100 px-3 py-2"
    >
      <button
        type="button"
        className="flex-1 rounded text-left text-sm text-slate-800 hover:text-sky-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-500"
        onClick={show}
      >
        {violation.message}
        <span className="mt-0.5 block font-mono text-[11px] text-slate-500">
          {violation.ruleId}
        </span>
      </button>
      {violation.fix && violation.fix.length > 0 && (
        <button type="button" className={`${BUTTON} px-2 py-0.5 text-xs`} onClick={apply}>
          Apply<span className="sr-only"> fix: {violation.message}</span>
        </button>
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
          <p className="p-3 text-sm text-slate-600">No problems found.</p>
        )}
        {GROUPS.map(({ severity, title, dot }) => {
          const group = violations.filter((violation) => violation.severity === severity);
          if (group.length === 0) return null;
          return (
            <section key={severity} aria-label={title}>
              <h3 className="flex items-center gap-2 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                <span aria-hidden className={`size-2 rounded-full ${dot}`} />
                {title} ({group.length})
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
      </div>
    </PanelSection>
  );
}
