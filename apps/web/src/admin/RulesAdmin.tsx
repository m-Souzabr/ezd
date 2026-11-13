import {
  DEFAULT_RULES_CONFIG,
  formatLength,
  isLockedRule,
  LOCKED_RULES,
  type Len,
  parseRulesConfig,
  RULE_DESCRIPTIONS,
  RULE_IDS,
  RULE_THRESHOLDS,
  type RuleId,
  type RulesConfig,
  SEED_CATALOG,
  type Severity,
  validate,
  validateRulesConfig,
} from '@ezd/core';
import { useQuery } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';

import { api } from '../api/client';
import { configDraftKey } from '../api/keys';
import { RequirePermission } from '../auth/permissions';
import { useRulesConfig } from '../config/useConfig';
import { BUTTON, LengthField } from '../editor/panels/fields';
import { errorMessage } from '../pages/format';
import { NoAccess } from './AdminLayout';
import { FIELD } from './controls';
import { DraftSection, type LoadedSection } from './DraftSection';
import { sampleDesign } from './sampleDesign';

type Thresholds = RulesConfig['thresholds'];
type Snap = RulesConfig['snap'];

const SEVERITIES: { value: Severity; label: string }[] = [
  { value: 'error', label: 'Error' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

const THRESHOLD_LABELS: Record<keyof Thresholds, string> = {
  minCabinetGap: 'Narrowest cabinet',
  maxFillerGap: 'Widest filler gap',
  minAisle: 'Minimum aisle',
  recommendedAisle: 'Recommended aisle',
  rangeOverheadClearance: 'Clearance above a range',
  dishwasherSinkDistance: 'Dishwasher to sink',
  fridgeHingeClearance: 'Refrigerator hinge side',
  workTriangleMin: 'Work triangle, least',
  workTriangleMax: 'Work triangle, most',
};

const SNAP_LABELS: Record<Exclude<keyof Snap, 'freeRotationStep'>, string> = {
  grid: 'Grid',
  wallCaptureDistance: 'Wall capture distance',
  edgeSnapDistance: 'Edge snap distance',
};

/** Whether a configuration still has what core would give with nothing set. */
const isDefault = (config: RulesConfig, id: RuleId): boolean =>
  JSON.stringify(config.rules[id]) === JSON.stringify(DEFAULT_RULES_CONFIG.rules[id]) &&
  (RULE_THRESHOLDS[id] ?? []).every(
    (name) => config.thresholds[name] === DEFAULT_RULES_CONFIG.thresholds[name],
  );

function counts(config: RulesConfig, doc = SAMPLE) {
  const found = validate(doc, SEED_CATALOG, config);
  const by = (severity: Severity) => found.filter((v) => v.severity === severity).length;
  return { error: by('error'), warning: by('warning'), info: by('info') };
}
const SAMPLE = sampleDesign();

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const describe = (c: ReturnType<typeof counts>) =>
  `${plural(c.error, 'error')}, ${plural(c.warning, 'warning')}, ${c.info} info`;

function RuleRow({
  id,
  config,
  onChange,
}: {
  id: RuleId;
  config: RulesConfig;
  onChange(next: RulesConfig): void;
}) {
  const locked = isLockedRule(id);
  const setting = config.rules[id];
  const set = (patch: Partial<typeof setting>) =>
    onChange({ ...config, rules: { ...config.rules, [id]: { ...setting, ...patch } } });
  const names = RULE_THRESHOLDS[id] ?? [];
  const commit = (name: keyof Thresholds) => (value: Len) => {
    const next = { ...config, thresholds: { ...config.thresholds, [name]: value } };
    const checked = validateRulesConfig(next);
    if (!checked.ok) return checked.error[0]?.message ?? 'That value is not allowed.';
    onChange(next);
    return null;
  };
  return (
    <tr className="align-top odd:bg-slate-50/60">
      <th scope="row" className="px-3 py-2 text-left font-normal">
        <code className="text-xs font-semibold text-slate-900">{id}</code>
        <p className="mt-0.5 max-w-xs text-xs text-slate-600">{RULE_DESCRIPTIONS[id]}</p>
        {locked && (
          <p className="mt-1 max-w-xs text-xs text-amber-800">
            Locked: always on, always an error. {LOCKED_RULES[id]}
          </p>
        )}
      </th>
      <td className="px-3 py-2">
        <select
          aria-label={`Severity of ${id}`}
          className={`${FIELD} disabled:bg-slate-100 disabled:text-slate-500`}
          value={setting.severity}
          disabled={locked}
          onChange={(event) => set({ severity: event.target.value as Severity })}
        >
          {SEVERITIES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          role="switch"
          aria-label={`${id} is on`}
          className="size-4 accent-sky-600"
          checked={setting.enabled}
          disabled={locked}
          onChange={(event) => set({ enabled: event.target.checked })}
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-3">
          {names.map((name) => (
            <div key={name} className="w-40">
              <LengthField
                label={THRESHOLD_LABELS[name]}
                value={config.thresholds[name]}
                onCommit={commit(name)}
              />
            </div>
          ))}
          {names.length === 0 && <span className="text-xs text-slate-500">None</span>}
        </div>
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          className={`${BUTTON} px-2 py-0.5 text-xs`}
          aria-label={`Reset ${id} to defaults`}
          disabled={isDefault(config, id)}
          onClick={() =>
            onChange({
              ...config,
              rules: { ...config.rules, [id]: DEFAULT_RULES_CONFIG.rules[id] },
              thresholds: {
                ...config.thresholds,
                ...Object.fromEntries(
                  names.map((name) => [name, DEFAULT_RULES_CONFIG.thresholds[name]]),
                ),
              },
            })
          }
        >
          Reset
        </button>
      </td>
    </tr>
  );
}

function SnapOptions({
  config,
  onChange,
}: {
  config: RulesConfig;
  onChange(next: RulesConfig): void;
}) {
  const stepId = useId();
  const [text, setText] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const tryChange = (patch: Partial<Snap>): string | null => {
    const next = { ...config, snap: { ...config.snap, ...patch } };
    const checked = validateRulesConfig(next);
    if (!checked.ok) return checked.error[0]?.message ?? 'That value is not allowed.';
    onChange(next);
    return null;
  };
  const names = Object.keys(SNAP_LABELS) as (keyof typeof SNAP_LABELS)[];
  return (
    <section aria-label="Snapping" className="rounded-lg bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center">
        <h2 className="text-base font-semibold">Snapping</h2>
        <button
          type="button"
          className={`${BUTTON} ml-auto px-2 py-0.5 text-xs`}
          aria-label="Reset snapping to defaults"
          onClick={() => onChange({ ...config, snap: DEFAULT_RULES_CONFIG.snap })}
        >
          Reset to defaults
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {names.map((name) => (
          <LengthField
            key={name}
            label={SNAP_LABELS[name]}
            value={config.snap[name]}
            onCommit={(value) => tryChange({ [name]: value })}
          />
        ))}
        <div className="flex flex-col gap-1">
          <label htmlFor={stepId} className="text-xs font-medium text-slate-600">
            Free rotation step (degrees)
          </label>
          <input
            id={stepId}
            type="text"
            inputMode="numeric"
            className={`${FIELD} w-28`}
            value={text ?? String(config.snap.freeRotationStep)}
            onChange={(event) => {
              setText(event.target.value);
              const refused = /^\d+$/.test(event.target.value.trim())
                ? tryChange({ freeRotationStep: Number(event.target.value) })
                : 'A whole number of degrees.';
              setStepError(refused);
            }}
            onBlur={() => {
              setText(null);
              setStepError(null);
            }}
            aria-invalid={stepError !== null}
          />
          {stepError && (
            <p role="alert" className="text-xs text-red-700">
              {stepError}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function RulesForm({
  config,
  onChange,
}: {
  config: RulesConfig;
  onChange(next: RulesConfig): void;
}) {
  const inForce = useRulesConfig();
  const now = useMemo(() => counts(inForce), [inForce]);
  const after = useMemo(() => counts(config), [config]);
  const changed = JSON.stringify(now) !== JSON.stringify(after);
  return (
    <>
      <section
        aria-label="Preview"
        className="rounded-lg bg-white p-4 text-sm shadow-sm"
        data-testid="rules-preview"
      >
        <h2 className="mb-1 text-base font-semibold">Preview</h2>
        <p className="text-slate-700">
          On a sample kitchen, the rules now find <strong>{describe(now)}</strong>.
          {changed ? (
            <>
              {' '}
              With these settings: <strong>{describe(after)}</strong>.
            </>
          ) : (
            ' These settings find the same.'
          )}
        </p>
      </section>
      <section aria-label="Rules" className="overflow-x-auto rounded-lg bg-white shadow-sm">
        <table className="w-full min-w-[56rem] text-sm">
          <caption className="sr-only">Design rules</caption>
          <thead className="border-b border-slate-200 text-left text-xs text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Rule
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Severity
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                On
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Thresholds
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">Reset</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {RULE_IDS.map((id) => (
              <RuleRow key={id} id={id} config={config} onChange={onChange} />
            ))}
          </tbody>
        </table>
      </section>
      <SnapOptions config={config} onChange={onChange} />
      <p className="text-xs text-slate-500">
        Lengths are in inches, as {formatLength(DEFAULT_RULES_CONFIG.thresholds.minAisle)} for the
        default minimum aisle. These are design-quality guidelines, not building-code checks.
      </p>
    </>
  );
}

/**
 * The design rules: which are on, how serious each is, the thresholds they measure against
 * and the snap options. Edited as a draft and published with the other settings. The rules
 * that protect the document are locked.
 */
export function RulesAdminPage() {
  const [notice, setNotice] = useState<string | null>(null);
  const draft = useQuery({ queryKey: configDraftKey, queryFn: api.getConfigDraft });
  const loaded = useMemo<LoadedSection<RulesConfig> | null>(() => {
    if (!draft.data) return null;
    const parsed = parseRulesConfig(draft.data.rules_config ?? {});
    return {
      revision: draft.data.revision,
      basedOn: draft.data.based_on,
      value: parsed.ok ? parsed.value.config : DEFAULT_RULES_CONFIG,
    };
  }, [draft.data]);
  return (
    <RequirePermission permission="config.rules.edit" fallback={<NoAccess />}>
      <h1 className="mb-4 text-xl font-semibold">Rules</h1>
      {loaded ? (
        <DraftSection<RulesConfig>
          key={`${loaded.revision}-${loaded.basedOn}`}
          loaded={loaded}
          save={api.saveRulesDraft}
          problems={() => 0}
          notice={notice}
          onPublished={setNotice}
          onReset={() => DEFAULT_RULES_CONFIG}
          resetLabel="Reset all to defaults"
        >
          {({ value, set }) => <RulesForm config={value} onChange={set} />}
        </DraftSection>
      ) : draft.error ? (
        <p role="alert" className="text-sm text-red-700">
          {errorMessage(draft.error)}
        </p>
      ) : (
        <p role="status" className="text-sm text-slate-600">
          Loading…
        </p>
      )}
    </RequirePermission>
  );
}
