import { render, screen } from '@testing-library/react';
import App from './App';

describe('App (boot smoke)', () => {
  it('mounts and renders the app shell heading', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /insight radar/i })).toBeInTheDocument();
  });
});
