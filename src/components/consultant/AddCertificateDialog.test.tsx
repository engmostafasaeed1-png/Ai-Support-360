import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), insert: vi.fn(), bucket: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({ insert: mocks.insert }),
    storage: {
      from: (bucket: string) => {
        mocks.bucket(bucket);
        return { upload: mocks.upload, remove: mocks.remove };
      },
    },
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import AddCertificateDialog from './AddCertificateDialog';

function show(props: { onOpenChange?: (open: boolean) => void; onAdded?: () => void } = {}) {
  render(<AddCertificateDialog open onOpenChange={props.onOpenChange ?? (() => {})} consultantId="c-1" userId="u-1" onAdded={props.onAdded} />);
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const chooseFile = (file: File) => fireEvent.change(screen.getByLabelText(/Certificate file/), { target: { files: [file] } });
const add = () => fireEvent.click(screen.getByRole('button', { name: 'Add certificate' }));

beforeEach(() => {
  mocks.upload.mockReset();
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockReset();
  mocks.remove.mockResolvedValue({ error: null });
  mocks.insert.mockReset();
  mocks.insert.mockResolvedValue({ error: null });
  mocks.bucket.mockReset();
  vi.mocked(toast.success).mockReset();
  vi.mocked(toast.error).mockReset();
});
afterEach(() => cleanup());

describe('AddCertificateDialog', () => {
  it('asks for the name of the certificate first', async () => {
    show();
    add();
    expect((await screen.findByRole('alert')).textContent).toContain('name of the certificate');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('saves a certificate without a file', async () => {
    const onAdded = vi.fn();
    const onOpenChange = vi.fn();
    show({ onAdded, onOpenChange });
    type('Certificate name', '  ITIL Foundation ');
    type('Issued by (optional)', 'Axelos');
    add();
    await waitFor(() => expect(mocks.insert).toHaveBeenCalledTimes(1));
    expect(mocks.insert).toHaveBeenCalledWith({ consultant_id: 'c-1', name: 'ITIL Foundation', issuer: 'Axelos', issue_date: null, expiry_date: null, document_url: null });
    expect(mocks.upload).not.toHaveBeenCalled();
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast.success).toHaveBeenCalled();
  });

  it('uploads the file into the own folder of the consultant and stores the path', async () => {
    show();
    type('Certificate name', 'SAP S/4HANA');
    type('Issue date (optional)', '2024-05-01');
    chooseFile(new File(['%PDF-1.4'], 'My Cert (1).pdf', { type: 'application/pdf' }));
    add();
    await waitFor(() => expect(mocks.insert).toHaveBeenCalledTimes(1));
    expect(mocks.bucket).toHaveBeenCalledWith('consultant-documents');
    const path = mocks.upload.mock.calls[0][0] as string;
    expect(path).toMatch(/^u-1\/certifications\/\d+-My_Cert_1\.pdf$/);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ consultant_id: 'c-1', issue_date: '2024-05-01', document_url: path }));
  });

  it('refuses a file that is not a PDF, a JPG or a PNG', async () => {
    show();
    type('Certificate name', 'SAP S/4HANA');
    chooseFile(new File(['<html>'], 'page.html', { type: 'text/html' }));
    add();
    expect((await screen.findByRole('alert')).textContent).toContain('PDF, JPG or PNG');
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('refuses an expiry date before the issue date', async () => {
    show();
    type('Certificate name', 'SAP S/4HANA');
    type('Issue date (optional)', '2024-05-01');
    type('Expiry date (optional)', '2024-01-01');
    add();
    expect((await screen.findByRole('alert')).textContent).toContain('before the issue date');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('says so when the file can not be uploaded and saves nothing', async () => {
    mocks.upload.mockResolvedValue({ error: { message: 'too big' } });
    show();
    type('Certificate name', 'SAP S/4HANA');
    chooseFile(new File(['%PDF-1.4'], 'cert.pdf', { type: 'application/pdf' }));
    add();
    expect((await screen.findByRole('alert')).textContent).toContain('could not be uploaded');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('removes the uploaded file again when the certificate can not be saved', async () => {
    mocks.insert.mockResolvedValue({ error: { message: 'denied' } });
    show();
    type('Certificate name', 'SAP S/4HANA');
    chooseFile(new File(['%PDF-1.4'], 'cert.pdf', { type: 'application/pdf' }));
    add();
    expect((await screen.findByRole('alert')).textContent).toContain('could not be saved');
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.remove.mock.calls[0][0]).toEqual([mocks.upload.mock.calls[0][0]]);
  });
});
