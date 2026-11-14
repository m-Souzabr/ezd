import { useState, type ReactNode } from 'react';
import { PencilIcon, Trash2Icon } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { ConfirmDialog } from '@/components/patterns/confirm-dialog';
import { DataList, type DataListColumn, type DataListSort } from '@/components/patterns/data-list';
import { FormActions, FormSection, TextField } from '@/components/patterns/form-section';
import { PageHeader } from '@/components/patterns/page-header';
import { ResponsiveDialog } from '@/components/patterns/responsive-dialog';
import { ResponsiveMenu } from '@/components/patterns/responsive-menu';
import { EmptyState, ErrorState, LoadingState } from '@/components/patterns/state-views';
import { ThemeToggle } from '@/components/patterns/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

const COLOR_TOKENS = [
  'background',
  'foreground',
  'card',
  'popover',
  'primary',
  'secondary',
  'muted',
  'accent',
  'destructive',
  'success',
  'warning',
  'info',
  'border',
  'input',
  'ring',
] as const;

type SampleRow = { id: string; name: string; status: 'Draft' | 'Quoted'; total: number };

const SAMPLE_ROWS: SampleRow[] = [
  { id: 'a', name: 'Kitchen, Smith house', status: 'Quoted', total: 1_284_500 },
  { id: 'b', name: 'Laundry room', status: 'Draft', total: 342_000 },
  { id: 'c', name: 'Basement bar', status: 'Draft', total: 905_250 },
];

const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function DialogDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open responsive dialog
      </Button>
      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title="Rename project"
        description="A dialog from 768 px, a drawer below."
        footer={<Button onClick={() => setOpen(false)}>Save</Button>}
      >
        <Field>
          <FieldLabel htmlFor="ds-dialog-name">Name</FieldLabel>
          <Input id="ds-dialog-name" defaultValue="Kitchen, Smith house" />
        </Field>
      </ResponsiveDialog>
    </>
  );
}

function ConfirmDemo() {
  const [open, setOpen] = useState(false);
  const [deleted, setDeleted] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Delete project
      </Button>
      {deleted ? <p className="text-sm text-muted-foreground">Deleted.</p> : null}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this project?"
        description="The project and its designs are removed. This cannot be undone."
        confirmLabel="Delete project"
        onConfirm={() => setDeleted(true)}
      />
    </div>
  );
}

function DataListDemo() {
  const [sort, setSort] = useState<DataListSort>({ id: 'name', descending: false });
  const columns: DataListColumn<SampleRow>[] = [
    { id: 'name', header: 'Name', cell: (row) => row.name, primary: true, sortable: true },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge variant={row.status === 'Quoted' ? 'success' : 'secondary'}>{row.status}</Badge>
      ),
    },
    {
      id: 'total',
      header: 'Total',
      cell: (row) => dollars(row.total),
      sortable: true,
      desktopOnly: true,
    },
  ];
  const rows = [...SAMPLE_ROWS].sort((a, b) => {
    const order = sort.id === 'total' ? a.total - b.total : a.name.localeCompare(b.name, 'en-US');
    return sort.descending ? -order : order;
  });
  return (
    <DataList
      caption="Sample projects"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      sort={sort}
      onSortChange={setSort}
      rowActions={(row) => (
        <ResponsiveMenu
          label={`Actions for ${row.name}`}
          actions={[
            {
              id: 'rename',
              label: 'Rename',
              icon: <PencilIcon aria-hidden="true" />,
              onSelect: () => undefined,
            },
            {
              id: 'delete',
              label: 'Delete',
              icon: <Trash2Icon aria-hidden="true" />,
              destructive: true,
              onSelect: () => undefined,
            },
          ]}
        />
      )}
    />
  );
}

type SampleForm = { name: string; email: string; width: string };

function FormDemo() {
  const { control, handleSubmit } = useForm<SampleForm>({
    defaultValues: { name: '', email: 'not-an-email', width: '' },
  });
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        void handleSubmit(() => undefined)(event);
      }}
    >
      <FormSection title="Client" description="Fields sit in two columns from 768 px.">
        <TextField control={control} name="name" label="Name" autoComplete="name" required />
        <TextField
          control={control}
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          description="Shown on the quote."
        />
        <TextField control={control} name="width" label="Width" inputMode="decimal" />
      </FormSection>
      <FormActions>
        <Button type="submit">Save</Button>
      </FormActions>
    </form>
  );
}

function FormErrorDemo() {
  const { control } = useForm<SampleForm>({
    defaultValues: { name: '', email: '', width: '' },
    errors: { name: { type: 'required', message: 'Enter a name.' } },
  });
  return (
    <FormSection title="Form section with an error">
      <TextField control={control} name="name" label="Name" required />
    </FormSection>
  );
}

/** The live gallery of tokens, components and patterns. Development and test builds only. */
export function DesignSystemPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-8">
        <PageHeader
          title="Design system"
          description="Tokens, components and patterns used across the app."
          actions={<ThemeToggle />}
        />

        <Section title="Colors">
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
            {COLOR_TOKENS.map((token) => (
              <li key={token} className="space-y-1">
                <div
                  className="h-12 rounded-md border"
                  style={{ backgroundColor: `var(--${token})` }}
                />
                <p className="text-xs text-muted-foreground">{token}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Typography">
          <div className="space-y-2">
            <p className="text-3xl font-semibold tracking-tight">Display 30/36</p>
            <p className="text-2xl font-semibold tracking-tight">Page title 24/32</p>
            <p className="text-xl font-semibold">Section title 20/28</p>
            <p>Body 16/24</p>
            <p className="text-sm">Small 14/20</p>
            <p className="text-xs text-muted-foreground">Caption 12/16</p>
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Default</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button size="touch">Touch</Button>
            <Button size="icon-touch" aria-label="Edit">
              <PencilIcon aria-hidden="true" />
            </Button>
            <Button disabled>Disabled</Button>
            <Button disabled>
              <Spinner data-icon="inline-start" />
              Saving
            </Button>
          </div>
        </Section>

        <Section title="Badges">
          <div className="flex flex-wrap items-center gap-3">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
            <Badge variant="success">Success</Badge>
            <Badge variant="warning">Warning</Badge>
            <Badge variant="info">Info</Badge>
          </div>
        </Section>

        <Section title="Form controls">
          <div className="grid max-w-xl gap-4">
            <Field>
              <FieldLabel htmlFor="ds-input">Text input</FieldLabel>
              <Input id="ds-input" placeholder="Placeholder" />
              <FieldDescription>Helper text sits under the input.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="ds-textarea">Text area</FieldLabel>
              <Textarea id="ds-textarea" />
            </Field>
            <Field orientation="horizontal" className="min-h-11">
              <Checkbox id="ds-checkbox" />
              <FieldLabel htmlFor="ds-checkbox">Checkbox</FieldLabel>
            </Field>
            <Field orientation="horizontal" className="min-h-11">
              <Switch id="ds-switch" />
              <FieldLabel htmlFor="ds-switch">Switch</FieldLabel>
            </Field>
          </div>
        </Section>

        <Section title="States">
          <div className="grid gap-6 md:grid-cols-3">
            <LoadingState label="Loading example" />
            <EmptyState
              title="Nothing here yet"
              description="Empty states explain what will appear."
            />
            <ErrorState
              title="Something went wrong"
              description="Error states offer a way to retry."
              onRetry={() => undefined}
            />
          </div>
        </Section>

        <Section title="ResponsiveDialog">
          <DialogDemo />
        </Section>

        <Section title="ResponsiveMenu">
          <ResponsiveMenu
            label="Project actions"
            actions={[
              {
                id: 'rename',
                label: 'Rename',
                icon: <PencilIcon aria-hidden="true" />,
                onSelect: () => undefined,
              },
              {
                id: 'delete',
                label: 'Delete',
                icon: <Trash2Icon aria-hidden="true" />,
                destructive: true,
                onSelect: () => undefined,
              },
            ]}
          />
        </Section>

        <Section title="ConfirmDialog">
          <ConfirmDemo />
        </Section>

        <Section title="DataList">
          <p className="text-sm text-muted-foreground">
            Cards under 768 px, a sortable table from 768 px.
          </p>
          <DataListDemo />
        </Section>

        <Section title="FormSection">
          <FormDemo />
          <FormErrorDemo />
        </Section>
      </div>
    </div>
  );
}
