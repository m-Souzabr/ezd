import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as client from '@/api/client';
import { mockMedia } from '@/test/media';
import { ProjectsPage } from './Projects';

const project = (id: string, name: string) =>
  ({ id, name, created_at: '2026-01-02T10:00:00Z' }) as client.Project;

function setup() {
  const api = vi
    .spyOn(client.api, 'listProjects')
    .mockResolvedValue([project('p1', 'Lake house'), project('p2', 'Cabin')]);
  const archive = vi.spyOn(client.api, 'archiveProject').mockResolvedValue(undefined);
  const create = vi.spyOn(client.api, 'createProject');
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <ProjectsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { api, archive, create, user: userEvent.setup() };
}

beforeEach(() => mockMedia(true));
afterEach(() => vi.restoreAllMocks());

describe('the projects list', () => {
  it('shows the same rows as phone cards and as a desktop table', async () => {
    setup();
    const cards = await screen.findByRole('list', { name: 'Projects' });
    const table = screen.getByRole('table', { name: 'Projects' });
    const names = (root: HTMLElement) =>
      within(root)
        .getAllByRole('link')
        .map((link) => link.textContent);
    expect(names(cards)).toEqual(['Lake house', 'Cabin']);
    expect(names(table)).toEqual(names(cards));
    expect(within(cards).getAllByText(/Jan/)).toHaveLength(2);
    expect(within(table).getAllByText(/Jan/)).toHaveLength(2);
  });

  it('asks before it deletes, and deletes only when confirmed', async () => {
    const { archive, user } = setup();
    await screen.findByRole('table', { name: 'Projects' });
    const open = async () => {
      await user.click(screen.getAllByRole('button', { name: 'Actions for project Cabin' })[0]!);
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      return screen.findByRole('alertdialog', { name: 'Delete project?' });
    };

    const cancelled = await open();
    expect(archive).not.toHaveBeenCalled();
    await user.click(within(cancelled).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(archive).not.toHaveBeenCalled();

    const confirming = await open();
    expect(archive).not.toHaveBeenCalled();
    await user.click(within(confirming).getByRole('button', { name: 'Delete project' }));
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(1));
    expect(archive.mock.calls[0]![0]).toBe('p2');
  });

  it('shows a field error in the create dialog, and the server error when it refuses', async () => {
    const { create, user } = setup();
    await screen.findByRole('table', { name: 'Projects' });
    await user.click(screen.getByRole('button', { name: 'New project' }));
    const dialog = await screen.findByRole('dialog', { name: 'New project' });

    await user.click(within(dialog).getByRole('button', { name: 'Create project' }));
    expect(await within(dialog).findByText('Enter a name.')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    create.mockRejectedValue(new client.ApiError(400, { detail: 'Too many projects.' }));
    await user.type(within(dialog).getByLabelText('Project name'), 'Barn');
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Too many projects.');
    expect(screen.getByRole('dialog', { name: 'New project' })).toBeInTheDocument();
  });

  it('says so, with a way to start, when there are no projects', async () => {
    vi.spyOn(client.api, 'listProjects').mockResolvedValue([]);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <ProjectsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/No projects yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create your first project' })).toBeInTheDocument();
  });
});
