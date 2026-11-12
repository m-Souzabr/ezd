import type { Point, Pt } from '@ezd/core';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';

import { handleCanvasKey } from '../lib/shortcuts';
import { useDesign, useDesignStore } from '../store/context';
import { fitView } from '../store/selectors';
import { type Drag, snapDrag } from './dragging';
import { startsPan, wheelZoomFactor } from './tools/pan';
import { panBy, type Size, toDrawing, type Viewport, zoomAt } from './viewport';

/** A pointer event on the canvas. `point` is the drawing point under `screen`. */
export type CanvasPointer = {
  point: Pt;
  /** Pixels from the top left of the canvas. */
  screen: Pt;
  shiftKey: boolean;
};

type Props = {
  /** Names the canvas for assistive technology. */
  label: string;
  /**
   * A press with the main button that is not a pan. Returning a drag starts it once the
   * pointer has moved a few pixels, so a plain click only selects.
   */
  onPress?(pointer: CanvasPointer): Drag | null | void;
  /** Pointer moves while nothing is being dragged; null when the pointer leaves. */
  onHover?(pointer: CanvasPointer | null): void;
  onDoubleClick?(pointer: CanvasPointer): void;
  /** Keys the view handles itself. Returns whether it did. */
  onKey?(event: ReactKeyboardEvent): boolean;
  /**
   * The plan pointer `snap` gets for a drawing point: the middle of the dragged item. Null
   * where this view cannot place the item.
   */
  dragPointer(drag: Drag, point: Pt): Point | null;
  /** The drawing. Called once the canvas has been measured. */
  children(size: Size, viewport: Viewport): ReactNode;
  /** HTML drawn over the canvas, such as a tooltip. */
  overlay?: ReactNode;
};

const DRAG_THRESHOLD_PX = 3;

const CURSORS = { select: 'default', wall: 'crosshair', opening: 'crosshair', pan: 'grab' };

/**
 * The element a view draws in. It measures itself, pans and zooms the shared viewport,
 * and follows a drag from wherever it started: the ghost is updated on every pointer
 * move, and the drop executes one command, or none outside the canvas.
 */
export function CanvasHost(props: Props) {
  const { label, children, overlay } = props;
  const store = useDesignStore();
  const viewport = useDesign((state) => state.viewport);
  const tool = useDesign((state) => state.tool);
  const dragging = useDesign((state) => state.drag !== null);
  const viewKey = useDesign((state) =>
    state.view.kind === 'plan' ? 'plan' : `elevation:${state.view.wallId}`,
  );

  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [panning, setPanning] = useState(false);
  const spaceHeld = useRef(false);
  const pan = useRef<Pt | null>(null);
  const pending = useRef<{ drag: Drag; from: Pt } | null>(null);

  const localPoint = (event: { clientX: number; clientY: number }): Pt => {
    const rect = hostRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };
  const pointerAt = (event: { clientX: number; clientY: number; shiftKey: boolean }) => {
    const screen = localPoint(event);
    return {
      screen,
      point: toDrawing(store.getState().viewport, screen),
      shiftKey: event.shiftKey,
    };
  };

  // Measure the canvas, and tell the store so `Fit` works from the toolbar.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const next = { width: host.clientWidth, height: host.clientHeight };
      if (next.width === 0 || next.height === 0) return;
      setSize(next);
      store.getState().setCanvasSize(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [store]);

  // Frame the view when it is first shown and whenever the user switches views.
  const measured = size !== null;
  useEffect(() => {
    const state = store.getState();
    if (measured && state.canvasSize) {
      state.setViewport(fitView(state.doc, state.view, state.canvasSize));
    }
  }, [store, viewKey, measured]);

  // Zoom around the pointer. Registered by hand because React's wheel listener is passive
  // and so cannot stop the page from scrolling.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const state = store.getState();
      const rect = host.getBoundingClientRect();
      const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      state.setViewport(zoomAt(state.viewport, screen, wheelZoomFactor(event.deltaY)));
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [store]);

  /** Moves the ghost to the pointer, or hides it when the pointer is off the canvas. */
  const track = (event: { clientX: number; clientY: number }) => {
    const state = store.getState();
    const { drag } = state;
    const host = hostRef.current;
    if (!drag || !host) return;
    const screen = localPoint(event);
    const inside =
      screen.x >= 0 &&
      screen.y >= 0 &&
      screen.x <= host.clientWidth &&
      screen.y <= host.clientHeight;
    if (!inside) {
      state.updateDrag({ snap: null });
      return;
    }
    const point = toDrawing(state.viewport, screen);
    const middle =
      drag.kind === 'move' ? { x: point.x - drag.grab.x, y: point.y - drag.grab.y } : point;
    const pointer = props.dragPointer(drag, middle);
    state.updateDrag(pointer ? snapDrag(state.doc, state.catalog, drag, pointer) : { snap: null });
  };
  const trackLatest = useEffectEvent(track);

  // A drag can start outside the canvas, in the catalog panel, so it is followed on the
  // window for as long as it lasts.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => trackLatest(event);
    const onUp = (event: PointerEvent) => {
      trackLatest(event);
      store.getState().commitDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, store]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // The overlay holds real form controls, which keep their own focus and clicks.
    if (event.target instanceof HTMLElement && event.target.closest('[data-canvas-overlay]')) {
      return;
    }
    hostRef.current?.focus({ preventScroll: true });
    if (startsPan(event.button, tool, spaceHeld.current)) {
      event.preventDefault();
      pan.current = { x: event.clientX, y: event.clientY };
      setPanning(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    const pointer = pointerAt(event);
    const drag = props.onPress?.(pointer);
    pending.current = drag ? { drag, from: pointer.screen } : null;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pan.current) {
      const state = store.getState();
      state.setViewport(
        panBy(state.viewport, event.clientX - pan.current.x, event.clientY - pan.current.y),
      );
      pan.current = { x: event.clientX, y: event.clientY };
      return;
    }
    if (dragging) return;
    const pointer = pointerAt(event);
    const start = pending.current;
    if (start) {
      const moved = Math.hypot(pointer.screen.x - start.from.x, pointer.screen.y - start.from.y);
      if (moved < DRAG_THRESHOLD_PX) return;
      pending.current = null;
      store.getState().startDrag(start.drag);
      track(event);
      return;
    }
    props.onHover?.(pointer);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pending.current = null;
    if (pan.current) {
      pan.current = null;
      setPanning(false);
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === ' ') {
      spaceHeld.current = true;
      event.preventDefault();
      return;
    }
    if (props.onKey?.(event) || handleCanvasKey(event.nativeEvent, store)) event.preventDefault();
  };

  const cursor = panning ? 'grabbing' : dragging ? 'grabbing' : CURSORS[tool];

  return (
    <div
      ref={hostRef}
      role="application"
      aria-label={label}
      aria-describedby="canvas-help"
      tabIndex={0}
      data-testid="canvas"
      className="relative h-full w-full touch-none overflow-hidden bg-white outline-none select-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-inset"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => props.onHover?.(null)}
      onDoubleClick={(event) => props.onDoubleClick?.(pointerAt(event))}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => {
        if (event.key === ' ') spaceHeld.current = false;
      }}
      onBlur={() => {
        spaceHeld.current = false;
      }}
    >
      {size && children(size, viewport)}
      {overlay && <div data-canvas-overlay>{overlay}</div>}
    </div>
  );
}
