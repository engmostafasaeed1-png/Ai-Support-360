import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import TicketAreasNotes from './TicketAreasNotes';

afterEach(() => cleanup());

describe('TicketAreasNotes', () => {
  it('shows nothing for a ticket with one area and no details or notes', () => {
    const { container } = render(<TicketAreasNotes areas={['SAP FI/CO']} other={null} details={null} notes={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows every area with a star on the main one, the name given for Other and the details', () => {
    render(
      <TicketAreasNotes
        areas={['FI - Accounts Payable (FI-AP)', 'Other']}
        other="Vendor payment run automation"
        details={'Company code 1000.\nPayment run F110.'}
        notes={[]}
      />,
    );
    expect(screen.getByTestId('ticket-areas')).toBeTruthy();
    expect(screen.getByText('FI - Accounts Payable (FI-AP)')).toBeTruthy();
    expect(screen.getByText('Other: Vendor payment run automation')).toBeTruthy();
    expect(screen.getByLabelText('Main area')).toBeTruthy();
    expect(screen.getByText('More details about the areas')).toBeTruthy();
    expect(screen.getByText(/Payment run F110/)).toBeTruthy();
    expect(screen.queryByTestId('notes-tried')).toBeNull();
  });

  it('shows the notes as links that open SAP for Me in a new tab', () => {
    render(<TicketAreasNotes areas={['SAP FI/CO']} notes={['2270407', '3012345']} />);
    expect(screen.queryByTestId('ticket-areas')).toBeNull();
    expect(screen.getByTestId('notes-tried').textContent).toMatch(/SAP Notes the client already tried/);
    const link = screen.getByText('2270407').closest('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://me.sap.com/notes/2270407');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText('3012345')).toBeTruthy();
  });

  it('shows one area without a star when the client wrote details about it', () => {
    render(<TicketAreasNotes areas={['SAP MM']} details="Only plant 1200." notes={[]} />);
    expect(screen.getByText('SAP MM')).toBeTruthy();
    expect(screen.queryByLabelText('Main area')).toBeNull();
    expect(screen.getByText('Only plant 1200.')).toBeTruthy();
  });
});
