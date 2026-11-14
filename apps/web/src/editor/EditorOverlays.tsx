import type { ReactNode } from 'react';

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

/** The side panels that become sheets below 1024 px. */
export type SheetName = 'catalog' | 'properties' | 'assistant';

/** A side panel as a sheet: it covers the canvas only while it is open. */
function PanelSheet({
  open,
  onOpenChange,
  side,
  title,
  description,
  children,
  keepMounted = false,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  side: 'left' | 'right';
  title: string;
  description: string;
  children: ReactNode;
  keepMounted?: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        keepMounted={keepMounted}
        className="w-80 max-w-[90vw] gap-0 p-0 sm:max-w-80"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * What the editor shows over the canvas on a narrow screen: the catalog, the properties with
 * the checks, and the assistant as sheets, and the materials as a bottom drawer on a phone.
 * Loaded only then, so the desktop editor does not carry the sheet and drawer code.
 * A panel that is `null` is hidden by the configuration.
 */
export default function EditorOverlays({
  sheet,
  onSheetChange,
  catalog,
  right,
  assistant,
  materials,
  onMaterialsClose,
}: {
  sheet: SheetName | null;
  onSheetChange(sheet: SheetName | null): void;
  catalog: ReactNode;
  right: ReactNode;
  assistant: ReactNode;
  /** The bill of materials, when it is to be a drawer (a phone) and is open. */
  materials: ReactNode;
  onMaterialsClose(): void;
}) {
  const sheetProps = (name: SheetName) => ({
    open: sheet === name,
    onOpenChange: (open: boolean) => onSheetChange(open ? name : null),
  });
  return (
    <>
      {catalog && (
        <PanelSheet
          {...sheetProps('catalog')}
          side="left"
          title="Catalog"
          description="Add cabinets to the design."
        >
          {catalog}
        </PanelSheet>
      )}
      {right && (
        <PanelSheet
          {...sheetProps('properties')}
          side="right"
          title="Properties and checks"
          description="Edit the selection and read the design checks."
        >
          {right}
        </PanelSheet>
      )}
      {assistant && (
        <PanelSheet
          {...sheetProps('assistant')}
          side="right"
          title="Assistant"
          description="Ask the assistant for a change."
          keepMounted
        >
          {assistant}
        </PanelSheet>
      )}
      <Drawer
        open={materials !== null}
        onOpenChange={(open) => {
          if (!open) onMaterialsClose();
        }}
      >
        <DrawerContent>
          <DrawerHeader className="sr-only">
            <DrawerTitle>Materials</DrawerTitle>
            <DrawerDescription>The bill of materials of the design.</DrawerDescription>
          </DrawerHeader>
          <div className="flex max-h-[70dvh] min-h-0 flex-col">{materials}</div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
