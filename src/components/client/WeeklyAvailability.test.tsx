import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n/config';
import WeeklyAvailability from './WeeklyAvailability';

const renderWithI18n = (ui: React.ReactElement) => render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

afterEach(() => cleanup());

describe('WeeklyAvailability', () => {
  it('lists every working day the consultant saved', () => {
    renderWithI18n(<WeeklyAvailability hours={['Mon 09:00–17:00', 'Tue 09:00–17:00', 'Wed 10:00–14:00']} />);

    const box = screen.getByTestId('weekly-availability');
    expect(box.textContent).toContain('Weekly availability');
    expect(box.textContent).toContain('Mon 09:00–17:00');
    expect(box.textContent).toContain('Tue 09:00–17:00');
    expect(box.textContent).toContain('Wed 10:00–14:00');
    expect(box.textContent).not.toContain('No hours set yet');
  });

  it('says so when the consultant has not set any hours', () => {
    renderWithI18n(<WeeklyAvailability hours={[]} />);
    expect(screen.getByTestId('weekly-availability').textContent).toContain('No hours set yet');
  });

  it('says so when the hours are still unknown', () => {
    renderWithI18n(<WeeklyAvailability hours={undefined} />);
    expect(screen.getByTestId('weekly-availability').textContent).toContain('No hours set yet');
  });
});
