import type { ReactNode } from 'react';
import { Link } from 'react-router';

/**
 * The frame of the sign-in pages: one narrow column, centred, with the page's `h1` and the
 * `main` landmark that the skip link jumps to. These pages have no app shell.
 */
export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/40 text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-10 outline-none md:px-6 md:py-16"
      >
        <Link to="/" className="text-base font-semibold tracking-tight">
          EZDesign
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </main>
    </div>
  );
}
