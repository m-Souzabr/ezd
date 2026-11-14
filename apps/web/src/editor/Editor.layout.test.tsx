import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DesignStoreProvider } from '../store/context';
import { WithConfig } from '../test/config';
import { room, seedItem, storeFor, WALLS } from '../test/kitchen';
import { Editor } from './Editor';

// Konva needs a canvas, which jsdom does not have.
vi.mock('./plan/PlanCanvas', () => ({ PlanCanvas: () => <div data-testid="plan" /> }));
vi.mock('./elevation/ElevationCanvas', () => ({ ElevationCanvas: () => null }));

const [A] = WALLS;
const ITEM = 'item-000001';

/** Makes `(min-width: Nrem)` queries match as they would on a screen `width` pixels wide. */
function screenWidth(width: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const min = /min-width:\s*([\d.]+)rem/.exec(query);
    return {
      matches: min ? width >= Number(min[1]) * 16 : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  });
}

function setup(width: number) {
  screenWidth(width);
  const store = storeFor(room(144, 120, seedItem(ITEM, 'base.standard', A, 12)));
  render(
    <WithConfig input={{}}>
      <DesignStoreProvider store={store}>
        <Editor onLoadDocument={() => {}} assistant={<p>Chat panel</p>} />
      </DesignStoreProvider>
    </WithConfig>,
  );
  return store;
}

// The sheets and the drawer are loaded when the screen is narrow; load them now.
beforeAll(() => import('./EditorOverlays'));

afterEach(() => vi.restoreAllMocks());

describe('the editor layout', () => {
  it('has the three columns and the assistant from 1024 px, and no panel buttons', () => {
    setup(1280);
    for (const name of ['Catalog', 'Properties', /^Validation/]) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Chat panel')).toBeInTheDocument();
    const toolbar = screen.getByRole('toolbar', { name: 'Editor' });
    for (const name of ['Catalog', 'Properties', 'Assistant']) {
      expect(within(toolbar).queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('turns the panels into sheets below 1024 px, opened from the toolbar', async () => {
    setup(800);
    expect(screen.queryByRole('region', { name: 'Catalog' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Properties' })).not.toBeInTheDocument();
    // The assistant waits in its closed sheet.
    await waitFor(() => expect(screen.getByText('Chat panel')).not.toBeVisible());
    expect(screen.getByTestId('plan')).toBeVisible();

    const toolbar = screen.getByRole('toolbar', { name: 'Editor' });
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Catalog' }));
    const catalog = await screen.findByRole('dialog', { name: 'Catalog' });
    expect(within(catalog).getByRole('region', { name: 'Catalog' })).toBeInTheDocument();
  });

  it('shows the properties and the checks in one sheet', async () => {
    setup(800);
    fireEvent.click(screen.getByRole('button', { name: 'Properties' }));
    const sheet = await screen.findByRole('dialog', { name: 'Properties and checks' });
    expect(within(sheet).getByRole('region', { name: 'Properties' })).toBeInTheDocument();
    expect(within(sheet).getByRole('region', { name: /^Validation/ })).toBeInTheDocument();
  });

  it('closes the catalog sheet after an item is added from it', async () => {
    const store = setup(800);
    fireEvent.click(screen.getByRole('button', { name: 'Catalog' }));
    const sheet = await screen.findByRole('dialog', { name: 'Catalog' });
    fireEvent.click(within(sheet).getAllByRole('button', { name: /^Add / })[0]!);
    expect(store.getState().doc.items).toHaveLength(2);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Catalog' })).toBeNull());
  });

  it('keeps the assistant mounted while its sheet is closed', async () => {
    setup(800);
    const chat = screen.getByText('Chat panel', { selector: 'p' });
    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }));
    expect(await screen.findByRole('dialog', { name: 'Assistant' })).toBeVisible();
    expect(screen.getByText('Chat panel')).toBe(chat);
  });

  it('ignores the global keys while a sheet is open, not while a closed one is mounted', async () => {
    const store = setup(800);
    const press = (key: string) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      window.dispatchEvent(event);
    };
    store.getState().select([ITEM]);

    // The assistant's sheet is mounted but closed: Delete still removes the selection.
    press('Delete');
    expect(store.getState().doc.items).toHaveLength(0);
    store.getState().undo();
    store.getState().select([ITEM]);

    fireEvent.click(screen.getByRole('button', { name: 'Properties' }));
    await screen.findByRole('dialog', { name: 'Properties and checks' });
    press('Delete');
    expect(store.getState().doc.items).toHaveLength(1);
  });

  it('shows the materials under the canvas on a tablet and in a drawer on a phone', async () => {
    setup(800);
    fireEvent.click(screen.getByRole('button', { name: 'Materials' }));
    expect(screen.getByRole('region', { name: 'Bill of materials' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the materials as a bottom drawer on a phone', async () => {
    setup(375);
    fireEvent.click(screen.getByRole('button', { name: 'Materials' }));
    const drawer = await screen.findByRole('dialog', { name: 'Materials' });
    expect(within(drawer).getByRole('region', { name: 'Bill of materials' })).toBeInTheDocument();
  });
});

describe('the global keys', () => {
  it('wait while an alert dialog, such as the conflict choice, is open', () => {
    const store = setup(1280);
    store.getState().select([ITEM]);
    // What Base UI renders for an `AlertDialog`: `alertdialog`, not `dialog`.
    const alert = document.body.appendChild(document.createElement('div'));
    alert.setAttribute('role', 'alertdialog');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(store.getState().doc.items).toHaveLength(1);

    alert.remove();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(store.getState().doc.items).toHaveLength(0);
  });
});
