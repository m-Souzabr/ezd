import { Link } from 'react-router';

import { useSession } from '@/auth/session';
import { PageHeader } from '@/components/patterns/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { canOpen, SECTIONS } from './sections';

/** `/admin`: a card for each section the user may open. */
export function AdminHome() {
  const user = useSession();
  const cards = SECTIONS.filter((section) => canOpen(user, section));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Control Panel"
        description="Configuration, accounts and the record of changes."
      />
      {cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here is available for your role yet.
        </p>
      ) : (
        <ul aria-label="Sections" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((section) => (
            <li key={section.path}>
              <Link
                to={section.path}
                className="block h-full rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Card className="h-full transition-colors hover:bg-muted/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <section.icon className="size-4" aria-hidden="true" />
                      {section.label}
                    </CardTitle>
                    <CardDescription>{section.description}</CardDescription>
                  </CardHeader>
                  <CardContent />
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
