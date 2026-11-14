import type { RefObject } from 'react';

import { Tooltip, TooltipContent } from '@/components/ui/tooltip';

/**
 * The tooltip of a `HintButton`, shown over the button it is given. Loaded the first time a
 * button is hovered or focused: the positioning code it brings is not needed to start editing.
 */
export default function HintPopup({
  open,
  anchor,
  hint,
  shortcut,
}: {
  open: boolean;
  anchor: RefObject<HTMLElement | null>;
  hint: string | undefined;
  shortcut: string | undefined;
}) {
  return (
    <Tooltip open={open}>
      <TooltipContent anchor={anchor}>
        {hint}
        {shortcut && (
          <kbd className="rounded-sm bg-background/20 px-1 font-mono text-[0.7rem]">{shortcut}</kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
