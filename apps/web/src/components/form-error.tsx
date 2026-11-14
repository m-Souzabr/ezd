import { ApiError } from '@/api/client';
import { FieldError } from '@/components/ui/field';
import { errorMessage } from '@/pages/format';

/**
 * A failed request, said once for the whole form, as text in an alert. A rejection that
 * names one of `fields` belongs under that field, so this shows nothing for it.
 */
export function FormError({ error, fields = [] }: { error: unknown; fields?: string[] }) {
  if (!error) return null;
  if (error instanceof ApiError && fields.some((name) => error.field(name).length > 0)) {
    return null;
  }
  return <FieldError>{errorMessage(error)}</FieldError>;
}
