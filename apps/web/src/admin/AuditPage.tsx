import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { api, type AuditEntry } from '../api/client';
import { adminAuditKey } from '../api/keys';
import { RequirePermission } from '../auth/permissions';
import { formatDate } from '../pages/format';
import { Table, type Column } from '../pages/Table';
import { NoAccess } from './AdminLayout';
import { FIELD, Pager } from './controls';

const PAGE_SIZE = 25;

const COLUMNS: Column<AuditEntry>[] = [
  { key: 'created_at', header: 'When', cell: (entry) => formatDate(entry.created_at) },
  { key: 'actor', header: 'Who', cell: (entry) => entry.actor_email || '—' },
  { key: 'action', header: 'Action', cell: (entry) => entry.action },
  {
    key: 'object',
    header: 'Object',
    cell: (entry) => `${entry.object_type} ${entry.object_id}`.trim(),
  },
];

function Audit() {
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);
  const params = { actor: actor.trim(), action: action.trim(), limit: PAGE_SIZE, offset };
  const log = useQuery({ queryKey: adminAuditKey(params), queryFn: () => api.listAudit(params) });

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Audit log</h1>
      <div className="mb-3 flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Who
          <input
            className={FIELD}
            value={actor}
            placeholder="Email or id"
            onChange={(event) => {
              setActor(event.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Action
          <input
            className={FIELD}
            value={action}
            placeholder="user.update"
            onChange={(event) => {
              setAction(event.target.value);
              setOffset(0);
            }}
          />
        </label>
      </div>
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
