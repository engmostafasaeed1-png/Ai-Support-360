import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import LinkStatus from './LinkStatus';

afterEach(() => cleanup());

describe('LinkStatus', () => {
  it('shows nothing when there is no link', () => {
    const { container } = render(<LinkStatus state="none" label="LinkedIn" />);
    expect(container.firstChild).toBeNull();
  });

  it('says "linked" for a link that only the consultant gave', () => {
    render(<LinkStatus state="linked" label="LinkedIn" />);
    expect(screen.getByTestId('link-linked').textContent).toContain('LinkedIn linked');
    expect(screen.queryByTestId('link-checked')).toBeNull();
  });

  it('says "checked" for a link that the platform team confirmed', () => {
    render(<LinkStatus state="checked" label="Credly" />);
    expect(screen.getByTestId('link-checked').textContent).toContain('Credly checked');
    expect(screen.queryByTestId('link-linked')).toBeNull();
  });
});
