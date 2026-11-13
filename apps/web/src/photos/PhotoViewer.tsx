import { type PointerEvent, useRef, useState } from 'react';

import { BUTTON } from '../editor/panels/fields';

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const STEP = 1.25;

type View = { zoom: number; x: number; y: number };
const FIT: View = { zoom: 1, x: 0, y: 0 };

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** A photo that zooms with the wheel or the buttons and pans by dragging. */
export function PhotoViewer({
  src,
  alt,
  className = '',
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [view, setView] = useState<View>(FIT);
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);

  const zoomBy = (factor: number) =>
    setView((current) => {
      const zoom = clampZoom(current.zoom * factor);
      return zoom === MIN_ZOOM ? FIT : { ...current, zoom };
    });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (view.zoom === MIN_ZOOM) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, view };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    setView({
      ...start.view,
      x: start.view.x + (event.clientX - start.x) / start.view.zoom,
      y: start.view.y + (event.clientY - start.y) / start.view.zoom,
    });
  };

  return (
    <figure className={`flex min-h-0 flex-col gap-2 ${className}`}>
      <div
        className={`relative min-h-0 flex-1 overflow-hidden rounded-lg bg-slate-900 ${
          view.zoom > MIN_ZOOM ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
        onWheel={(event) => zoomBy(event.deltaY < 0 ? STEP : 1 / STEP)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="h-full w-full object-contain select-none"
          style={{
            transform: `scale(${view.zoom}) translate(${view.x}px, ${view.y}px)`,
            transformOrigin: 'center',
          }}
        />
      </div>
      <figcaption className="flex items-center gap-2 text-xs text-slate-600">
        <button
          type="button"
          className={BUTTON}
          onClick={() => zoomBy(STEP)}
          disabled={view.zoom >= MAX_ZOOM}
        >
          Zoom in
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={() => zoomBy(1 / STEP)}
          disabled={view.zoom <= MIN_ZOOM}
        >
          Zoom out
        </button>
        <button
          type="button"
          className={BUTTON}
          onClick={() => setView(FIT)}
          disabled={view.zoom === MIN_ZOOM}
        >
          Fit
        </button>
        <span>Scroll to zoom, drag to move.</span>
      </figcaption>
    </figure>
  );
}
