import { useState } from 'react';

import { api } from '../api/client';
import { BUTTON } from '../editor/panels/fields';
import { PhotoViewer } from './PhotoViewer';

/** The photo a design was made from, in a panel over the editor, to check it against. */
export function PhotoReference({ photoId }: { photoId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={BUTTON}
        aria-pressed={open}
        data-state={open ? 'on' : 'off'}
        onClick={() => setOpen(!open)}
      >
        Photo
      </button>
      {open && (
        <aside
          aria-label="Reference photo"
          className="fixed bottom-4 left-4 z-30 flex h-80 w-[28rem] max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-lg bg-white p-2 shadow-xl"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-800">
              The photo this design came from
            </h2>
            <button type="button" className={BUTTON} onClick={() => setOpen(false)}>
              Close<span className="sr-only"> the reference photo</span>
            </button>
          </div>
          <PhotoViewer src={api.photoFileUrl(photoId)} alt="The kitchen photo" className="flex-1" />
        </aside>
      )}
    </>
  );
}
