import { VERSION } from '@ezd/core';
import { Separator } from 'radix-ui';

export function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-50 text-slate-900">
      <h1 className="text-4xl font-semibold tracking-tight">EZDesign</h1>
      <Separator.Root decorative className="h-px w-24 bg-slate-300" />
      <p className="text-sm text-slate-600">
        core version{' '}
        <span data-testid="core-version" className="font-mono">
          {VERSION}
        </span>
      </p>
    </main>
  );
}
