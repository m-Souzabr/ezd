import { normalizeDraft, parseDocument, type RoomDraft, SEED_CATALOG } from '@ezd/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, type Design, type Photo, type PhotoDraft } from '../api/client';
import { buildDocument } from './document';
import { PhotoDraftPage } from './PhotoDraftPage';
import { photoFileProblem } from './upload';

const IN = 16;

/** Two walls the model saw, a window, and a 31 in cabinet snapped to 30 in. */
const draft = (): RoomDraft =>
  normalizeDraft(
    {
      shape: 'l-shape',
      ceilingHeightIn: 96,
      walls: [
        { label: 'back', lengthIn: 144, visible: true, confidence: 'high' },
        { label: 'right', lengthIn: 120, visible: true, confidence: 'low' },
      ],
      openings: [
        {
          wall: 'back',
          kind: 'window',
          offsetIn: 60,
          widthIn: 36,
          heightIn: 36,
          sillIn: 42,
          confidence: 'high',
        },
      ],
      items: [{ wall: 'back', category: 'base', offsetIn: 0, widthIn: 31, confidence: 'high' }],
      notes: 'A window over the counter.',
    },
    SEED_CATALOG,
  );

const PHOTO: Photo = {
  id: 'photo-1',
  project: 'project-1',
  width: 1600,
  height: 1000,
  bytes: 1000,
  latest_draft: null,
  created_at: '2026-01-01T00:00:00Z',
};

const photoDraft = (overrides: Partial<PhotoDraft> = {}): PhotoDraft => ({
  id: 'draft-1',
  photo: PHOTO.id,
  status: 'ready',
  draft: draft() as unknown as PhotoDraft['draft'],
  error: '',
  design: null,
  model: 'm',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

function Where() {
  return <p>at {useLocation().pathname}</p>;
}

function setup(given: PhotoDraft = photoDraft()) {
  vi.spyOn(api, 'getPhotoDraft').mockResolvedValue(given);
  vi.spyOn(api, 'getPhoto').mockResolvedValue(PHOTO);
  const update = vi.spyOn(api, 'updatePhotoDraft').mockResolvedValue(given);
  const confirm = vi
    .spyOn(api, 'confirmPhotoDraft')
    .mockResolvedValue({ id: 'design-new' } as Design);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/photo-drafts/draft-1']}>
        <Routes>
          <Route path="/photo-drafts/:id" element={<PhotoDraftPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { update, confirm };
}

const type = (label: string, text: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
};

afterEach(() => vi.restoreAllMocks());

describe('the correction screen', () => {
  it('keeps Confirm disabled until every wall length is typed or confirmed', async () => {
    const { update, confirm } = setup();
    const button = await screen.findByRole('button', { name: 'Confirm and open the editor' });
    expect(button).toBeDisabled();
    const todo = screen.getByRole('list', { name: 'Still to do' });
    expect(within(todo).getByText('Confirm the length of wall A, or type it.')).toBeInTheDocument();

    type('Wall A length', '150');
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Wall B length' }));
    expect(button).toBeEnabled();
    expect(screen.queryByRole('list', { name: 'Still to do' })).not.toBeInTheDocument();

    fireEvent.click(button);
    await screen.findByText('at /designs/design-new');
    // The corrections were saved before the design was made from them.
    const saved = update.mock.calls.at(-1)![1] as RoomDraft;
    expect(saved.walls.map((wall) => wall.length)).toEqual([
      { value: 150 * IN, estimated: false },
      { value: 120 * IN, estimated: false },
    ]);
    const [, document, name] = confirm.mock.calls[0]!;
    expect(name).toBe('Kitchen from photo');
    expect(parseDocument(document).ok).toBe(true);
  });

  it('shows model values as estimates until the user edits them', async () => {
    setup();
    const room = await screen.findByRole('region', { name: 'Room' });
    expect(within(room).getAllByText('Estimated')).toHaveLength(2);
    expect(within(room).getByText('Estimated, low confidence')).toBeInTheDocument();
    const wallA = screen.getByLabelText('Wall A length');
    expect(wallA.className).toContain('border-dashed');

    type('Wall A length', '12 ft');
    expect(screen.getByRole('alert')).toHaveTextContent('inches only');
    type('Wall A length', '148 1/2');
    expect(screen.getByLabelText('Wall A length')).toHaveValue('148 1/2"');
    expect(screen.getByLabelText('Wall A length').className).not.toContain('border-dashed');
    expect(within(room).getAllByText(/^Estimated/)).toHaveLength(2);
  });

  it('picks cabinet widths from the allowed 3 in steps', async () => {
    setup();
    const cabinet = await screen.findByRole('listitem', { name: 'Base cabinet 1' });
    const width = within(cabinet).getByLabelText('Width');
    expect(width).toHaveValue(String(30 * IN));
    // The offset and the width are both estimates.
    expect(within(cabinet).getAllByText('Estimated')).toHaveLength(2);
    const options = within(width as HTMLElement).getAllByRole('option');
    expect(
      options.every((option) => Number((option as HTMLOptionElement).value) % (3 * IN) === 0),
    ).toBe(true);
    fireEvent.change(width, { target: { value: String(33 * IN) } });
    expect(within(cabinet).getAllByText('Estimated')).toHaveLength(1);
  });

  it('adds walls when the shape changes, and lists what they need', async () => {
    setup();
    fireEvent.change(await screen.findByLabelText('Shape'), { target: { value: 'u-shape' } });
    expect(screen.getByLabelText('Wall C length')).toHaveValue('');
    expect(screen.getByText('Type the length of wall C.')).toBeInTheDocument();
  });

  it('explains that measurements come from the user', async () => {
    setup();
    expect(await screen.findByRole('note')).toHaveTextContent(
      'Measurements come from you, not the photo.',
    );
  });

  it('offers the ways forward when the analysis failed', async () => {
    setup(photoDraft({ status: 'failed', draft: null, error: 'The photo could not be read.' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The photo could not be read.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try another photo' })).toHaveAttribute(
      'href',
      '/projects/project-1',
    );
    expect(screen.getByRole('button', { name: 'Start from a template' })).toBeInTheDocument();
  });

  it('links a confirmed draft to its design', async () => {
    setup(photoDraft({ status: 'confirmed', design: 'design-9' }));
    expect(await screen.findByRole('link', { name: 'Open the design' })).toHaveAttribute(
      'href',
      '/designs/design-9',
    );
  });
});

describe('buildDocument', () => {
  it('refuses a draft with problems and builds one without', () => {
    const unconfirmed = buildDocument(draft(), 'Kitchen', SEED_CATALOG);
    expect(unconfirmed.ok).toBe(false);
    const ready = draft();
    ready.walls = ready.walls.map((wall) => ({
      ...wall,
      length: { ...wall.length, estimated: false },
    }));
    const built = buildDocument(ready, 'Kitchen', SEED_CATALOG);
    expect(built.ok && built.value.room.walls).toHaveLength(2);
    expect(built.ok && built.value.items[0]!.width).toBe(30 * IN);
  });
});

describe('photoFileProblem', () => {
  it('accepts JPEG, PNG and WebP up to 10 MB', () => {
    const file = (type: string, size = 100) => new File([new Uint8Array(size)], 'f', { type });
    expect(photoFileProblem(file('image/jpeg'))).toBeNull();
    expect(photoFileProblem(file('image/webp'))).toBeNull();
    expect(photoFileProblem(file('image/heic'))).toMatch(/JPEG, PNG or WebP/);
    expect(photoFileProblem(file('image/png', 10 * 1024 * 1024 + 1))).toMatch(/10 MB/);
  });
});
