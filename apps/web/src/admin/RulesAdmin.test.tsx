import { type RulesConfigInput, validateRulesConfig, inches } from '@ezd/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as client from '../api/client';
import { type ConfigDraft } from '../api/client';
import { SESSION_KEY } from '../auth/session';
import { RulesContext } from '../config/useConfig';
import { makeUser } from '../test/users';
import { RulesAdminPage } from './RulesAdmin';

const rules = (input: RulesConfigInput) => {
  const checked = validateRulesConfig(input);
  if (!checked.ok) throw new Error(JSON.stringify(checked.error));
  return checked.value;
};

const draft = (overrides: Partial<ConfigDraft> = {}): ConfigDraft => ({
  revision: 0,
  app_config: {},
  rules_config: {},
  quote_defaults: {},
  based_on: null,
  updated_at: null,
  ...overrides,
});

function setup(options: { draft?: ConfigDraft; can?: boolean; inForce?: RulesConfigInput } = {}) {
  const spies = {
    getConfigDraft: vi
      .spyOn(client.api, 'getConfigDraft')
      .mockResolvedValue(options.draft ?? draft()),
    saveRulesDraft: vi
      .spyOn(client.api, 'saveRulesDraft')
      .mockImplementation(async (revision, config) =>
        draft({ revision: revision + 1, rules_config: config }),
      ),
    publishConfig: vi.spyOn(client.api, 'publishConfig').mockResolvedValue({
      number: 1,
      status: 'published',
      note: '',
      created_by: 'ada@example.com',
      created_at: '2026-01-02T03:04:05Z',
    }),
    listConfigVersions: vi.spyOn(client.api, 'listConfigVersions').mockResolvedValue([]),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(
    SESSION_KEY,
    makeUser({ permissions: options.can === false ? [] : ['config.rules.edit'] }),
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RulesContext.Provider value={rules(options.inForce ?? {})}>
        <MemoryRouter>
          <RulesAdminPage />
        </MemoryRouter>
      </RulesContext.Provider>
    </QueryClientProvider>,
  );
  return spies;
}

afterEach(() => vi.restoreAllMocks());

const row = (id: string) => screen.getByRole('rowheader', { name: new RegExp(id) }).closest('tr')!;

describe('the rules page', () => {
  it('is for those who may edit the rules', () => {
    setup({ can: false });
    expect(screen.getByText('Your role does not include this section.')).toBeInTheDocument();
  });

  it('lists every rule with its severity, switch and thresholds', async () => {
    setup();
    await screen.findByRole('table', { name: 'Design rules' });
    expect(screen.getAllByRole('row')).toHaveLength(22);
    const aisle = within(row('clearance.aisle'));
    expect(aisle.getByLabelText('Severity of clearance.aisle')).toHaveValue('warning');
    expect(aisle.getByRole('switch', { name: 'clearance.aisle is on' })).toBeChecked();
    expect(aisle.getByLabelText('Minimum aisle')).toHaveValue('36"');
    expect(aisle.getByLabelText('Recommended aisle')).toHaveValue('42"');
    expect(within(row('room.open')).getByText('None')).toBeInTheDocument();
  });

  it('shows the rules that protect the document as locked, with the reason', async () => {
    setup();
    await screen.findByRole('table', { name: 'Design rules' });
    for (const id of [
      'item.catalog',
      'item.overlap',
      'item.outside-wall',
      'item.outside-room',
      'opening.invalid',
      'corner.conflict',
      'size.standard',
    ]) {
      const locked = within(row(id));
      expect(locked.getByLabelText(`Severity of ${id}`)).toBeDisabled();
      expect(locked.getByRole('switch', { name: `${id} is on` })).toBeDisabled();
      expect(locked.getByText(/Locked: always on, always an error/)).toBeInTheDocument();
    }
    const open = within(row('item.blocks-door'));
    expect(open.getByLabelText('Severity of item.blocks-door')).toBeEnabled();
    expect(open.queryByText(/Locked/)).not.toBeInTheDocument();
  });

  it('saves a changed severity, switch and threshold with the revision it loaded', async () => {
    const { saveRulesDraft } = setup({ draft: draft({ revision: 4, based_on: 2 }) });
    await screen.findByRole('table', { name: 'Design rules' });
    fireEvent.change(screen.getByLabelText('Severity of clearance.aisle'), {
      target: { value: 'error' },
    });
    fireEvent.click(screen.getByRole('switch', { name: 'room.open is on' }));
    const minAisle = screen.getByLabelText('Minimum aisle');
    fireEvent.change(minAisle, { target: { value: '30' } });
    fireEvent.blur(minAisle);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveRulesDraft).toHaveBeenCalledTimes(1));
    const [revision, saved] = saveRulesDraft.mock.calls[0]!;
    expect(revision).toBe(4);
    const config = rules(saved as RulesConfigInput);
    expect(config.rules['clearance.aisle'].severity).toBe('error');
    expect(config.rules['room.open'].enabled).toBe(false);
    expect(config.thresholds.minAisle).toBe(inches(30));
    expect(await screen.findByText('Draft saved.')).toBeInTheDocument();
  });

  it('refuses a threshold outside its range with core’s message and keeps the old value', async () => {
    const { saveRulesDraft } = setup();
    await screen.findByRole('table', { name: 'Design rules' });
    const minAisle = screen.getByLabelText('Minimum aisle');
    fireEvent.change(minAisle, { target: { value: '20' } });
    fireEvent.blur(minAisle);
    expect(await screen.findByText('At least 24".')).toBeInTheDocument();
    fireEvent.change(minAisle, { target: { value: '80' } });
    fireEvent.blur(minAisle);
    expect(await screen.findByText('At most 72".')).toBeInTheDocument();
    // Nothing was changed, so there is nothing to save.
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(saveRulesDraft).not.toHaveBeenCalled();
  });

  it('refuses a threshold that breaks the order of its pair', async () => {
    setup();
    await screen.findByRole('table', { name: 'Design rules' });
    const recommended = screen.getByLabelText('Recommended aisle');
    fireEvent.change(recommended, { target: { value: '30' } });
    fireEvent.blur(recommended);
    expect(
      await screen.findByText('The recommended aisle cannot be below the minimum.'),
    ).toBeInTheDocument();
  });

  it('resets one rule, and then everything, to the defaults', async () => {
    setup({
      draft: draft({
        revision: 1,
        based_on: 1,
        rules_config: rules({
          rules: { 'clearance.aisle': { severity: 'info' }, 'wall.alignment': { enabled: false } },
          thresholds: { minAisle: inches(30) },
        }),
      }),
    });
    await screen.findByRole('table', { name: 'Design rules' });
    expect(screen.getByLabelText('Severity of clearance.aisle')).toHaveValue('info');
    fireEvent.click(screen.getByRole('button', { name: 'Reset clearance.aisle to defaults' }));
    expect(screen.getByLabelText('Severity of clearance.aisle')).toHaveValue('warning');
    expect(screen.getByLabelText('Minimum aisle')).toHaveValue('36"');
    expect(screen.getByRole('switch', { name: 'wall.alignment is on' })).not.toBeChecked();
    expect(
      screen.getByRole('button', { name: 'Reset clearance.aisle to defaults' }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Reset all to defaults' }));
    expect(screen.getByRole('switch', { name: 'wall.alignment is on' })).toBeChecked();
  });

  it('edits the snap options', async () => {
    const { saveRulesDraft } = setup();
    await screen.findByRole('region', { name: 'Snapping' });
    const grid = within(screen.getByRole('region', { name: 'Snapping' })).getByLabelText('Grid');
    expect(grid).toHaveValue('3"');
    fireEvent.change(grid, { target: { value: '1' } });
    fireEvent.blur(grid);
    const step = screen.getByLabelText('Free rotation step (degrees)');
    fireEvent.change(step, { target: { value: '7' } });
    expect(await screen.findByText('A divisor of 360, such as 15, 45 or 90.')).toBeInTheDocument();
    fireEvent.change(step, { target: { value: '45' } });
    fireEvent.blur(step);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveRulesDraft).toHaveBeenCalled());
    const config = rules(saveRulesDraft.mock.calls[0]![1] as RulesConfigInput);
    expect(config.snap).toMatchObject({ grid: 16, freeRotationStep: 45 });
    fireEvent.change(step, { target: { value: 'x' } });
    expect(await screen.findByText('A whole number of degrees.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset snapping to defaults' }));
    expect(grid).toHaveValue('3"');
  });

  it('previews how many violations a sample kitchen has now and with the draft', async () => {
    setup();
    const preview = await screen.findByTestId('rules-preview');
    expect(preview).toHaveTextContent(/rules now find \d+ errors?, \d+ warnings?, \d+ info/);
    expect(preview).toHaveTextContent('These settings find the same.');
    fireEvent.click(screen.getByRole('switch', { name: 'clearance.aisle is on' }));
    expect(preview).toHaveTextContent(/With these settings: /);
    expect(preview).not.toHaveTextContent('find the same');
  });

  it('publishes what is on screen with a note', async () => {
    const { saveRulesDraft, publishConfig } = setup();
    await screen.findByRole('table', { name: 'Design rules' });
    fireEvent.click(screen.getByRole('switch', { name: 'room.open is on' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish…' }));
    fireEvent.change(await screen.findByLabelText(/^Note/), { target: { value: 'Quieter' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(publishConfig).toHaveBeenCalledTimes(1));
    expect(saveRulesDraft).toHaveBeenCalledTimes(1);
    expect(publishConfig).toHaveBeenCalledWith(1, 'Quieter');
    expect(await screen.findByText('Published as version 1.')).toBeInTheDocument();
  });

  it('shows the server’s refusal', async () => {
    const { saveRulesDraft } = setup();
    saveRulesDraft.mockRejectedValue(
      new client.ApiError(422, {
        detail: 'The configuration is not valid.',
        errors: [{ path: 'thresholds.minAisle', message: 'Nope.' }],
      }),
    );
    await screen.findByRole('table', { name: 'Design rules' });
    fireEvent.click(screen.getByRole('switch', { name: 'room.open is on' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
