import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  eq: vi.fn(),
  signed: vi.fn(),
  bucket: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      update: (payload: unknown) => {
        mocks.update(payload);
        return { eq: mocks.eq };
      },
    }),
    storage: {
      from: (bucket: string) => {
        mocks.bucket(bucket);
        return { createSignedUrl: mocks.signed };
      },
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import CertificateReview, { type ReviewCertificate } from './CertificateReview';

const CERTS: ReviewCertificate[] = [
  { id: 'k1', name: 'SAP Certified Application Associate - SAP S/4HANA', issuer: 'SAP SE', issue_date: '2024-05-01', expiry_date: null, document_url: 'u1/certifications/1700000000000-cert.pdf', verified: false },
  { id: 'k2', name: 'ITIL Foundation', issuer: 'Axelos (ITIL)', issue_date: null, expiry_date: null, document_url: null, verified: true },
];

const openMock = vi.fn();
const originalOpen = window.open;

beforeEach(() => {
  mocks.update.mockReset();
  mocks.eq.mockReset();
  mocks.eq.mockResolvedValue({ error: null });
  mocks.signed.mockReset();
  mocks.signed.mockResolvedValue({ data: { signedUrl: 'https://files.example/signed?token=abc' }, error: null });
  mocks.bucket.mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.success).mockReset();
  openMock.mockReset();
  window.open = openMock as unknown as typeof window.open;
});
afterEach(() => {
  window.open = originalOpen;
  cleanup();
});

describe('CertificateReview', () => {
  it('lists the certificates with their details and whether they are verified', () => {
    render(<CertificateReview certificates={CERTS} />);
    expect(screen.getByTestId('certificate-k1').textContent).toContain('SAP SE');
    expect(screen.getByTestId('certificate-k1').textContent).toContain('Not verified yet');
    expect(screen.getByTestId('certificate-k2').textContent).toContain('Verified');
    expect(screen.getByTestId('certificate-k2').textContent).toContain('No file');
  });

  it('says so when there are no certificates', () => {
    render(<CertificateReview certificates={[]} />);
    expect(screen.getByTestId('certificates-empty').textContent).toContain('No certificates');
  });

  it('opens the file through a link of one minute in a new tab, without sending the page address', async () => {
    render(<CertificateReview certificates={CERTS} />);
    fireEvent.click(screen.getByRole('button', { name: /Open file/ }));
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));
    expect(mocks.bucket).toHaveBeenCalledWith('consultant-documents');
    expect(mocks.signed).toHaveBeenCalledWith('u1/certifications/1700000000000-cert.pdf', 60, undefined);
    expect(openMock).toHaveBeenCalledWith('https://files.example/signed?token=abc', '_blank', 'noopener,noreferrer');
  });

  it('only downloads a file that is not a PDF or an image', async () => {
    render(<CertificateReview certificates={[{ ...CERTS[0], document_url: 'u1/certifications/page.html' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /Open file/ }));
    await waitFor(() => expect(mocks.signed).toHaveBeenCalledTimes(1));
    expect(mocks.signed).toHaveBeenCalledWith('u1/certifications/page.html', 60, { download: true });
  });

  it('finds the file of an older certificate that holds the address of the file', async () => {
    render(<CertificateReview certificates={[{ ...CERTS[0], document_url: 'https://abc.supabase.co/storage/v1/object/public/consultant-documents/u1/certifications/old.pdf' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /Open file/ }));
    await waitFor(() => expect(mocks.signed).toHaveBeenCalledTimes(1));
    expect(mocks.signed.mock.calls[0][0]).toBe('u1/certifications/old.pdf');
  });

  it('says so when the file can not be opened', async () => {
    mocks.signed.mockResolvedValue({ data: null, error: { message: 'not found' } });
    render(<CertificateReview certificates={CERTS} />);
    fireEvent.click(screen.getByRole('button', { name: /Open file/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('The file could not be opened.'));
    expect(openMock).not.toHaveBeenCalled();
  });

  it('verifies a certificate', async () => {
    const onChanged = vi.fn();
    render(<CertificateReview certificates={CERTS} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith({ verified: true });
    expect(mocks.eq).toHaveBeenCalledWith('id', 'k1');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('removes the verification of a certificate', async () => {
    render(<CertificateReview certificates={CERTS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove verification' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(mocks.update).toHaveBeenCalledWith({ verified: false });
    expect(mocks.eq).toHaveBeenCalledWith('id', 'k2');
  });

  it('shows the message of the database when the verification can not be saved', async () => {
    mocks.eq.mockResolvedValue({ error: { message: 'permission denied' } });
    render(<CertificateReview certificates={CERTS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('permission denied'));
  });

  it('does not let anything be saved in the demo', () => {
    render(<CertificateReview certificates={CERTS} readOnly />);
    expect((screen.getByRole('button', { name: 'Verify' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Remove verification' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
