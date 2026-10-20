/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('@/integrations/supabase/client', () => {
  const b: any = {};
  for (const m of ['select', 'in', 'order', 'eq', 'is', 'range', 'limit']) b[m] = () => b;
  b.then = (ok: any, ko: any) => Promise.resolve({ data: [], error: null }).then(ok, ko);
  return { supabase: { from: () => b, rpc: () => Promise.resolve({ data: null, error: null }) } };
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, d?: any, o?: any) => {
      const text = typeof d === 'string' ? d : k;
      const vars = typeof d === 'object' ? d : o;
      return vars ? text.replace(/{{(\w+)}}/g, (_: string, v: string) => String(vars[v] ?? '')) : text;
    },
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/components/client/ConsultantMap', () => ({ default: (p: any) => <div data-testid="map-stub">{p.consultants.length} on map</div> }));

const base = {
  specialty: 'SAP FI', skills: ['SAP FI'], rating: 4.6, reviews: 4, rate: 90, avatar: 'AA', available: true, status: 'available', badges: ['verified'],
  industries: [], linkedinVerified: false, credlyVerified: false, linkedin_state: 'none', credly_state: 'none', languages: ['en'], response_time_minutes: 30,
  verification_status: 'verified', hours: [], completion_percent: 90,
};
const LIST = [
  { ...base, id: 'c1', name: 'Placed Person', lat: 24.7, lng: 46.7, city: 'Riyadh', country: 'Saudi Arabia', place: 'Riyadh, Saudi Arabia' },
  { ...base, id: 'c2', name: 'Nowhere Person', skills: ['SAP MM'], specialty: 'SAP MM', lat: null, lng: null, city: '', country: '', place: '' },
];
vi.mock('@/hooks/useRealtimeConsultants', () => ({ useRealtimeConsultants: () => ({ consultants: LIST, realtimeConnected: true, isLoading: false }) }));

import ConsultantsPage from './ConsultantsPage';

let lastSearch = '';
function Spy() { lastSearch = useLocation().search; return null; }
function show(path = '/client/consultants') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/client/consultants" element={<><ConsultantsPage /><Spy /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => cleanup());

describe('directory list | map toggle', () => {
  it('switches to the map, keeps it in the URL and lists consultants without a location below the map', async () => {
    show();
    expect(screen.queryByTestId('map-stub')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    expect(await screen.findByTestId('map-stub')).toHaveTextContent('2 on map');
    expect(lastSearch).toBe('?view=map');
    expect(screen.getByText('No location set (1)')).toBeInTheDocument();
    expect(screen.getByTestId('no-location-list')).toHaveTextContent('Nowhere Person');
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.queryByTestId('map-stub')).toBeNull();
    expect(lastSearch).toBe('');
  });

  it('applies filters from a shared link', async () => {
    show('/client/consultants?module=MM');
    expect(await screen.findByText('1 consultants found')).toBeInTheDocument();
    expect(screen.getByText('Nowhere Person')).toBeInTheDocument();
    expect(screen.queryByText('Placed Person')).toBeNull();
  });
});
