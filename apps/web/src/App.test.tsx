import { VERSION } from '@ezd/core';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { App } from './App';

it('renders the core version on the home page', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'EZDesign' })).toBeInTheDocument();
  expect(screen.getByTestId('core-version')).toHaveTextContent(VERSION);
});
