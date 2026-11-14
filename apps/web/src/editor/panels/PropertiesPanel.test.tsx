import { inches } from '@ezd/core';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { apply, room, seedItem, storeFor, WALLS } from '../../test/kitchen';
import { renderWithStore } from '../../test/render';
import { openingCommand } from '../tools/opening';
import { PropertiesPanel } from './PropertiesPanel';

const [A] = WALLS;

function setup(...items: Parameters<typeof room>[2][]) {
  const store = storeFor(room(144, 120, ...items));
  const first = store.getState().doc.items[0];
  if (first) store.getState().select([first.id]);
  renderWithStore(<PropertiesPanel />, store);
  return store;
}

/** Types into a field and presses Enter. */
function enter(label: string | RegExp, text: string) {
  const field = screen.getByLabelText(label);
  fireEvent.change(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: 'Enter' });
  return field;
}

const optionTexts = (label: string) =>
  within(screen.getByLabelText(label))
    .getAllByRole('option')
    .map((option) => option.textContent);

describe('width', () => {
  it('rejects 31 for a base cabinet with the core message', () => {
    const store = setup(seedItem('item-000001', 'base.standard', A, 12));

    const field = enter('Width', '31');

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Width 31" is not allowed for base.standard. Use a multiple of 3" from 9" to 48".',
    );
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(store.getState().doc.items[0]!.width).toBe(inches(30));
    expect(store.getState().history.past).toHaveLength(0);
  });

  it('accepts a 3 in step as one command', () => {
    const store = setup(seedItem('item-000001', 'base.standard', A, 12));

    const field = enter('Width', '33');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(store.getState().doc.items[0]!.width).toBe(inches(33));
    expect(store.getState().history.past.map((entry) => entry.command.type)).toEqual([
      'item.resize',
    ]);
    expect(field).toHaveValue('33"');
  });

  it('offers the allowed widths as choices', () => {
    setup(seedItem('item-000001', 'appliance.fridge', A, 12));
    const list = document.getElementById(screen.getByLabelText('Width').getAttribute('list')!);
    expect([...list!.querySelectorAll('option')].map((option) => option.value)).toEqual([
      '30"',
      '33"',
      '36"',
    ]);
  });

  it('lets a filler take any width in its range, to 1/16 in', () => {
    const store = setup(seedItem('item-000001', 'filler.base', A, 12));
    enter('Width', '2 7/16');
    expect(store.getState().doc.items[0]!.width).toBe(39);
    enter('Width', '7');
    expect(screen.getByRole('alert')).toHaveTextContent('Use any width from 1/2" to 6".');
    expect(store.getState().doc.items[0]!.width).toBe(39);
  });

  it('keeps a square corner cabinet square', () => {
    const store = setup(seedItem('item-000001', 'base.corner.susan', A, 0));
    enter('Width', '33');
    expect(store.getState().doc.items[0]).toMatchObject({ width: inches(33), depth: inches(33) });
    expect(screen.getByLabelText('Depth')).toBeDisabled();
  });
});

describe('typed lengths', () => {
  it('go through parseLength, which reports what is wrong inline', () => {
    const store = setup(seedItem('item-000001', 'base.standard', A, 12));

    enter(/Offset along wall A/, '80 cm');
    expect(screen.getByRole('alert')).toHaveTextContent('Lengths are in inches only');
    enter(/Offset along wall A/, '-3');
    expect(screen.getByRole('alert')).toHaveTextContent('A length cannot be negative.');
    enter(/Offset along wall A/, '12.3');
    expect(screen.getByRole('alert')).toHaveTextContent('is not exact to 1/16 in');
    expect(store.getState().history.past).toHaveLength(0);
  });

  it('accept fractions, and show the value back in inches with fractions', () => {
    const store = setup(seedItem('item-000001', 'base.standard', A, 12));

    const offset = enter(/Offset along wall A/, '34 1/2');
    expect(store.getState().doc.items[0]!.placement).toMatchObject({ offset: inches(34.5) });
    expect(offset).toHaveValue('34 1/2"');

    const elevation = enter('Elevation above floor', '0.75"');
    expect(store.getState().doc.items[0]!.elevation).toBe(12);
    expect(elevation).toHaveValue('3/4"');
    expect(store.getState().history.past.map((entry) => entry.command.type)).toEqual([
      'item.move',
      'item.move',
    ]);
  });

  it('commit when the field loses focus, and reset with Escape', () => {
    const store = setup(seedItem('item-000001', 'base.standard', A, 12));
    const offset = screen.getByLabelText(/Offset along wall A/);

    fireEvent.change(offset, { target: { value: '99' } });
    fireEvent.keyDown(offset, { key: 'Escape' });
    expect(offset).toHaveValue('12"');
    expect(store.getState().history.past).toHaveLength(0);

    fireEvent.change(offset, { target: { value: '18' } });
    fireEvent.blur(offset);
    expect(store.getState().doc.items[0]!.placement).toMatchObject({ offset: inches(18) });
  });

  it('lets Escape go on to a sheet when nothing was typed, and keeps it when something was', () => {
    setup(seedItem('item-000001', 'base.standard', A, 12));
    const offset = screen.getByLabelText(/Offset along wall A/);
    const seen = vi.fn();
    // The panel's container stands in for a sheet; what reaches the body went past the field.
    offset.closest('section')!.parentElement!.setAttribute('role', 'dialog');
    const listener = (event: KeyboardEvent) => seen(event.key);
    document.body.addEventListener('keydown', listener);

    // Typed: the first Escape only undoes it.
    fireEvent.change(offset, { target: { value: '99' } });
    fireEvent.keyDown(offset, { key: 'Escape' });
    expect(seen).not.toHaveBeenCalled();
    // Nothing typed: it reaches the sheet, which closes on it.
    fireEvent.keyDown(offset, { key: 'Escape' });
    expect(seen).toHaveBeenCalledWith('Escape');
    document.body.removeEventListener('keydown', listener);
  });

  it('execute nothing when the value did not change', () => {
    const store = setup(seedItem('item-000001', 'base.standard', A, 12));
    enter('Width', '30');
    enter(/Offset along wall A/, '12"');
    expect(store.getState().history.past).toHaveLength(0);
  });
});

describe('height and depth', () => {
  it('offer only the standard values for the cabinet type', () => {
    setup(seedItem('item-000001', 'wall.standard', A, 12));
    expect(optionTexts('Height')).toEqual(['12"', '15"', '18"', '24"', '30"', '36"', '42"']);
    expect(optionTexts('Depth')).toEqual(['12"']);
  });

  it('execute one item.resize for a new height', () => {
    const store = setup(seedItem('item-000001', 'wall.standard', A, 12));
    fireEvent.change(screen.getByLabelText('Height'), { target: { value: String(inches(42)) } });
    expect(store.getState().doc.items[0]!.height).toBe(inches(42));
    expect(store.getState().history.past).toHaveLength(1);
  });
});

describe('options and finish', () => {
  it('shows the options of the catalog entry and sets them one command at a time', () => {
    const store = setup(seedItem('item-000001', 'base.standard', A, 12));

    expect(optionTexts('Doors')).toEqual(['1', '2']);
    fireEvent.change(screen.getByLabelText('Doors'), { target: { value: '1' } });
    fireEvent.click(screen.getByLabelText('Top Drawer'));
    fireEvent.change(screen.getByLabelText('Hinge'), { target: { value: 'right' } });

    expect(store.getState().doc.items[0]!.options).toEqual({
      doors: 1,
      topDrawer: false,
      hinge: 'right',
    });
    expect(store.getState().history.past.map((entry) => entry.command.type)).toEqual([
      'item.setOptions',
      'item.setOptions',
      'item.setOptions',
    ]);
  });

  it('sets and clears the finish', () => {
    const store = setup(seedItem('item-000001', 'base.standard', A, 12));
    const finish = screen.getByLabelText('Finish');
    expect(optionTexts('Finish')).toEqual([
      'Design default',
      'White',
      'Navy',
      'Sage green',
      'Natural oak',
    ]);

    fireEvent.change(finish, { target: { value: 'cabinet.navy' } });
    expect(store.getState().doc.items[0]!.finishId).toBe('cabinet.navy');
    fireEvent.change(finish, { target: { value: '' } });
    expect(store.getState().doc.items[0]!.finishId).toBeUndefined();
  });
});

describe('other selections', () => {
  it('names the item and its code', () => {
    setup(seedItem('item-000001', 'base.corner.susan', A, 0));
    expect(screen.getByText('Lazy Susan corner base')).toBeInTheDocument();
    expect(screen.getByText('LS36')).toBeInTheDocument();
  });

  it('edits the ceiling height when nothing is selected', () => {
    const store = setup();
    enter('Ceiling height', '108');
    expect(store.getState().doc.room.ceilingHeight).toBe(inches(108));
    enter('Ceiling height', '0');
    expect(screen.getByRole('alert')).toHaveTextContent('must be more than 0"');
  });

  it('edits a door: offset, size and swing', () => {
    const doc = room();
    const store = storeFor(
      apply(
        doc,
        openingCommand(doc.room.walls[0]!, 'door', inches(60), () => 'opening-door1'),
      ),
    );
    store.getState().select(['opening-door1']);
    renderWithStore(<PropertiesPanel />, store);

    expect(screen.getByText(/door on wall A/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Sill height')).not.toBeInTheDocument();
    enter('Width', '36');
    fireEvent.change(screen.getByLabelText('Swing'), { target: { value: 'out-right' } });
    expect(store.getState().doc.room.openings[0]).toMatchObject({
      width: inches(36),
      swing: 'out-right',
    });
    fireEvent.change(screen.getByLabelText('Swing'), { target: { value: '' } });
    expect(store.getState().doc.room.openings[0]!.swing).toBeUndefined();
  });

  it('shows a wall with its length and edits its thickness', () => {
    const store = storeFor(room());
    store.getState().select([A]);
    renderWithStore(<PropertiesPanel />, store);
    expect(screen.getByText('Wall A')).toBeInTheDocument();
    expect(screen.getByText('Length 144"')).toBeInTheDocument();
    enter('Thickness', '6');
    expect(store.getState().doc.room.walls[0]!.thickness).toBe(inches(6));
  });
});
