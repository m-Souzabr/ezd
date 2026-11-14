import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { api, type AuditChange, type AuditEntry } from '../api/client';
import { adminAuditKey, adminAuditTypesKey } from '../api/keys';
import { RequirePermission } from '../auth/permissions';
import { formatDate } from '../pages/format';
import { Table, type Column } from '../pages/Table';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { NoAccess } from './AdminLayout';
import { ChangeList } from './changes';
import { Pager } from './controls';

const PAGE_SIZE = 25;

/** What a row changed, readable: a disclosure with the fields and their old and new values. */
function Changes({ entry }: { entry: AuditEntry }) {
  const changes = entry.changes as AuditChange[];
  if (changes.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <details>
      <summary className="cursor-pointer text-primary">
        {changes.length} {changes.length === 1 ? 'change' : 'changes'}
        <span className="sr-only"> to {entry.object_type}</span>
      </summary>
      <div className="mt-2 min-w-72">
        <ChangeList label={`Changes in entry ${entry.id}`} changes={changes} />
      </div>
    </details>
  );
}

const COLUMNS: Column<AuditEntry>[] = [
  { key: 'created_at', header: 'When', cell: (entry) => formatDate(entry.created_at) },
  { key: 'actor', header: 'Who', cell: (entry) => entry.actor_email || '—' },
  { key: 'action', header: 'Action', cell: (entry) => entry.action },
  {
    key: 'object',
    header: 'Object',
    cell: (entry) => `${entry.object_type} ${entry.object_id}`.trim(),
  },
  { key: 'changes', header: 'Changes', cell: (entry) => <Changes entry={entry} /> },
];

function Audit() {
  const ids = useId();
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [objectType, setObjectType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [offset, setOffset] = useState(0);
  const filters = {
    actor: actor.trim(),
    action: action.trim(),
    object_type: objectType,
    date_from: dateFrom,
    date_to: dateTo,
  };
  const params = { ...filters, limit: PAGE_SIZE, offset };
  const log = useQuery({ queryKey: adminAuditKey(params), queryFn: () => api.listAudit(params) });
  const types = useQuery({ queryKey: adminAuditTypesKey, queryFn: api.listAuditTypes });
  const filter = (set: (value: string) => void) => (value: string) => {
    set(value);
    setOffset(0);
  };
  const field = 'flex flex-col gap-1 text-sm text-slate-700';

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <a
          className="ml-auto inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm font-medium hover:bg-muted"
          href={api.auditExportUrl(filters)}
          download
        >
          Export CSV
        </a>
      </div>
      <form
        aria-label="Filter the audit log"
        className="mb-3 flex flex-wrap gap-3"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className={field} htmlFor={`${ids}-actor`}>
          Who
          <Input
            id={`${ids}-actor`}
            value={actor}
            placeholder="Email or id"
            onChange={(event) => filter(setActor)(event.target.value)}
          />
        </label>
        <label className={field} htmlFor={`${ids}-action`}>
          Action
          <Input
            id={`${ids}-action`}
            value={action}
            placeholder="user.update"
            onChange={(event) => filter(setAction)(event.target.value)}
          />
        </label>
        <label className={field} htmlFor={`${ids}-type`}>
          Object type
          <NativeSelect
            id={`${ids}-type`}
            value={objectType}
            onChange={(event) => filter(setObjectType)(event.target.value)}
          >
            <option value="">Any</option>
            {(types.data ?? []).map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className={field} htmlFor={`${ids}-from`}>
          From
          <Input
            id={`${ids}-from`}
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(event) => filter(setDateFrom)(event.target.value)}
          />
        </label>
        <label className={field} htmlFor={`${ids}-to`}>
          To
          <Input
            id={`${ids}-to`}
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(event) => filter(setDateTo)(event.target.value)}
          />
        </label>
      </form>
      <Table
        label="Audit log"
        columns={COLUMNS}
        rows={log.data?.rows}
        rowKey={(entry) => entry.id}
        loading={log.isPending}
        error={log.error?.message ?? null}
        empty="No entries match."
      />
      <Pager offset={offset} limit={PAGE_SIZE} total={log.data?.total ?? 0} onOffset={setOffset} />
    </>
  );
}

export function AuditPage() {
  return (
    <RequirePermission permission="audit.view" fallback={<NoAccess />}>
      <Audit />
    </RequirePermission>
  );
}
