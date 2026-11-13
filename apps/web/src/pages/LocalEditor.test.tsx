import type { DesignDocument } from '@ezd/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalEditor } from './LocalEditor';
import {
  createLocalRepository,
  type DesignRepository,
  serializeDocument,
  STORAGE_KEY,
} from '../lib/repository';
import { room, seedItem, WALLS } from '../test/kitchen';

// jsdom has no canvas, so the drawing itself is left to the Playwright tests.
vi.mock('react-konva', () => {
  const nothing = () => null;
  return {
    Stage: nothing,
    Layer: nothing,
    Group: nothing,
    Line: nothing,
    Rect: nothing,
    Shape: nothing,
    Circle: nothing,
    Text: nothing,
  };
});

const [A] = WALLS;
const kitchen = () => room(144, 120, seedItem('item-000001', 'base.standard', A, 12));

function memoryRepository(doc: DesignDocument | null = null, notice?: string) {
  const saved: DesignDocument[] = [];
  const repository: DesignRepository = {
    load: async () => ({ doc, ...(notice !== undefined && { notice }) }),
    save: async (next) => void saved.push(next),
  };
  return { repository, saved };
}

/** Renders the app and waits for the design to load. */
async function open(repository: DesignRepository) {
  render(<LocalEditor repository={repository} />);
  await screen.findByRole('toolbar', { name: 'Editor' });
}

beforeEach(() => localStorage.clear());
afterEach(() => void vi.useRealTimers());

describe('LocalEditor', () => {
  it('lays out the toolbar, the catalog, the canvas and the two panels', async () => {
    await open(memoryRepository().repository);
    expect(screen.getByRole('heading', { name: 'EZDesign' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Catalog' })).toBeInTheDocument();
    expect(screen.getByRole('application', { name: /^Plan view/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Properties' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /^Validation/ })).toBeInTheDocument();
  });

  it('starts a new, empty design when nothing is stored', async () => {
    await open(memoryRepository().repository);
    const doc = window.__ezd!.getDoc();
    expect(doc).toMatchObject({ name: 'Untitled kitchen', items: [], room: { walls: [] } });
    expect(window.__ezd!.getHistoryLength()).toBe(0);
  });

  it('restores the stored design', async () => {
    await open(memoryRepository(kitchen()).repository);
    expect(window.__ezd!.getDoc()).toEqual(kitchen());
    expect(screen.getByRole('radio', { name: 'Elevation D' })).toBeInTheDocument();
  });

  it('survives a reload: what was saved to localStorage comes back', async () => {
    localStorage.setItem(STORAGE_KEY, serializeDocument(kitchen()));
    await open(createLocalRepository());
    expect(window.__ezd!.getDoc()).toEqual(kitchen());
  });

  it('discards a corrupt entry with a visible notice', async () => {
    localStorage.setItem(STORAGE_KEY, '{"schemaVersion":1,"oops":true}');
    await open(createLocalRepository());
    expect(screen.getByRole('status')).toHaveTextContent(
      'The saved design could not be read and was discarded.',
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.__ezd!.getDoc().items).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('autosaves 500 ms after a command', async () => {
    const { repository, saved } = memoryRepository(kitchen());
    await open(repository);
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: 'Add Sink base cabinet' }));
    expect(window.__ezd!.getHistoryLength()).toBe(1);
    act(() => void vi.advanceTimersByTime(499));
    expect(saved).toEqual([]);
    act(() => void vi.advanceTimersByTime(1));
    expect(saved).toEqual([window.__ezd!.getDoc()]);
  });

  it('replaces the design, with an empty history, when a file is imported', async () => {
    const { repository, saved } = memoryRepository();
    await open(repository);
    fireEvent.click(screen.getByRole('button', { name: 'Add Base cabinet' }));
    expect(window.__ezd!.getHistoryLength()).toBe(1);

    fireEvent.change(screen.getByTestId('import-file'), {
      target: { files: [new File([serializeDocument(kitchen())], 'kitchen.json')] },
    });

    await waitFor(() => expect(window.__ezd!.getDoc()).toEqual(kitchen()));
    expect(window.__ezd!.getHistoryLength()).toBe(0);
    // The imported design is what is stored, not a late save of the one it replaced.
    expect(saved.at(-1)).toEqual(kitchen());
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });
});

describe('the editor from the keyboard', () => {
  const canvas = () => screen.getByRole('application');
  it('announces the selected item in a live region', async () => {
    await open(memoryRepository(kitchen()).repository);
    const live = screen.getByTestId('announcement');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent('');

    fireEvent.keyDown(canvas(), { key: 'Tab' });
    expect(live).toHaveTextContent('Base cabinet 30" at 12" on wall A, selected');
  });

  it('nudges with the arrows and removes with Delete', async () => {
    await open(memoryRepository(kitchen()).repository);
    fireEvent.keyDown(canvas(), { key: 'Tab' });
    fireEvent.keyDown(canvas(), { key: 'ArrowRight' });
    expect(screen.getByTestId('announcement')).toHaveTextContent('at 15" on wall A');
    expect(
      within(screen.getByRole('region', { name: 'Properties' })).getByLabelText(/Offset/),
    ).toHaveValue('15"');

    fireEvent.keyDown(canvas(), { key: 'Delete' });
    expect(window.__ezd!.getDoc().items).toEqual([]);
    expect(window.__ezd!.getHistoryLength()).toBe(2);
  });

  it('undoes and redoes with the keyboard, but not while typing in a field', async () => {
    await open(memoryRepository(kitchen()).repository);
    fireEvent.keyDown(canvas(), { key: 'Tab' });
    fireEvent.keyDown(canvas(), { key: 'ArrowRight' });

    const offset = screen.getByLabelText(/Offset/);
    fireEvent.keyDown(offset, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(offset, { key: 'Backspace' });
    expect(window.__ezd!.getHistoryLength()).toBe(1);
    expect(window.__ezd!.getDoc().items).toHaveLength(1);

    fireEvent.keyDown(canvas(), { key: 'z', ctrlKey: true });
    expect(window.__ezd!.getHistoryLength()).toBe(0);
    expect(window.__ezd!.getDoc()).toEqual(kitchen());
    fireEvent.keyDown(canvas(), { key: 'z', ctrlKey: true, shiftKey: true });
    expect(window.__ezd!.getHistoryLength()).toBe(1);
  });

  it('goes back to the select tool with Escape', async () => {
    await open(memoryRepository(kitchen()).repository);
    fireEvent.click(screen.getByRole('radio', { name: 'Wall' }));
    expect(screen.getByLabelText('Wall length')).toBeInTheDocument();

    fireEvent.keyDown(canvas(), { key: 'Escape' });
    expect(screen.getByRole('radio', { name: 'Select' })).toBeChecked();
    expect(screen.queryByLabelText('Wall length')).not.toBeInTheDocument();
  });

  it('switches to an elevation of a wall', async () => {
    await open(memoryRepository(kitchen()).repository);
    fireEvent.click(screen.getByRole('radio', { name: 'Elevation A' }));
    expect(screen.getByRole('application', { name: /^Elevation of wall A/ })).toBeInTheDocument();
  });
});
