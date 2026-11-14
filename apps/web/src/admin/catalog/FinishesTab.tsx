import { type Catalog, type CatalogProblem, type Finish } from '@ezd/core';
import { useId, useState } from 'react';

import { CheckboxField, SelectField } from '../../editor/panels/fields';
import { CommitField, MoneyField } from './CommitFields';
import { bpsToPercent, changeFinish, percentToBps, withRetired } from './helpers';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const TARGETS = ['cabinet', 'countertop', 'wall', 'floor'] as const;

function FinishRow({
  finish,
  problems,
  onChange,
}: {
  finish: Finish;
  problems: readonly CatalogProblem[];
  onChange(finish: Finish): void;
}) {
  const colorId = useId();
  return (
    <li
      aria-label={`Finish ${finish.id}`}
      className="flex flex-col gap-2 rounded border border-border p-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden
          className="size-5 rounded border border-input"
          style={{ background: finish.color }}
        />
        <span className="font-medium">{finish.id}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
          {finish.target}
        </span>
        {finish.retired && (
          <span className="rounded bg-warning px-1.5 py-0.5 text-xs text-warning-foreground">
            Retired
          </span>
        )}
      </div>
      {problems.length > 0 && (
        <ul className="list-disc rounded border border-destructive/30 bg-destructive/10 py-2 pr-3 pl-7 text-sm text-destructive">
          {problems.map((problem) => (
            <li key={`${problem.path}:${problem.message}`}>{problem.message}</li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <CommitField
          label="Name"
          value={finish.name}
          onCommit={(name) => (onChange({ ...finish, name: name.trim() }), null)}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor={colorId} className="text-xs font-medium text-muted-foreground">
            Color
          </label>
          <div className="flex gap-2">
            <input
              id={colorId}
              type="color"
              aria-label={`Color picker for ${finish.id}`}
              className="h-8 w-10 cursor-pointer rounded border border-input"
              value={/^#[0-9a-f]{6}$/i.test(finish.color) ? finish.color : '#000000'}
              onChange={(event) => onChange({ ...finish, color: event.target.value })}
            />
            <CommitField
              label="Color code"
              value={finish.color}
              onCommit={(color) => (onChange({ ...finish, color: color.trim() }), null)}
            />
          </div>
        </div>
        {finish.target === 'cabinet' && (
          <CommitField
            label="Price multiplier (%)"
            value={bpsToPercent(finish.multiplierBps ?? 10000)}
            inputMode="decimal"
            onCommit={(text) => {
              const bps = percentToBps(text);
              if (bps === null) return 'Use a percent, such as 110 or 97.5.';
              onChange({ ...finish, multiplierBps: bps });
              return null;
            }}
          />
        )}
        {finish.target === 'countertop' && (
          <MoneyField
            label="Price per square foot ($)"
            cents={finish.pricePerSqftCents ?? 0}
            onCommit={(pricePerSqftCents) => onChange({ ...finish, pricePerSqftCents })}
          />
        )}
      </div>
      <CheckboxField
        label="Retired (stays in existing designs, no longer offered)"
        checked={finish.retired === true}
        onChange={(retired) => onChange(withRetired(finish, retired))}
      />
    </li>
  );
}

/** The finishes of the catalog: color, price multiplier or price per square foot. */
export function FinishesTab({
  catalog,
  problems,
  onChange,
}: {
  catalog: Catalog;
  problems: readonly CatalogProblem[];
  onChange(catalog: Catalog): void;
}) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [target, setTarget] = useState<Finish['target']>('cabinet');
  const idField = useId();
  const taken = catalog.finishes.some((finish) => finish.id === id.trim());
  const add = () => {
    const finish: Finish = {
      id: id.trim(),
      name: name.trim() || id.trim(),
      target,
      color: '#cccccc',
      ...(target === 'cabinet' && { multiplierBps: 10000 }),
      ...(target === 'countertop' && { pricePerSqftCents: 0 }),
    };
    onChange({ ...catalog, finishes: [...catalog.finishes, finish] });
    setId('');
    setName('');
  };
  return (
    <div className="flex flex-col gap-3">
      <form
        aria-label="New finish"
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (id.trim() && !taken) add();
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={idField} className="text-xs font-medium text-muted-foreground">
            New finish id
          </label>
          <Input
            id={idField}

            placeholder="cabinet.teal"
            value={id}
            onChange={(event) => setId(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            New finish name
            <Input
              className="mt-1 block"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </div>
        <SelectField
          label="Applies to"
          value={target}
          options={TARGETS.map((value) => ({ value, label: value }))}
          onChange={(value) => setTarget(value as Finish['target'])}
        />
        <Button type="submit" disabled={!id.trim() || taken}>
          Add finish
        </Button>
        {taken && <p className="text-xs text-destructive">That id is already used.</p>}
      </form>
      <ul className="flex flex-col gap-2">
        {catalog.finishes.map((finish, index) => (
          <FinishRow
            key={finish.id}
            finish={finish}
            problems={problems.filter((problem) => problem.path.startsWith(`finishes.${index}.`))}
            onChange={(next) => onChange(changeFinish(catalog, finish.id, () => next))}
          />
        ))}
      </ul>
    </div>
  );
}
