import { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SapAreaPicker from './SapAreaPicker';
import { MAX_SAP_AREAS } from '@/lib/sapAreas';

function Harness({ initial = [] as string[] }: { initial?: string[] }) {
  const [areas, setAreas] = useState<string[]>(initial);
  const [other, setOther] = useState('');
  const [details, setDetails] = useState('');
  return (
    <div>
      <SapAreaPicker
        areas={areas}
        other={other}
        details={details}
        onAreasChange={setAreas}
        onOtherChange={setOther}
        onDetailsChange={setDetails}
      />
      <output data-testid="state">{JSON.stringify({ areas, other, details })}</output>
    </div>
  );
}

const state = () => JSON.parse(screen.getByTestId('state').textContent || '{}') as { areas: string[]; other: string; details: string };

afterEach(() => cleanup());

describe('SapAreaPicker', () => {
  it('lets the client choose several areas and keeps the order', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Search SAP modules and areas'), { target: { value: 'pricing' } });
    fireEvent.click(screen.getByRole('button', { name: /SD - Pricing and Conditions/ }));
    fireEvent.change(screen.getByLabelText('Search SAP modules and areas'), { target: { value: 'payroll' } });
    fireEvent.click(screen.getByRole('button', { name: /SAP HCM Payroll/ }));
    expect(state().areas).toEqual(['SD - Pricing and Conditions', 'SAP HCM Payroll']);
  });

  it('removes a chosen area again and can make another one the main area', () => {
    render(<Harness initial={['SAP MM', 'SAP SD', 'SAP PP']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Make SAP PP the main area' }));
    expect(state().areas).toEqual(['SAP PP', 'SAP MM', 'SAP SD']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove SAP MM' }));
    expect(state().areas).toEqual(['SAP PP', 'SAP SD']);
  });

  it('asks for a name when "Other" is chosen and keeps the details', () => {
    render(<Harness />);
    expect(screen.queryByLabelText('Name the other SAP area')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Other/ }));
    fireEvent.change(screen.getByLabelText('Name the other SAP area'), { target: { value: 'Cash application automation' } });
    fireEvent.change(screen.getByLabelText(/More details about these areas/), { target: { value: 'Three company codes, Egypt and KSA' } });
    expect(state()).toEqual({
      areas: ['Other'],
      other: 'Cash application automation',
      details: 'Three company codes, Egypt and KSA',
    });
  });

  it('stops at the limit and says so', () => {
    const twelve = Array.from({ length: MAX_SAP_AREAS }, (_, i) => `Custom area ${i + 1}`);
    render(<Harness initial={twelve} />);
    expect(screen.queryByText(/You can choose 12 areas at most/)).not.toBeNull();
    expect((screen.getByRole('button', { name: /^Other/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says so when the search finds nothing', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Search SAP modules and areas'), { target: { value: 'zzzzqqqq' } });
    expect(screen.queryByText(/No SAP area matches your search/)).not.toBeNull();
  });
});
