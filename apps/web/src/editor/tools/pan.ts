// The pan tool, and panning and zooming from any tool.

const MIDDLE_BUTTON = 1;
const ZOOM_PER_PIXEL = 0.0015;
const MAX_WHEEL_STEP = 200;

/** Whether a pointer press starts a pan: the pan tool, a space-drag or the middle button. */
export const startsPan = (button: number, tool: string, spaceHeld: boolean): boolean =>
  button === MIDDLE_BUTTON || (button === 0 && (tool === 'pan' || spaceHeld));

/** The zoom factor for a wheel event. Scrolling up zooms in. */
export function wheelZoomFactor(deltaY: number): number {
  const delta = Math.max(-MAX_WHEEL_STEP, Math.min(MAX_WHEEL_STEP, deltaY));
  return Math.exp(-delta * ZOOM_PER_PIXEL);
}
