import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({ selectDeleted: vi.fn(), eq: vi.fn(), removeFile: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      delete: () => ({
        eq: (column: string, value: string) => {
          mocks.eq(column, value);
          return { select: mocks.selectDeleted };
        },
      }),
    }),
    storage: { from: () => ({ remove: mocks.removeFile }) },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import RemoveCertificateButton from './RemoveCertificateButton';

const CERT = { id: 'c-1', name: 'QA test certificate', document_url: 'u-1/certifications/123-file.pdf' };

const openDialog = () => fireEvent.click(screen.getByRole('button', { name: 'Remove QA test certificate' }));
const confirm = () => fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

beforeEach(() => {
  mocks.selectDeleted.mockReset();
  mocks.selectDeleted.mockResolvedValue({ data: [{ id: 'c-1' }], error: null });
  mocks.eq.mockReset();
  mocks.removeFile.mockReset();
  mocks.removeFile.mockResolvedValue({ data: [], error: null });
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(() => cleanup());

describe('RemoveCertificateButton', () => {
  it('asks first and removes nothing before the consultant confirms', () => {
    render(<RemoveCertificateButton certificate={CERT} />);
    openDialog();
    expect(screen.getByText('Remove this certificate?')).toBeTruthy();
    expect(mocks.eq).not.toHaveBeenCalled();
    expect(mocks.removeFile).not.toHaveBeenCalled();
  });

  it('removes the certificate and its file, says so and tells the page', async () => {
    const onRemoved = vi.fn();
    render(<RemoveCertificateButton certificate={CERT} onRemoved={onRemoved} />);
    openDialog();
    confirm();
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(mocks.eq).toHaveBeenCalledWith('id', 'c-1');
    expect(mocks.removeFile).toHaveBeenCalledWith(['u-1/certifications/123-file.pdf']);
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('does not touch the storage for a certificate without a file', async () => {
    const onRemoved = vi.fn();
    render(<RemoveCertificateButton certificate={{ id: 'c-2', name: 'No file here', document_url: null }} onRemoved={onRemoved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove No file here' }));
    confirm();
    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(mocks.removeFile).not.toHaveBeenCalled();
  });

  it('keeps the file and reports a problem when nothing was removed', async () => {
    mocks.selectDeleted.mockResolvedValue({ data: [], error: null });
    const onRemoved = vi.fn();
    render(<RemoveCertificateButton certificate={CERT} onRemoved={onRemoved} />);
    openDialog();
    confirm();
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(mocks.removeFile).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('keeps the file and reports a problem when the database gives an error', async () => {
    mocks.selectDeleted.mockResolvedValue({ data: null, error: { message: 'denied' } });
    const onRemoved = vi.fn();
    render(<RemoveCertificateButton certificate={CERT} onRemoved={onRemoved} />);
    openDialog();
    confirm();
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(mocks.removeFile).not.toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
  });
});
