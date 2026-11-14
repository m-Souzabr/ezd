import { type RefObject, useEffect } from 'react';

const CONTROLS = 'button, [role="radio"]';

/**
 * Makes a toolbar one tab stop. Exactly one of its enabled controls can be tabbed to (the one
 * that last had focus, or the first), and Left and Right, Home and End move focus along the
 * toolbar, as the ARIA pattern for a toolbar says. It works on the DOM, so it covers whatever
 * the toolbar holds, a button that becomes enabled or a group of radios, without each of them
 * taking part.
 */
export function useRovingFocus(toolbar: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = toolbar.current;
    if (!root) return;
    let stop: HTMLElement | null = null;

    const controls = () =>
      [...root.querySelectorAll<HTMLElement>(CONTROLS)].filter(
        (control) => !control.hasAttribute('disabled'),
      );
    const apply = () => {
      const list = controls();
      if (stop === null || !list.includes(stop)) stop = list[0] ?? null;
      for (const control of list) control.tabIndex = control === stop ? 0 : -1;
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && controls().includes(event.target)) {
        stop = event.target;
        apply();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const list = controls();
      const at = event.target instanceof HTMLElement ? list.indexOf(event.target) : -1;
      if (at < 0) return;
      const next = {
        ArrowRight: (at + 1) % list.length,
        ArrowLeft: (at - 1 + list.length) % list.length,
        Home: 0,
        End: list.length - 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      list[next]?.focus();
    };

    apply();
    // A control enabled, disabled, added or removed changes which can be the tab stop.
    const observer = new MutationObserver(apply);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('keydown', onKeyDown);
    return () => {
      observer.disconnect();
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('keydown', onKeyDown);
    };
  }, [toolbar]);
}
