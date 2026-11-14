import { useState, type ReactNode } from 'react';
import { MoreHorizontalIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMediaQuery } from '@/hooks/use-media-query';
import { MD_UP } from '@/lib/breakpoints';
import { cn } from '@/lib/utils';

export type MenuAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  onSelect: () => void;
};

type ResponsiveMenuProps = {
  label: string;
  actions: MenuAction[];
};

/** A dropdown menu from 768 px and a bottom drawer of touch-sized actions below. */
export function ResponsiveMenu({ label, actions }: ResponsiveMenuProps) {
  const isMdUp = useMediaQuery(MD_UP);
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (isMdUp) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={label} />}>
          <MoreHorizontalIcon className="size-5" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {actions.map((action) => (
            <DropdownMenuItem
              key={action.id}
              variant={action.destructive ? 'destructive' : 'default'}
              onClick={action.onSelect}
            >
              {action.icon}
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <>
      <Button variant="ghost" size="icon" aria-label={label} onClick={() => setDrawerOpen(true)}>
        <MoreHorizontalIcon className="size-5" aria-hidden="true" />
      </Button>
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent>
          <DrawerHeader className="text-left">
            <DrawerTitle>{label}</DrawerTitle>
            <DrawerDescription className="sr-only">Choose an action</DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-1 px-4 pb-safe-3">
            {actions.map((action) => (
              <Button
                key={action.id}
                variant="ghost"
                size="touch"
                className={cn('justify-start', action.destructive && 'text-destructive')}
                onClick={() => {
                  setDrawerOpen(false);
                  action.onSelect();
                }}
              >
                {action.icon}
                {action.label}
              </Button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
