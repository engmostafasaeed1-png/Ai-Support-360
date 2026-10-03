import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import SapNotesField, { SapNoteLinks } from './SapNotesField';

afterEach(() => cleanup());

const EIGHT = Array.from({ length: 8 }, (_, i) => String(1000001 + i));

describe('SapNotesField', () => {
  it('adds the numbers that are typed, with the Add button', () => {
    const onChange = vi.fn();
    render(<SapNotesField value={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/SAP Notes you already tried/), { target: { value: 'SAP Note 2270407, 3012345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).toHaveBeenCalledWith(['2270407', '3012345']);
  });

  it('adds the numbers with the Enter key', () => {
    const onChange = vi.fn();
    render(<SapNotesField value={['2270407']} onChange={onChange} />);
    const input = screen.getByLabelText(/SAP Notes you already tried/);
    fireEvent.change(input, { target: { value: '3012345' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['2270407', '3012345']);
  });

  it('says what is wrong with a text that is not a note number and keeps it for correction', () => {
    const onChange = vi.fn();
    render(<SapNotesField value={[]} onChange={onChange} />);
    const input = screen.getByLabelText(/SAP Notes you already tried/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')?.textContent).toMatch(/5 to 8 digits/);
    expect(input.value).toBe('1234');
  });

  it('shows the numbers as links that open SAP for Me in a new tab, and removes one', () => {
    const onChange = vi.fn();
    render(<SapNotesField value={['2270407', '3012345']} onChange={onChange} />);
    const link = screen.getByText('2270407').closest('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://me.sap.com/notes/2270407');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    fireEvent.click(screen.getByRole('button', { name: 'Remove SAP Note 2270407' }));
    expect(onChange).toHaveBeenCalledWith(['3012345']);
  });

  it('stops at eight notes and says so', () => {
    const onChange = vi.fn();
    render(<SapNotesField value={EIGHT} onChange={onChange} />);
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
    const input = screen.getByLabelText(/SAP Notes you already tried/);
    fireEvent.change(input, { target: { value: '3012345' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')?.textContent).toMatch(/8 SAP Notes at most/);
  });

  it('says that no SAP login is asked for', () => {
    render(<SapNotesField value={[]} onChange={vi.fn()} />);
    expect(screen.queryByText(/We never ask for your SAP login/)).not.toBeNull();
  });
});

describe('SapNoteLinks', () => {
  it('shows nothing for an empty list', () => {
    const { container } = render(<SapNoteLinks notes={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows links without remove buttons when nobody can remove them', () => {
    render(<SapNoteLinks notes={['2270407']} />);
    expect(screen.getByText('2270407').closest('a')?.getAttribute('href')).toBe('https://me.sap.com/notes/2270407');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
