import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '@/i18n/config';
import ForConsultantsPage, { applyHref } from './ForConsultantsPage';

function renderPage(url = '/for-consultants') {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[url]}>
        <ForConsultantsPage />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

describe('ForConsultantsPage', () => {
  it('renders exactly one h1', () => {
    renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Keep 100% of your rate');
  });

  it('has exactly two Apply buttons with the same href', () => {
    renderPage();
    const links = screen.getAllByRole('link', { name: /Apply as a consultant/i });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '/signup?role=consultant');
    expect(links[1]).toHaveAttribute('href', links[0].getAttribute('href'));
  });

  it('keeps utm and ref parameters on the apply link', () => {
    renderPage('/for-consultants?utm_source=linkedin&utm_campaign=oct&ref=blog&other=drop');
    const links = screen.getAllByRole('link', { name: /Apply as a consultant/i });
    const href = links[0].getAttribute('href')!;
    expect(href).toContain('utm_source=linkedin');
    expect(href).toContain('utm_campaign=oct');
    expect(href).toContain('ref=blog');
    expect(href).toContain('role=consultant');
    expect(href).not.toContain('other=drop');
  });

  it('shows the 50 x 8 example in the calculator', () => {
    renderPage();
    expect(screen.getByText('The client pays').parentElement).toHaveTextContent('529.00 USD');
    expect(screen.getByText('You receive').parentElement).toHaveTextContent('400.00 USD');
    expect(screen.getByText('Portal fee (10 %)').parentElement).toHaveTextContent('40.00 USD');
    expect(screen.getByText('VAT (15 %)').parentElement).toHaveTextContent('69.00 USD');
  });

  it('validates the calculator inputs', async () => {
    const user = userEvent.setup();
    renderPage();
    const rate = screen.getByLabelText('Your hourly rate (USD)');
    await user.clear(rate);
    await user.type(rate, '0');
    expect(screen.getByText('Enter a rate between 1 and 1000.')).toBeInTheDocument();
    expect(screen.getByText('Fix the inputs to see the result.')).toBeInTheDocument();
  });

  it('opens and closes FAQ items with the keyboard, first item closed', async () => {
    const user = userEvent.setup();
    renderPage();
    const first = screen.getByRole('button', { name: 'Who can apply?' });
    expect(first).toHaveAttribute('aria-expanded', 'false');
    first.focus();
    await user.keyboard('{Enter}');
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/SAP consultants who complete their profile/)).toBeVisible();
    await user.keyboard('{Enter}');
    expect(first).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders all ten FAQ questions', () => {
    renderPage();
    for (const q of [
      'Who can apply?', 'Who sets my rate?', 'Do I really keep 100%?', 'When and how do I get paid?',
      'How do critical requests work?', 'How do the badges work?', 'Are my bank details safe?',
      'Can clients contact me outside the portal?', 'What do I need to apply?', 'Which countries do you pay to?',
    ]) {
      expect(screen.getByRole('button', { name: q })).toBeInTheDocument();
    }
  });

  it('emits FAQPage JSON-LD with all ten questions', () => {
    const { container } = renderPage();
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    const data = JSON.parse(script!.textContent!);
    expect(data['@type']).toBe('FAQPage');
    expect(data.mainEntity).toHaveLength(10);
    expect(data.mainEntity.map((e: { name: string }) => e.name)).toContain('Which countries do you pay to?');
  });
});

describe('applyHref', () => {
  it('builds the signup link and preserves campaign parameters only', () => {
    expect(applyHref('')).toBe('/signup?role=consultant');
    expect(applyHref('utm_source=x&ref=y&foo=bar')).toBe('/signup?utm_source=x&ref=y&role=consultant');
  });
});

describe('route registration', () => {
  it('registers /for-consultants as a public lazy route in App.tsx', () => {
    const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8');
    expect(app).toContain('path="/for-consultants"');
    expect(app).toMatch(/lazyWithRetry\(\(\) => import\("\.\/pages\/ForConsultantsPage\.tsx"\)/);
  });
});
