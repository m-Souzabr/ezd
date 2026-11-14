import { ResponsiveDialog } from '@/components/patterns/responsive-dialog';
import { Button } from '@/components/ui/button';
import { useConfig } from '../../config/useConfig';

/** A short guide to a first design, from the toolbar. */
export function HelpDialogBody({
  open,
  onOpenChange: setOpen,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const steps = useConfig().help.steps;
  return (
    <>
      <ResponsiveDialog
        open={open}
        onOpenChange={setOpen}
        title="Your first design"
        description="From an empty room to a quote. Every change can be undone."
        showCloseButton={false}
        footer={
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
      >
        <ol className="flex flex-col gap-3">
          {steps.map((step, i) => (
            <li key={step.title} className="flex gap-3 text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">
                {i + 1}
              </span>
              <span>
                <strong>{step.title}.</strong>{' '}
                <span className="text-muted-foreground">{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 rounded-lg bg-muted p-3 text-xs">
          The checks are design guidance, not building-code compliance. Check local codes and the
          manufacturers&apos; instructions before anything is built.
        </p>
      </ResponsiveDialog>
    </>
  );
}
