import { cloneElement, type MouseEvent, type ReactElement } from 'react';

/**
 * Opens a dialog from a trigger the caller gave, such as a toolbar button: the trigger's own
 * click handler still runs. The dialogs are controlled, so they hold no trigger of their own.
 */
export function withOpen(trigger: ReactElement, open: () => void): ReactElement {
  const element = trigger as ReactElement<{ onClick?: (event: MouseEvent<HTMLElement>) => void }>;
  return cloneElement(element, {
    onClick: (event) => {
      element.props.onClick?.(event);
      open();
    },
  });
}
