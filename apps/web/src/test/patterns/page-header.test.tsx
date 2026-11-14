import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageHeader } from '@/components/patterns/page-header';

describe('PageHeader', () => {
  it('has the title as the page heading, with its description and actions', () => {
    render(
      <PageHeader title="Projects" description="Your designs." actions={<button>New</button>} />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByText('Your designs.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });
});
