import type { AppConfigInput } from '@ezd/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockMedia } from '../test/media';
import { room, seedItem, storeFor, WALLS } from '../test/kitchen';
import { WithConfig } from '../test/config';
import { DesignStoreProvider } from '../store/context';
import { handleGlobalKey } from '../lib/shortcuts';
import { Editor } from './Editor';
import { CatalogPanel } from './panels/CatalogPanel';
import { HelpDialog } from './panels/HelpDialog';
import { Toolbar } from './panels/Toolbar';

// Konva needs a canvas, which jsdom does not have.
vi.mock('./plan/PlanCanvas', () => ({ PlanCanvas: () => <div data-testid="plan" /> }));
vi.mock('./elevation/ElevationCanvas', () => ({ ElevationCanvas: () => null }));

// The help dialog is loaded when first opened.
beforeAll(() => import('./panels/HelpDialogBody'));

// A desktop screen: the panels are columns. The narrow layout is tested in Editor.layout.test.tsx.
beforeEach(() => mockMedia(true));

const [A] = WALLS;
const kitchen = () => room(144, 120, seedItem('item-000001', 'base.standard', A, 12));

function renderEditor(input: AppConfigInput, assistant = true) {
  const store = storeFor(kitchen());
  render(
    <WithConfig input={input}>
      <DesignStoreProvider store={store}>
        <Editor onLoadDocument={() => {}} assistant={assistant ? <p>Chat panel</p> : undefined} />
      </DesignStoreProvider>
    </WithConfig>,
  );
  return store;
}

const toolbar = (input: AppConfigInput) =>
  render(
    <WithConfig input={input}>
      <DesignStoreProvider store={storeFor(kitchen())}>
        <Toolbar onLoadDocument={() => {}} materialsOpen={false} onToggleMaterials={() => {}} />
      </DesignStoreProvider>
    </WithConfig>,
  );

describe('the default configuration', () => {
  it('shows everything', () => {
    renderEditor({});
    for (const name of ['Properties', /^Validation/, 'Catalog']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    expect(screen.getByText('Chat panel')).toBeInTheDocument();
    for (const name of ['Undo', 'Redo', 'Fit', 'Generate countertops', 'Materials', 'Help']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /properties/i })).not.toBeInTheDocument();
  });
});

describe('panels', () => {
  it('hides the properties window', () => {
    renderEditor({ panels: { properties: { visible: false } } });
    expect(screen.queryByRole('region', { name: 'Properties' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^Validation/ })).toBeInTheDocument();
  });

  it('starts the properties window collapsed, and opens and closes it', () => {
    renderEditor({ panels: { properties: { defaultCollapsed: true } } });
    expect(screen.queryByRole('region', { name: 'Properties' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show properties' }));
    expect(screen.getByRole('region', { name: 'Properties' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide properties' }));
    expect(screen.queryByRole('region', { name: 'Properties' })).not.toBeInTheDocument();
  });

  it('hides the validation panel, and the whole right side when both are hidden', () => {
    renderEditor({ panels: { validation: { visible: false } } });
    expect(screen.queryByRole('region', { name: /^Validation/ })).not.toBeInTheDocument();
  });

  it('hides the right side when both panels are hidden', () => {
    renderEditor({
      panels: { properties: { visible: false }, validation: { visible: false } },
    });
    expect(screen.queryByRole('region', { name: 'Properties' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Validation/ })).not.toBeInTheDocument();
  });

  it('hides the catalog', () => {
    renderEditor({ panels: { catalog: { visible: false } } });
    expect(screen.queryByRole('region', { name: 'Catalog' })).not.toBeInTheDocument();
  });

  it('hides the materials button', () => {
    renderEditor({ panels: { materials: { visible: false } } });
    expect(screen.queryByRole('button', { name: 'Materials' })).not.toBeInTheDocument();
  });

  it('hides the assistant', () => {
    renderEditor({ features: { assistant: false } });
    expect(screen.queryByText('Chat panel')).not.toBeInTheDocument();
  });
});

describe('the catalog groups', () => {
  it('follows the configured order, titles and visibility', () => {
    render(
      <WithConfig
        input={{
          panels: {
            catalog: {
              order: ['tall', 'base', 'wall', 'corner', 'appliance', 'filler', 'panel'],
              groups: { base: { title: 'Lower units' }, wall: { visible: false } },
            },
          },
        }}
      >
        <DesignStoreProvider store={storeFor(kitchen())}>
          <CatalogPanel />
        </DesignStoreProvider>
      </WithConfig>,
    );
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Tall cabinets',
      'Lower units',
      'Corner cabinets',
      'Appliances',
      'Fillers',
      'Panels',
    ]);
  });
});

describe('the toolbar', () => {
  it('hides a tool', () => {
    toolbar({ toolbar: { tools: { wall: false, pan: false } } });
    expect(screen.queryByRole('radio', { name: 'Wall' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Pan' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Select' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Opening' })).toBeInTheDocument();
  });

  it.each([
    ['undoRedo', ['Undo', 'Redo']],
    ['fit', ['Fit']],
    ['countertops', ['Generate countertops']],
    ['help', ['Help']],
  ])('hides the %s button', (name, labels) => {
    toolbar({ toolbar: { buttons: { [name]: false } } });
    for (const label of labels) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });

  it('hides the view switcher', () => {
    toolbar({ toolbar: { buttons: { views: false } } });
    expect(screen.queryByRole('radio', { name: 'Plan' })).not.toBeInTheDocument();
  });

  it('hides room templates and JSON import and export', () => {
    toolbar({ features: { roomTemplates: false, jsonImportExport: false } });
    expect(screen.queryByRole('button', { name: 'Room template' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Export JSON' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import JSON' })).not.toBeInTheDocument();
  });
});

describe('shortcuts', () => {
  const press = (key: string) => ({
    key,
    shiftKey: false,
    ctrlKey: true,
    metaKey: false,
    altKey: false,
  });

  it('removes undo and redo with their buttons', () => {
    const store = storeFor(kitchen());
    expect(handleGlobalKey(press('z'), store, { undoRedo: true })).toBe(true);
    expect(handleGlobalKey(press('z'), store, { undoRedo: false })).toBe(false);
    expect(handleGlobalKey(press('y'), store, { undoRedo: false })).toBe(false);
  });

  it('is wired to the editor', () => {
    const store = renderEditor({ toolbar: { buttons: { undoRedo: false } } });
    const undo = vi.spyOn(store.getState(), 'undo');
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(undo).not.toHaveBeenCalled();
  });
});

describe('the help', () => {
  it('shows the configured steps', async () => {
    render(
      <WithConfig input={{ help: { steps: [{ title: 'Only step', text: 'Do the thing.' }] } }}>
        <HelpDialog trigger={<button type="button">Help</button>} />
      </WithConfig>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(await screen.findAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Only step.')).toBeInTheDocument();
  });
});
