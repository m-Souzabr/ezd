import { ResponsiveDialog } from '@/components/patterns/responsive-dialog';
import { Button } from '@/components/ui/button';
import type { ReadError } from '../../lib/repository';

/** Why a file was not imported, with the problems found in it. Closed by unmounting it. */
export default function ImportErrorDialog({
  error,
  onClose,
}: {
  error: ReadError;
  onClose(): void;
}) {
  return (
    <ResponsiveDialog
      open
      onOpenChange={onClose}
      title="The file was not imported"
      description={
        error.issues.length
          ? 'It is not a valid design. Your current design is unchanged.'
          : error.message
      }
      showCloseButton={false}
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      {error.issues.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {error.issues.map((issue, i) => (
            <li key={i}>
              {issue.path && <code className="font-mono text-xs">{issue.path}: </code>}
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </ResponsiveDialog>
  );
}
