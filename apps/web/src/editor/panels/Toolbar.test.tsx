import { type DesignDocument, inches } from '@ezd/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { serializeDocument } from '../../lib/repository';
import { room, seedItem, storeFor, WALLS } from '../../test/kitchen';
import { renderWithStore } from '../../test/render';
import { Toolbar } from './Toolbar';

const [A, B] = WALLS;
const kitchen = () => room(144, 120, seedItem('item-000001', 'base.standard', A, 12));

function setup(doc: DesignDocument = kitchen()) {
  const store = storeFor(doc);
  const onLoadDocument = vi.fn();
  const onToggleMaterials = vi.fn();
  renderWithStore(
    <Toolbar
      onLoadDocument={onLoadDocument}
      materialsOpen={false}
      onToggleMaterials={onToggleMaterials}
    />,
    store,
  );
  return { store, onLoadDocument, onToggleMaterials };
}

const importFile = (text: string) =>
  fireEvent.change(screen.getByTestId('import-file'), {
    target: { files: [new File([text], 'design.json', { type: 'application/json' })] },
  });

describe('Toolbar', () => {
  it('opens the materials panel', () => {
    const { onToggleMaterials } = setup();
    const materials = screen.getByRole('button', { name: 'Materials' });
    expect(materials).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(materials);
    expect(onToggleMaterials).toHaveBeenCalledTimes(1);
  });

  it('switches tools', () => {
    const { store } = setup();
    expect(screen.getByRole('radio', { name: 'Select' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Wall' }));
    expect(store.getState().tool).toBe('wall');

    expect(screen.queryByRole('radio', { name: 'Window' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Opening' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Window' }));
    expect(store.getState()).toMatchObject({ tool: 'opening', openingKind: 'window' });
  });

  it('disables undo and redo when there is nothing to undo or redo', () => {
    const { store } = setup();
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Generate countertops' }));
    expect(undo).toBeEnabled();
    expect(redo).toBeDisabled();

    fireEvent.click(undo);
    expect(undo).toBeDisabled();
    expect(redo).toBeEnabled();
    expect(store.getState().doc).toEqual(kitchen());

    fireEvent.click(redo);
    expect(store.getState().doc.countertops).toHaveLength(1);
  });

  it('generates countertops as one batch', () => {
    const { store } = setup(
      room(
        144,
        120,
        seedItem('item-000001', 'base.standard', A, 12),
        seedItem('item-000002', 'base.sink', B, 48),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Generate countertops' }));

    const { history, doc } = store.getState();
    expect(history.past).toHaveLength(1);
    expect(history.past[0]!.command).toMatchObject({ type: 'batch' });
    expect(doc.countertops.map((top) => [top.wallId, top.startOffset, top.endOffset])).toEqual([
      [A, inches(12), inches(42)],
      [B, inches(48), inches(84)],
    ]);

    // Nothing more to add the second time.
    fireEvent.click(screen.getByRole('button', { name: 'Generate countertops' }));
    expect(store.getState().history.past).toHaveLength(1);
    expect(store.getState().notice).toMatch(/already has a countertop/);
  });

  it('switches between the plan and one elevation per wall', () => {
    const { store } = setup();
    const views = within(screen.getByRole('radiogroup', { name: 'View' })).getAllByRole('radio');
    expect(views.map((view) => view.getAttribute('aria-label') ?? view.textContent)).toEqual([
      'Plan',
      'Elevation A',
      'Elevation B',
      'Elevation C',
      'Elevation D',
    ]);
    fireEvent.click(screen.getByRole('radio', { name: 'Elevation B' }));
    expect(store.getState().view).toEqual({ kind: 'elevation', wallId: B });
    fireEvent.click(screen.getByRole('radio', { name: 'Plan' }));
    expect(store.getState().view).toEqual({ kind: 'plan' });
  });

  it('fits the view to the room', () => {
    const { store } = setup();
    store.getState().setCanvasSize({ width: 800, height: 600 });
    store.getState().setViewport({ scale: 30, offsetX: -5000, offsetY: 9000 });
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    const { viewport } = store.getState();
    // The middle of the 144 by 120 in room is in the middle of the canvas.
    expect(viewport.offsetX + 72 * viewport.scale).toBeCloseTo(400, 6);
    expect(viewport.offsetY + 60 * viewport.scale).toBeCloseTo(300, 6);
  });

  it('imports a valid file by handing the document over', async () => {
    const { onLoadDocument } = setup(room());
    importFile(serializeDocument(kitchen()));
    await waitFor(() => expect(onLoadDocument).toHaveBeenCalledWith(kitchen()));
  });

  it('shows the schema errors of a bad file instead of loading it', async () => {
    const { store, onLoadDocument } = setup();
    const bad = { ...kitchen(), items: [{ ...kitchen().items[0], width: 30.5, depth: -1 }] };
    importFile(JSON.stringify(bad));

    const dialog = await screen.findByRole('dialog', { name: 'The file was not imported' });
    expect(within(dialog).getByText('items[0].width:')).toBeInTheDocument();
    expect(within(dialog).getByText('items[0].depth:')).toBeInTheDocument();
    expect(onLoadDocument).not.toHaveBeenCalled();
    expect(store.getState().doc).toEqual(kitchen());

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('says so when the file is not JSON at all', async () => {
    const { onLoadDocument } = setup();
    importFile('not json');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('The file is not valid JSON.')).toBeInTheDocument();
    expect(onLoadDocument).not.toHaveBeenCalled();
  });
});

describe('room template', () => {
  const open = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Room template' }));
    return screen.getByRole('dialog', { name: 'Room template' });
  };
  const type = (dialog: HTMLElement, label: string, text: string) =>
    fireEvent.change(within(dialog).getByLabelText(label), { target: { value: text } });

  it('creates a rectangle room from typed dimensions as one batch', async () => {
    const { store } = setup(storeFor(room()).getState().doc);
    const before = store.getState().doc.room.walls.length;
    const dialog = open();
    type(dialog, 'Width', '120');
    type(dialog, 'Depth', '96 1/2');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create room' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const { doc, history } = store.getState();
    expect(history.past).toHaveLength(1);
    expect(history.past[0]!.command.type).toBe('batch');
    expect(doc.room.walls).toHaveLength(before + 4);
    expect(doc.room.walls.at(-3)).toMatchObject({
      start: { x: inches(120), y: 0 },
      end: { x: inches(120), y: inches(96.5) },
    });
  });

  it('asks for the cut-out of an L or a U, and creates six or eight walls', () => {
    const { store } = setup();
    const dialog = open();
    expect(within(dialog).queryByLabelText('Cut-out width')).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Shape'), { target: { value: 'u' } });
    type(dialog, 'Cut-out width', '60');
    type(dialog, 'Cut-out depth', '30');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create room' }));
    expect(store.getState().doc.room.walls).toHaveLength(4 + 8);
  });

  it('shows what is wrong with the dimensions and creates nothing', () => {
    const { store } = setup();
    const dialog = open();
    type(dialog, 'Width', '3 m');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create room' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Lengths are in inches only');

    type(dialog, 'Width', '120');
    fireEvent.change(within(dialog).getByLabelText('Shape'), { target: { value: 'l' } });
    type(dialog, 'Cut-out width', '120');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create room' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'The cut-out must be smaller than the room.',
    );
    expect(store.getState().history.past).toHaveLength(0);
  });
});
